import type { ModelType } from '../../types/index.js';
import type { StandardizedPage } from '../../types/markingRouter.js';
import type { QuestionResult } from './MarkingExecutor.js';
import { SessionManagementService } from '../sessionManagementService.js';
import { GradeBoundaryService } from './GradeBoundaryService.js';
import { MarkingServiceLocator } from './MarkingServiceLocator.js';
import { handleAIMessageIdForEndpoint } from '../../utils/messageUtils.js';
import { getSuggestedFollowUps } from './MarkingHelpers.js';
import type { MarkingSessionContext } from '../../types/sessionManagement.js';
import { usageTracker } from '../../utils/UsageTracker.js';
import { ChatContextBuilder } from './ChatContextBuilder.js';

export class MarkingPersistenceService {

    /**
     * Persists the marking session to the database.
     * Handles:
     * 1. Original File Upload
     * 2. Structured Data Creation
     * 3. User Message Creation
     * 4. Mixed Content (Question Only) Response Generation
     * 5. Grade Calculation
     * 6. AI Message Creation
     * 7. Session Persistence
     * 8. Subject Marking Result Persistence (Background)
     */
    static async persistSession(
        files: Express.Multer.File[],
        options: { userId?: string, sessionId?: string, customText?: string, model?: string },
        submissionId: string,
        startTime: number,
        standardizedPages: StandardizedPage[],
        allQuestionResults: QuestionResult[],
        classificationResult: any,
        allClassificationResults: any[],
        markingSchemesMap: Map<string, any>,
        detectionResults: any[],  // Add detection results for Exam Tab building
        globalQuestionText: string,
        finalAnnotatedOutput: string[],
        overallScore: number,
        totalPossibleScore: number,
        overallScoreText: string,
        isPdf: boolean,
        isMultiplePdfs: boolean,
        pdfContext: any,
        isMixedContent: boolean,
        stepTimings: any,
        totalLLMTokens: number,
        questionOnlyClassificationResult: any | undefined,  // Clean Bucket B classification for text responses
        usageTracker: any,  // UsageTracker instance with all token/cost data
        mathpixCallCount: number  // Actual Mathpix OCR call count
    ): Promise<{ unifiedSession: any }> {
        let dbUserMessage: any = null;
        let dbAiMessage: any = null;
        let persistenceResult: any = null;
        let unifiedSession: any = null;
        let actualModel = options.model || 'auto';

        // DEBUG: Check what we received
        // console.log(`[PERSISTENCE ENTRY] questionOnlyClassificationResult type: ${typeof questionOnlyClassificationResult}`);
        // console.log(`[PERSISTENCE ENTRY] Is array: ${Array.isArray(questionOnlyClassificationResult)}`);
        // console.log(`[PERSISTENCE ENTRY] Length: ${Array.isArray(questionOnlyClassificationResult) ? questionOnlyClassificationResult.length : 'N/A'}`);
        // console.log(`[PERSISTENCE ENTRY] isMixedContent: ${isMixedContent}`);

        try {
            // Extract request data
            const userId = options.userId || 'anonymous';
            const sessionId = options.sessionId || `temp-${Date.now()}`;
            const currentSessionId = sessionId.startsWith('temp-') ? `session-${Date.now()}` : sessionId;
            const customText = options.customText;
            const model = options.model || 'auto';
            const isAuthenticated = !!options.userId;

            // Resolve actual model if 'auto' is specified
            if (model === 'auto') {
                const { getDefaultModel } = await import('../../config/aiModels.js');
                actualModel = getDefaultModel();
            } else {
                actualModel = model;
            }

            // Generate timestamps for database consistency
            const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
            const aiTimestamp = new Date().toISOString(); // AI message current time

            // Upload original files for authenticated users
            const uploadResult = await SessionManagementService.uploadOriginalFiles(
                files,
                options.userId || 'anonymous',
                submissionId,
                !!options.userId
            );

            // ========= USER MESSAGE CREATION =========
            const { structuredImageDataArray, structuredPdfContexts } = SessionManagementService.createStructuredData(
                files,
                isPdf,
                isMultiplePdfs,
                pdfContext
            );

            dbUserMessage = SessionManagementService.createUserMessageForDatabase(
                {
                    content: options.customText || `I have uploaded ${files.length} file(s) for marking.`,
                    files,
                    isPdf,
                    isMultiplePdfs,
                    sessionId: currentSessionId,
                    model,
                    pdfContext
                },
                structuredImageDataArray,
                structuredPdfContexts,
                uploadResult.originalImageLinks
            );

            // Override timestamp for database consistency
            (dbUserMessage as any).timestamp = userTimestamp;

            // ========================= MIXED CONTENT: USE PRE-GENERATED RESPONSES =========================
            let questionOnlyResponses: string[] = [];

            if (isMixedContent && questionOnlyClassificationResult) {
                console.log('[PERSISTENCE] Processing questionOnly responses for mixed mode');
                console.log(`[PERSISTENCE DEBUG] Received ${Array.isArray(questionOnlyClassificationResult) ? questionOnlyClassificationResult.length : 'N/A'} responses`);

                // Handle array format from unifiedSession.questionResponses
                if (Array.isArray(questionOnlyClassificationResult)) {
                    // REUSE Question Mode's formatted responses AS-IS (no duplicate formatting!)
                    // qr.response already has the proper markdown header from QuestionModeHandler
                    // Example: "### Question 1 (1 mark)\n\n<answer with marking codes>"
                    const formattedIndividualResponses = questionOnlyClassificationResult.map((qr: any, index: number) => {
                        const response = qr.response || ''; // Already formatted by Question Mode!
                        const isEmpty = !response || response.trim() === '';
                        if (isEmpty) {
                            console.log(`[PERSISTENCE DEBUG] Response ${index + 1} (Q${qr.questionNumber}) is EMPTY`);
                        }
                        // NO additional header needed - already has "### Question X (Y marks)"
                        return response;
                    }).filter(r => r);

                    // Join with line separators (same as pure question mode)
                    const formattedResponse = formattedIndividualResponses.join('\n\n' + '_'.repeat(80) + '\n\n');
                    questionOnlyResponses = [formattedResponse]; // Single combined string

                    console.log(`[PERSISTENCE DEBUG] formattedIndividualResponses count: ${formattedIndividualResponses.length}`);
                    console.log(`[PERSISTENCE] Reused ${questionOnlyClassificationResult.length} pre-formatted question responses from Question Mode`);
                } else if (questionOnlyClassificationResult.questions) {
                    // Legacy fallback - should not be used anymore
                    console.warn('[PERSISTENCE] Received old questionOnlyClassificationResult format - generating responses (DEPRECATED)');
                    // Keep old generation logic as fallback...
                }
            }

            // Create AI message for database
            // Calculate grade based on grade boundaries (if exam data is available)
            let detectedQuestionForGrade: any = undefined;
            if (markingSchemesMap && markingSchemesMap.size > 0) {
                const firstSchemeEntry = Array.from(markingSchemesMap.values())[0];
                detectedQuestionForGrade = firstSchemeEntry?.questionDetection || undefined;
            }

            const gradeResult = await GradeBoundaryService.calculateGradeWithOrchestration(
                overallScore,
                totalPossibleScore,
                detectedQuestionForGrade,
                markingSchemesMap
            );
            const calculatedGrade = gradeResult.grade;
            const gradeBoundaryType = gradeResult.boundaryType;
            const gradeBoundaries = gradeResult.boundaries;

            // Build rich marking context using "Store Once" pattern
            const richMarkingContext = await ChatContextBuilder.buildMarkingContext({
                allQuestionResults,
                questionDetection: detectionResults?.[0] || null,
                markingSchemesMap,
                detectionResults,
                overallScore: {
                    awardedMarks: overallScore,
                    totalMarks: totalPossibleScore,
                    percentage: totalPossibleScore > 0 ? Math.round((overallScore / totalPossibleScore) * 100) : 0,
                    scoreText: overallScoreText
                },
                gradeBoundaryResult: gradeResult
            });

            // console.log(`[CONTEXT FLOW] 💾 Persisting marking context (Qs: ${richMarkingContext.totalQuestionsMarked}, Score: ${richMarkingContext.overallScore.scoreText})`);

            // Resolve AI message ID
            const resolvedAIMessageId = handleAIMessageIdForEndpoint({ model: actualModel }, null, 'marking');

            dbAiMessage = SessionManagementService.createAIMessageForDatabase({
                allQuestionResults,
                finalAnnotatedOutput,
                files,
                actualModel,
                startTime,
                markingSchemesMap,
                detectionResults,  // Add detection results for Exam Tab building
                globalQuestionText,
                resolvedAIMessageId,
                questionOnlyResponses: isMixedContent ? questionOnlyResponses : undefined,
                studentScore: {
                    totalMarks: totalPossibleScore,
                    awardedMarks: overallScore,
                    scoreText: overallScoreText
                },
                grade: calculatedGrade,
                gradeBoundaryType: gradeBoundaryType,
                gradeBoundaries: gradeBoundaries,
                markingContext: richMarkingContext
            });

            // Add suggested follow-ups
            (dbAiMessage as any).suggestedFollowUps = await getSuggestedFollowUps();

            // Override timestamp for database consistency
            (dbAiMessage as any).timestamp = aiTimestamp;

            // Persist marking session
            const markingContext: MarkingSessionContext = {
                req: {
                    body: { sessionId: options.sessionId },
                    user: options.userId ? { uid: options.userId, email: 'user@example.com' } : undefined
                } as any,
                submissionId,
                startTime,
                userMessage: dbUserMessage,
                aiMessage: dbAiMessage,
                questionDetection: null,
                globalQuestionText: globalQuestionText || '',
                mode: 'Marking',
                allQuestionResults,
                markingSchemesMap,
                detectionResults,  // Add detection results for Exam Tab building
                files,
                usageTokens: usageTracker.getTotalTokens(),  // Use UsageTracker for accurate total
                model: actualModel,
                mathpixCallCount: mathpixCallCount  // Pass actual Mathpix call count
            };

            // Add API request count to context (from UsageTracker)
            const apiRequestCounts = usageTracker.getRequestCounts();
            markingContext.apiRequests = usageTracker.getTotalRequests();
            markingContext.apiRequestBreakdown = apiRequestCounts;

            // CRITICAL: Use UsageTracker combined total directly (NO recalculation!)
            // This is the EXACT value shown in UsageTracker summary
            const { total, mathpix: mathpixCost } = usageTracker.calculateCost(actualModel);
            const totalCost = total;
            const llmCost = total - mathpixCost;

            // console.log(`💰 [COST] UsageTracker Combined Total: $${totalCost} (LLM: $${llmCost} + Mathpix: $${mathpixCost})`);

            // Store totalCost in context for sessionStats
            markingContext.totalCost = totalCost;
            markingContext.costBreakdown = {
                llmCost,
                mathpixCost
            };

            stepTimings['database_persistence'] = { start: Date.now() };
            persistenceResult = await SessionManagementService.persistMarkingSession(markingContext);
            if (stepTimings['database_persistence']) {
                stepTimings['database_persistence'].duration = Date.now() - stepTimings['database_persistence'].start;
            }

            // For authenticated users, use the unifiedSession from persistence
            if (isAuthenticated) {
                unifiedSession = persistenceResult.unifiedSession;

                // Persist marking result to subjectMarkingResults in background (don't wait)
                if (unifiedSession && dbAiMessage) {
                    const markingMessage = unifiedSession.messages?.find(
                        (msg: any) => msg.role === 'assistant' && msg.studentScore
                    );

                    if (markingMessage) {
                        import('../subjectMarkingResultService.js').then(({ persistMarkingResultToSubject }) => {
                            persistMarkingResultToSubject(unifiedSession, markingMessage).catch(err => {
                                console.error('❌ [SUBJECT MARKING RESULT] Background persistence failed:', err);
                            });
                        }).catch(err => {
                            console.error('❌ [SUBJECT MARKING RESULT] Failed to import service:', err);
                        });
                    }
                }
            }

        } catch (error) {
            console.error(`❌ [SUBMISSION ${submissionId}] Failed to persist to database:`, error);
            if (error instanceof Error) {
                console.error(`❌ [SUBMISSION ${submissionId}] Error name: ${error.name}`);
                console.error(`❌ [SUBMISSION ${submissionId}] Error message: ${error.message}`);
                console.error(`❌ [SUBMISSION ${submissionId}] Error stack:`, error.stack);
            }
            throw error;
        }

        // For unauthenticated users, create unifiedSession even if database persistence failed
        const isAuthenticated = !!options.userId;
        if (!isAuthenticated && !unifiedSession) {
            if (!dbUserMessage || !dbAiMessage) {
                throw new Error(`Cannot create unauthenticated session: missing required data.`);
            }
            unifiedSession = SessionManagementService.createUnauthenticatedSession(
                submissionId,
                dbUserMessage,
                dbAiMessage,
                allQuestionResults,
                startTime,
                actualModel,
                files,
                'Marking'
            );
        }

        return { unifiedSession };
    }
}
