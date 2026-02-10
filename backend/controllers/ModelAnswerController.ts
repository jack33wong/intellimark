import { Request, Response } from 'express';
import { getFirestore } from '../config/firebase.js';
import { FirestoreService } from '../services/firestoreService.js';
import { SuggestedFollowUpService } from '../services/marking/suggestedFollowUpService.js';
import { createUserMessage, createAIMessage } from '../utils/messageUtils.js';
import { sendSseUpdate } from '../utils/sseUtils.js';
import UsageTracker from '../utils/UsageTracker.js';
import { GuestUsageService } from '../services/guestUsageService.js';
import { checkCredits, deductCredits } from '../services/creditService.js';
import { normalizeMarkingScheme } from '../services/marking/MarkingInstructionService.js';
import { MarkingPromptService } from '../services/marking/MarkingPromptService.js';
import { ExamReferenceService } from '../services/ExamReferenceService.js';

export class ModelAnswerController {
    /**
     * Generates model answers for a specific exam paper or custom text
     * Handled via SSE for consistent progress tracking
     */
    public static async generateModelAnswers(req: Request, res: Response): Promise<void> {
        const usageTracker = new UsageTracker();
        const startTime = Date.now();

        // 1. SSE Setup
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        sendSseUpdate(res, { type: 'connected', message: 'Generating model answers...' });

        try {
            const { paper, model = 'auto', sessionId: providedSessionId } = req.body;
            console.log(`🚀 [MODEL-ANSWER] Controller HIT! Request for paper: ${paper}`);
            let sessionId = providedSessionId;

            // Sanitization: Silent handle temp- IDs from frontend
            if (sessionId && sessionId.startsWith('temp-')) {
                sessionId = null;
            }
            const userId = (req as any).user?.uid || 'anonymous';
            const isAuthenticated = userId !== 'anonymous';
            const userIP = req.ip || '0.0.0.0';

            // 2. Guest limit check (overall sessions)
            if (!isAuthenticated) {
                const limitInfo = await GuestUsageService.checkLimit(userIP);
                if (!limitInfo.allowed) {
                    sendSseUpdate(res, {
                        type: 'error',
                        message: 'Guest limit reached. Please sign up to see more model answers.',
                        details: 'guest_limit_reached'
                    });
                    res.end();
                    return;
                }
            }

            // 3. Retrieve Paper Data
            const db = getFirestore();
            let detectedQuestion: any = null;
            let metadataHeader = '';

            if (paper) {
                sendSseUpdate(res, { type: 'progress', step: 'retrieving_paper', currentStepDescription: 'Finding exam paper...' });

                const paperDoc = await ExamReferenceService.findPaper(paper);

                if (paperDoc) {
                    const meta = paperDoc.metadata;

                    // Format Metadata Display
                    const { series: formattedSeries, tier: formattedTier } = ExamReferenceService.formatMetadataDisplay(meta);

                    // Use specific CSS class for header, no ###, no markdown separator, add extra spacing
                    metadataHeader = `<div class="model-exam-header">${meta.exam_board} - ${meta.exam_code} - ${formattedSeries}${formattedTier ? `, ${formattedTier}` : ''}</div>\n\n<br><br>\n\n`;

                    // Strict Limits for AI Usage
                    let questionsToProcess = paperDoc.questions || [];

                    if (isAuthenticated) {
                        // Testing Mode: NO LIMIT for authenticated users
                        // questionsToProcess = questionsToProcess; 
                    } else {
                        // Strict Guest Limit: Max 3
                        if (questionsToProcess.length > 3) {
                            questionsToProcess = questionsToProcess.slice(0, 3);
                            metadataHeader += `<div class="model-alert-note"><strong>NOTE:</strong> Guest Mode: Showing first 3 questions only. Sign up for more.</div><br><br>\n\n`;
                        }
                    }

                    // Retrieve Marking Schemes - Using Metadata Match ONLY (ID lookup is unreliable)
                    sendSseUpdate(res, { type: 'progress', step: 'retrieving_schemes', currentStepDescription: 'Loading marking schemes (Metadata Match)...' });

                    let schemeData = null;

                    // Strategy: Metadata Match (Board + Code + Series)
                    const schemeResult = await ExamReferenceService.findMarkingScheme(meta);
                    if (schemeResult) {
                        schemeData = schemeResult.data;
                    }

                    detectedQuestion = {
                        found: true,
                        examPapers: [{
                            examBoard: meta.exam_board,
                            examCode: meta.exam_code,
                            examSeries: meta.exam_series,
                            tier: meta.tier,
                            subject: meta.subject || 'Mathematics',
                            paperTitle: `${meta.exam_board} ${meta.exam_code}`,
                            questions: questionsToProcess.map((q: any) => {
                                const qNum = String(q.question_number);
                                let scheme = null;

                                // [FIX] Robust Lookup: Handle both Array and Map structures
                                const qData = schemeData?.questions || schemeData; // Fallback to root if needed

                                if (qData) {
                                    if (Array.isArray(qData)) {
                                        scheme = qData.find((s: any) => String(s.question_number) === qNum);
                                    } else {
                                        // 1. Try exact match
                                        scheme = qData[qNum];

                                        // 2. If not found, look for sub-questions (e.g., "5" -> "5a", "5b", "5a(i)")
                                        if (!scheme) {
                                            // More relaxed filter for sub-questions: starts with qNum
                                            // [FIX] Strict check: The character immediately following qNum MUST NOT be a digit
                                            // This prevents "1" matching "10", "11", etc.
                                            const subKeys = Object.keys(qData).filter(k => {
                                                if (!k.startsWith(qNum)) return false;
                                                if (k === qNum) return false;

                                                const suffix = k.slice(qNum.length);
                                                // If suffix starts with a digit, it's a different question (e.g. 1 -> 10)
                                                if (/^\d/.test(suffix)) return false;

                                                // Allow letters, parens, Roman numerals in suffix
                                                return /^[a-z0-9()\[\]]+$/i.test(suffix);
                                            });

                                            if (subKeys.length > 0) {
                                                // Sort to ensure a, b, c order (aware of complex labels)
                                                subKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                                                console.log(`[MODEL-ANSWER] Found sub-questions for ${qNum}: ${subKeys.join(', ')}`);

                                                // Aggregate schemes
                                                scheme = {
                                                    answer: subKeys.map(k => `(${k.replace(qNum, '')}) ${qData[k].answer || qData[k].question_answer || ''}`).join('; '),
                                                    marks: subKeys.flatMap(k => (qData[k].marks || qData[k].question_marks || []).map((m: any) => ({ ...m, question_part: k.replace(qNum, '') }))),
                                                    guidance: subKeys.flatMap(k => qData[k].guidance || qData[k].generalMarkingGuidance || [])
                                                };
                                            }
                                        }
                                    }
                                }

                                if (!scheme) {
                                    console.warn(`[MODEL-ANSWER] Scheme not found for Q${qNum} in ${meta.exam_board} ${meta.exam_code}`);
                                }

                                // [FEATURE] Normalize & Process Scheme (CAO expansion)
                                if (scheme) {
                                    const normalized = normalizeMarkingScheme(scheme);
                                    if (normalized) {
                                        scheme = normalized; // Pass the processed object
                                    }
                                }

                                let questionText = q.question_text || q.text || '';
                                if (!questionText && q.sub_questions && Array.isArray(q.sub_questions)) {
                                    questionText = q.sub_questions
                                        .map((sq: any) => `${sq.question_part}) ${sq.question_text}`)
                                        .join('\n\n');
                                }

                                return {
                                    questionNumber: String(q.question_number),
                                    questionText: questionText,
                                    marks: q.marks,
                                    markingScheme: scheme
                                };
                            })
                        }]
                    };
                }
            }

            if (!detectedQuestion) {
                throw new Error('Could not find exam paper metadata. Please check the paper name.');
            }

            // 4. Create Session & Messages
            if (!sessionId) {
                sessionId = `session-model-${Date.now()}`;
            }

            // Create user message
            const userMessage = createUserMessage({
                content: `Generate model answers for: ${paper}`,
                sessionId: sessionId,
                model: model
            });

            // If authenticated, pre-create session
            if (isAuthenticated) {
                await FirestoreService.createUnifiedSessionWithMessages({
                    sessionId: sessionId,
                    title: `Model Answer: ${paper}`,
                    userId: userId,
                    messageType: 'Chat',
                    messages: [userMessage],
                    usageMode: 'modelanswer'
                });
            }

            // 5. Generate Model Answer
            sendSseUpdate(res, { type: 'progress', step: 'generating', currentStepDescription: 'AI is writing model answers...' });

            const followUpResult = await SuggestedFollowUpService.handleSuggestedFollowUp({
                mode: 'modelanswer',
                sessionId: sessionId,
                sourceMessageId: userMessage.id,
                model: model === 'auto' ? 'gemini-2.0-flash' : model,
                detectedQuestion: detectedQuestion,
                tracker: usageTracker
            });

            // 6. Prepend Header & Format
            // Wrap in the specific HTML structure requested by frontend for "notebook" styling
            const finalResponse = `
<div class="has-your-work-outer-container">
<div class="markdown-math-renderer chat-message-renderer has-your-work">
${metadataHeader}
${followUpResult.response}
</div>
</div>`.trim();

            // 7. Store AI Message
            const aiMessage = createAIMessage({
                content: finalResponse,
                progressData: { type: 'text', steps: [], currentStep: null, isComplete: true },
                processingStats: {
                    modelUsed: model,
                    apiUsed: followUpResult.apiUsed || 'SuggestedFollowUpService',
                    llmTokens: usageTracker.getTotalTokens(),
                    totalCost: usageTracker.calculateCost(model).total,
                    processingTimeMs: Date.now() - startTime
                }
            });

            if (isAuthenticated) {
                await FirestoreService.addMessageToUnifiedSession(sessionId, aiMessage, 'modelanswer');

                // Deduct credits
                const cost = usageTracker.calculateCost(model).total;
                if (cost > 0) {
                    await deductCredits(userId, cost, sessionId);
                }
            } else {
                // Increment guest usage
                await GuestUsageService.incrementUsage(userIP);
            }

            // 8. Final SSE Update
            sendSseUpdate(res, {
                type: 'complete',
                result: {
                    success: true,
                    sessionId,
                    sessionTitle: `Model Answer: ${paper}`,
                    aiMessage
                }
            });

            res.end();

        } catch (error: any) {
            console.error('❌ [MODEL-ANSWER] Generation failed:', error);
            sendSseUpdate(res, {
                type: 'error',
                message: error.message || 'Failed to generate model answers.'
            });
            res.end();
        }
    }
}
