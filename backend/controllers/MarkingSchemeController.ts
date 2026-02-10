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

export class MarkingSchemeController {
    /**
     * Explains marking schemes for a specific exam paper
     * Handled via SSE for consistent progress tracking
     */
    public static async explainMarkingScheme(req: Request, res: Response): Promise<void> {
        const usageTracker = new UsageTracker();
        const startTime = Date.now();

        // 1. SSE Setup
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        sendSseUpdate(res, { type: 'connected', message: 'Retrieving marking scheme...' });

        try {
            const { paper, model = 'auto', sessionId: providedSessionId } = req.body;
            console.log(`🚀 [MARKING_SCHEME] Controller HIT! Request for paper: ${paper}`);
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
                        message: 'Guest limit reached. Please sign up to see more marking scheme explanations.',
                        details: 'guest_limit_reached'
                    });
                    res.end();
                    return;
                }
            }

            // 3. Retrieve Paper Data (Refactored to use centralized service)
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

                    // Metadata Header matching the requested format
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

                    // Retrieve Marking Schemes - Using Centralized Service
                    sendSseUpdate(res, { type: 'progress', step: 'retrieving_schemes', currentStepDescription: 'Loading marking schemes (Metadata Match)...' });

                    let schemeData = null;
                    const schemeResult = await ExamReferenceService.findMarkingScheme(meta);

                    if (schemeResult) {
                        schemeData = schemeResult.data;
                    }

                    if (!schemeData) {
                        console.log(`❌ [MARKING-SCHEME] No marking scheme found for paper ${paperDoc.id}`);
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

                                        // 2. If not found, look for sub-questions (e.g., "5" -> "5a", "5b")
                                        if (!scheme) {
                                            const subKeys = Object.keys(qData).filter(k => {
                                                if (!k.startsWith(qNum)) return false;
                                                if (k === qNum) return false;

                                                const suffix = k.slice(qNum.length);
                                                // [FIX] If suffix starts with a digit, it's a different question (e.g. 1 -> 10)
                                                if (/^\d/.test(suffix)) return false;

                                                return /^[a-z]+$/i.test(suffix); // MarkingSchemeController had stricter [a-z] regex originally
                                            });
                                            if (subKeys.length > 0) {
                                                // Sort to ensure a, b, c order
                                                subKeys.sort();
                                                console.log(`[MARKING-SCHEME] Found sub-questions for ${qNum}: ${subKeys.join(', ')}`);

                                                // Aggregate schemes
                                                scheme = {
                                                    answer: subKeys.map(k => `(${k.replace(qNum, '')}) ${qData[k].answer}`).join('; '),
                                                    marks: subKeys.flatMap(k => qData[k].marks.map((m: any) => ({ ...m, question_part: k.replace(qNum, '') }))),
                                                    guidance: subKeys.flatMap(k => qData[k].guidance || [])
                                                };
                                            }
                                        }
                                    }
                                }

                                // [FEATURE] Normalize & Process Scheme (CAO expansion)
                                if (scheme) {
                                    const normalized = normalizeMarkingScheme(scheme);
                                    if (normalized) {
                                        scheme = normalized; // Pass the processed object
                                    }
                                }


                                let questionText = q.question_text || q.text || '';

                                // [FIX] Handle questions that only have sub-questions (like Q2)
                                if (!questionText && q.sub_questions && Array.isArray(q.sub_questions)) {
                                    questionText = q.sub_questions
                                        .map((sq: any) => `${sq.question_part}) ${sq.question_text}`)
                                        .join('\n\n');
                                }

                                return {
                                    questionNumber: qNum,
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
                sessionId = `session-marking-scheme-${Date.now()}`;
            }

            const userMessage = createUserMessage({
                content: `Explain marking scheme for: ${paper}`,
                sessionId: sessionId,
                model: model
            });

            if (isAuthenticated) {
                await FirestoreService.createUnifiedSessionWithMessages({
                    sessionId: sessionId,
                    title: `Marking Scheme: ${paper}`,
                    userId: userId,
                    messageType: 'Chat',
                    messages: [userMessage],
                    usageMode: 'markingscheme'
                });
            }

            // 5. Generate Explanation
            sendSseUpdate(res, { type: 'progress', step: 'generating', currentStepDescription: 'AI is explaining marking schemes...' });

            const followUpResult = await SuggestedFollowUpService.handleSuggestedFollowUp({
                mode: 'markingscheme',
                sessionId: sessionId,
                sourceMessageId: userMessage.id,
                model: model === 'auto' ? 'gemini-2.0-flash' : model,
                detectedQuestion: detectedQuestion,
                tracker: usageTracker
            });

            // 6. Prepend Header & Wrap in requested CSS classes
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
                await FirestoreService.addMessageToUnifiedSession(sessionId, aiMessage, 'markingscheme');
                const cost = usageTracker.calculateCost(model).total;
                if (cost > 0) {
                    await deductCredits(userId, cost, sessionId);
                }
            } else {
                await GuestUsageService.incrementUsage(userIP);
            }

            // 8. Final SSE Update
            sendSseUpdate(res, {
                type: 'complete',
                result: {
                    success: true,
                    sessionId,
                    sessionTitle: `Marking Scheme: ${paper}`,
                    aiMessage
                }
            });

            res.end();

        } catch (error: any) {
            console.error('❌ [MARKING_SCHEME] Explanation failed:', error);
            sendSseUpdate(res, {
                type: 'error',
                message: error.message || 'Failed to explain marking scheme.'
            });
            res.end();
        }
    }
}
