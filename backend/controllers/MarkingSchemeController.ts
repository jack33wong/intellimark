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
import { ChatContextBuilder } from '../services/marking/ChatContextBuilder.js';

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
            const { paper, model = 'auto', sessionId: providedSessionId, aiMessageId: providedAiMessageId } = req.body;
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
                sendSseUpdate(res, {
                    type: 'progress',
                    step: 'retrieving_paper',
                    currentStepDescription: 'Finding exam paper...',
                    allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is explaining marking scheme...'],
                    currentStepIndex: 0
                });

                const paperDoc = await ExamReferenceService.findPaper(paper);

                if (paperDoc) {
                    const meta = paperDoc.metadata;

                    // Format Metadata Display
                    const { series: formattedSeries, tier: formattedTier } = ExamReferenceService.formatMetadataDisplay(meta);

                    // Calculate totals from Paper Document
                    const totalQuestions = paperDoc.questions?.length || 0;
                    const totalMarks = (paperDoc.questions || []).reduce((sum: number, q: any) => sum + (q.marks || 0), 0);

                    // Metadata Header matching the requested format
                    metadataHeader = `
<div class="model-exam-header">
  <div class="exam-header-title">${meta.exam_board}</div>
  <div class="exam-header-pills">
    <span class="exam-pill pill-code">${meta.exam_code}</span>
    <span class="exam-pill pill-series">${formattedSeries}</span>
    ${formattedTier ? `<span class="exam-pill pill-tier">${formattedTier}</span>` : ''}
    <span class="exam-pill pill-marks">${totalMarks} Marks</span>
    <span class="exam-pill pill-count">${totalQuestions} Questions</span>
  </div>
</div>`.trim() + '\n\n';

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
                    sendSseUpdate(res, {
                        type: 'progress',
                        step: 'retrieving_schemes',
                        currentStepDescription: 'Loading marking schemes...',
                        allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is explaining marking scheme...'],
                        currentStepIndex: 1
                    });

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
                                // [FIX] Robust property handling for Paper Document (handle both sub_questions and subQuestions, number and question_number)
                                const subQuestions = q.sub_questions || q.subQuestions || [];
                                const qNum = String(q.question_number || q.number || '');

                                let scheme = null;

                                // [FIX] Robust Lookup: Handle both Array and Map structures
                                const qData = schemeData?.questions || schemeData; // Fallback to root if needed

                                if (qData) {
                                    if (Array.isArray(qData)) {
                                        scheme = qData.find((s: any) => String(s.question_number || s.number) === qNum);
                                    } else {
                                        // 1. Try exact match
                                        scheme = qData[qNum];

                                        // 2. If not found, look for sub-questions (e.g., "5" -> "5a", "5b", "5a(i)")
                                        if (!scheme) {
                                            // More relaxed filter for sub-questions: starts with qNum
                                            // [FIX] Strict check: The character immediately following qNum MUST NOT be a digit
                                            const subKeys = Object.keys(qData).filter(k => {
                                                if (!k.startsWith(qNum)) return false;
                                                if (k === qNum) return false;

                                                const suffix = k.slice(qNum.length);
                                                if (/^\d/.test(suffix)) return false;

                                                // Allow letters, parens, Roman numerals in suffix
                                                return /^[a-z0-9()\[\]]+$/i.test(suffix);
                                            });

                                            if (subKeys.length > 0) {
                                                subKeys.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                                                console.log(`[MARKING-SCHEME] Found sub-marks for ${qNum}: ${subKeys.join(', ')}`);

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

                                // [FEATURE] Normalize & Process Scheme (CAO expansion)
                                if (scheme) {
                                    const normalized = normalizeMarkingScheme(scheme);
                                    if (normalized) {
                                        scheme = normalized; // Pass the processed object
                                    }
                                }


                                // [FIX] "Sub-Question Blindness": Always aggregate parent text + sub-question text
                                let questionText = q.question_text || q.text || '';
                                if (Array.isArray(subQuestions) && subQuestions.length > 0) {
                                    const subTextStr = subQuestions
                                        .map((sq: any) => {
                                            const part = sq.question_part || sq.part || '';
                                            const text = sq.question_text || sq.text || '';
                                            return part ? `${part}) ${text}` : text;
                                        })
                                        .join('\n\n');

                                    questionText = questionText
                                        ? `${questionText.trim()}\n\n${subTextStr}`
                                        : subTextStr;
                                }

                                let questionMarks = q.marks || 0;
                                if (questionMarks === 0 && Array.isArray(subQuestions) && subQuestions.length > 0) {
                                    questionMarks = subQuestions.reduce((sum: number, sq: any) => sum + (sq.marks || 0), 0);
                                }

                                return {
                                    questionNumber: qNum,
                                    questionText: questionText,
                                    originalText: q.question_text || q.text || '', // Root parent text
                                    marks: questionMarks,
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
                    usageMode: 'marking-scheme'
                });
            }

            // 5. Generate Explanation
            sendSseUpdate(res, {
                type: 'progress',
                step: 'generating',
                currentStepDescription: 'AI is explaining marking scheme...',
                allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is explaining marking scheme...'],
                currentStepIndex: 2
            });

            const followUpResult = await SuggestedFollowUpService.handleSuggestedFollowUp({
                mode: 'marking-scheme',
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
            // Build Marking Context for subsequent follow-up questions
            const markingContext = await ChatContextBuilder.buildQuestionModeContext({
                detectedQuestion: detectedQuestion,
                sessionType: 'Question'
            });

            const aiMessage = createAIMessage({
                content: finalResponse,
                messageId: providedAiMessageId,
                markingContext: markingContext, // INJECT CONTEXT
                progressData: {
                    type: 'marking-scheme',
                    currentStepDescription: 'Marking schemes explained',
                    allSteps: [
                        'Finding exam paper...',
                        'Loading marking schemes...',
                        'AI is explaining marking scheme...'
                    ],
                    currentStepIndex: 2,
                    isComplete: true
                },
                processingStats: {
                    modelUsed: model,
                    apiUsed: followUpResult.apiUsed || 'SuggestedFollowUpService',
                    llmTokens: usageTracker.getTotalTokens(),
                    totalCost: usageTracker.calculateCost(model).total,
                    processingTimeMs: Date.now() - startTime
                }
            });

            if (isAuthenticated) {
                await FirestoreService.addMessageToUnifiedSession(sessionId, aiMessage, 'marking-scheme');
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
