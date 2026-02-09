import { Request, Response } from 'express';
import { getFirestore } from '../config/firebase.js';
import { FirestoreService } from '../services/firestoreService.js';
import { SuggestedFollowUpService } from '../services/marking/suggestedFollowUpService.js';
import { createUserMessage, createAIMessage } from '../utils/messageUtils.js';
import { sendSseUpdate } from '../utils/sseUtils.js';
import UsageTracker from '../utils/UsageTracker.js';
import { GuestUsageService } from '../services/guestUsageService.js';
import { checkCredits, deductCredits } from '../services/creditService.js';

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
            let sessionId = providedSessionId;

            // Sanitization: Reject temp- IDs from frontend
            if (sessionId && sessionId.startsWith('temp-')) {
                console.log(`⚠️ [MODEL_ANSWER] Rejecting temp session ID: ${sessionId} - Generating new ID`);
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

                // 1. Try direct ID lookup first (most efficient)
                let paperDoc = null;
                try {
                    const directDoc = await db.collection('fullExamPapers').doc(paper).get();
                    if (directDoc.exists) {
                        paperDoc = directDoc.data();
                    }
                } catch (err) {
                    // Ignore errors if paper ID is invalid (e.g. contains slashes which Firestore treats as path)
                    console.log(`[MODEL-ANSWER] Input "${paper}" is not a valid doc ID, proceeding to search.`);
                }

                if (!paperDoc) {
                    console.log(`ℹ️ [MODEL-ANSWER] Looking for paper: ${paper}`);
                    const paperSnapshot = await db.collection('fullExamPapers').get();
                    const papers = paperSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

                    const normalizedInput = paper.toLowerCase().trim();

                    // Case 1: Status Link Match (Key Fields: Code + Series)
                    // Matches if input contains both exact code and exact series
                    paperDoc = papers.find((p: any) => {
                        const meta = p.metadata;
                        if (!meta) return false;
                        const dbCode = (meta.exam_code || '').toLowerCase();
                        const dbSeries = (meta.exam_series || '').toLowerCase();

                        // Handle / vs - in code, and allow partial containment if it's a specific link string
                        const codeMatch = normalizedInput.includes(dbCode) || normalizedInput.includes(dbCode.replace(/\//g, '-'));
                        const seriesMatch = normalizedInput.includes(dbSeries);
                        return codeMatch && seriesMatch;
                    });

                    // Case 2: Main Upload Page (Keyword Fallback - Idea from QuestionDetectionService)
                    if (!paperDoc) {
                        console.log(`ℹ️ [MODEL-ANSWER] No exact match, applying keyword search...`);

                        // Copying keyword parsing idea from QuestionDetectionService.filterPapersByHint
                        const processedHint = normalizedInput;
                        const keywords = processedHint
                            .replace(/([a-z])(\d)/gi, '$1 $2') // Split letters and numbers (e.g., JUN2024 -> JUN 2024)
                            .replace(/(\d)([a-z])/gi, '$1 $2')
                            .replace(/[-,/]/g, ' ') // Split on common delimiters
                            .split(/\s+/)
                            .filter(k => k.length > 0 && /[a-z0-9]/i.test(k));

                        const matches = papers.filter((p: any) => {
                            const meta = p.metadata;
                            if (!meta) return false;

                            // Combine only key fields for high-precision search
                            const combined = `${meta.exam_board} ${meta.exam_code} ${meta.exam_series}`.toLowerCase();
                            return keywords.every(kw => combined.includes(kw));
                        });

                        // Limit to exactly 1 record if multiple found
                        if (matches.length > 0) {
                            paperDoc = matches[0];
                            console.log(`✅ [MODEL-ANSWER] Single match found via keywords: ${paperDoc.id}`);
                        }
                    }

                    if (!paperDoc) {
                        console.log(`❌ [MODEL-ANSWER] No paper found for request: "${paper}"`);
                        const sampleIds = papers.slice(0, 5).map((p: any) => `${p.metadata?.exam_code} (${p.metadata?.exam_series})`);
                        console.log(`ℹ️ [MODEL-ANSWER] Sample DB Patterns: ${sampleIds.join(', ')}`);
                    }
                }

                if (paperDoc) {
                    const meta = paperDoc.metadata;

                    // Format Series (e.g., JUN2024 -> June 2024)
                    let formattedSeries = meta.exam_series;
                    if (formattedSeries && /^[A-Z]{3}\d{4}$/.test(formattedSeries)) {
                        const monthMap: Record<string, string> = {
                            'JAN': 'January', 'FEB': 'February', 'MAR': 'March', 'APR': 'April', 'MAY': 'May', 'JUN': 'June',
                            'JUL': 'July', 'AUG': 'August', 'SEP': 'September', 'OCT': 'October', 'NOV': 'November', 'DEC': 'December'
                        };
                        const monthCode = formattedSeries.substring(0, 3).toUpperCase();
                        const year = formattedSeries.substring(3);
                        if (monthMap[monthCode]) {
                            formattedSeries = `${monthMap[monthCode]} ${year}`;
                        }
                    }

                    // Format Tier (e.g., H -> Higher Tier)
                    let formattedTier = meta.tier;
                    if (meta.tier === 'H' || meta.tier === 'Higher') formattedTier = 'Higher Tier';
                    else if (meta.tier === 'F' || meta.tier === 'Foundation') formattedTier = 'Foundation Tier';

                    // Use specific CSS class for header, no ###, no markdown separator, add extra spacing
                    metadataHeader = `<div class="model-exam-header">${meta.exam_board} - ${meta.exam_code} - ${formattedSeries}${formattedTier ? `, ${formattedTier}` : ''}</div>\n\n<br><br>\n\n`;

                    // Apply Limits
                    let questionsToProcess = paperDoc.questions || [];

                    // Temporary Global Limit for Testing
                    if (questionsToProcess.length > 5) {
                        questionsToProcess = questionsToProcess.slice(0, 5);
                        metadataHeader += `<div class="model-alert-important"><strong>IMPORTANT:</strong> Testing Mode: Limited to first 5 questions.</div><br><br>\n\n`;
                    }

                    // Strict Guest Limit
                    if (!isAuthenticated && questionsToProcess.length > 3) {
                        questionsToProcess = questionsToProcess.slice(0, 3);
                        metadataHeader += `<div class="model-alert-note"><strong>NOTE:</strong> Guest Mode: Showing first 3 questions only. Sign up for more.</div><br><br>\n\n`;
                    }

                    // Retrieve Marking Schemes
                    sendSseUpdate(res, { type: 'progress', step: 'retrieving_schemes', currentStepDescription: 'Loading marking schemes...' });
                    const schemeSnapshot = await db.collection('markingSchemes')
                        .where('id', '==', paperDoc.id)
                        .limit(1)
                        .get();

                    const schemeData = !schemeSnapshot.empty ? schemeSnapshot.docs[0].data() : null;

                    detectedQuestion = {
                        found: true,
                        examPapers: [{
                            examBoard: meta.exam_board,
                            examCode: meta.exam_code,
                            examSeries: meta.exam_series,
                            tier: meta.tier,
                            subject: meta.subject || 'Mathematics',
                            paperTitle: `${meta.exam_board} ${meta.exam_code}`,
                            questions: questionsToProcess.map((q: any) => ({
                                questionNumber: String(q.question_number),
                                questionText: q.question_text || q.text || '',
                                marks: q.marks,
                                markingScheme: schemeData?.questions?.[q.question_number] || schemeData?.[q.question_number] || null
                            }))
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
