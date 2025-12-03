import type { ModelType } from '../../types/index.js';
import type { StandardizedPage } from '../../types/markingRouter.js';
import type { QuestionResult } from './MarkingExecutor.js';
import { SessionManagementService } from '../sessionManagementService.js';
import { GradeBoundaryService } from './GradeBoundaryService.js';
import { MarkingServiceLocator } from './MarkingServiceLocator.js';
import { handleAIMessageIdForEndpoint } from '../../utils/messageUtils.js';
import { getSuggestedFollowUps } from './MarkingHelpers.js';
import type { MarkingSessionContext } from '../../types/sessionManagement.js';
import { usageTracker } from '../../utils/usageTracker.js';

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
        totalLLMTokens: number
    ): Promise<{ unifiedSession: any }> {
        let dbUserMessage: any = null;
        let dbAiMessage: any = null;
        let persistenceResult: any = null;
        let unifiedSession: any = null;
        let actualModel = options.model || 'auto';

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
                userId,
                submissionId,
                isAuthenticated
            );

            // Create structured data (only for authenticated users)
            let structuredImageDataArray: any[] | undefined = undefined;
            let structuredPdfContexts: any[] | undefined = undefined;

            if (isAuthenticated) {
                const structuredData = SessionManagementService.createStructuredData(
                    files,
                    isPdf,
                    isMultiplePdfs,
                    pdfContext,
                    isAuthenticated
                );
                structuredImageDataArray = structuredData.structuredImageDataArray;
                structuredPdfContexts = structuredData.structuredPdfContexts;

                // Update pdfContext with structured data for frontend
                if (pdfContext && structuredPdfContexts) {
                    pdfContext.pdfContexts = structuredPdfContexts;
                }
            }

            // Create user message for database
            const messageContent = customText || (isPdf ? 'I have uploaded a PDF for analysis.' : `I have uploaded ${files.length} file(s) for analysis.`);

            dbUserMessage = SessionManagementService.createUserMessageForDatabase(
                {
                    content: messageContent,
                    files,
                    isPdf,
                    isMultiplePdfs,
                    customText,
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

            // ========================= MIXED CONTENT: QUESTION ANALYSIS =========================
            let questionOnlyResponses: string[] = [];

            if (isMixedContent) {


                // Find question-only images and generate AI responses for them
                const questionOnlyImages = standardizedPages.filter((page, index) =>
                    allClassificationResults[index]?.result?.category === "questionOnly"
                );

                if (questionOnlyImages.length > 0) {
                    questionOnlyResponses = await Promise.all(
                        questionOnlyImages.map(async (page, index) => {
                            const originalIndex = standardizedPages.indexOf(page);
                            const questionText = classificationResult.questions[originalIndex]?.text || '';

                            const response = await MarkingServiceLocator.generateChatResponse(
                                page.imageData,
                                questionText,
                                actualModel as ModelType,
                                "questionOnly", // category
                                false // debug
                            );

                            return `## Question Analysis (${page.originalFileName})\n\n${response.response}`;
                        })
                    );

                    console.log(`✅ [MIXED CONTENT] Generated ${questionOnlyResponses.length} question-only responses`);
                }
            }

            // Create AI message for database
            const resolvedAIMessageId = handleAIMessageIdForEndpoint({ model: actualModel }, null, 'marking');

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

            dbAiMessage = SessionManagementService.createAIMessageForDatabase({
                allQuestionResults,
                finalAnnotatedOutput,
                files,
                actualModel,
                startTime,
                markingSchemesMap,
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
                gradeBoundaries: gradeBoundaries
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
                files,
                usageTokens: totalLLMTokens,
                model: actualModel
            };

            // Add API request count to context
            const apiRequestCounts = usageTracker.getRequestCounts();
            markingContext.apiRequests = usageTracker.getTotalRequests();
            markingContext.apiRequestBreakdown = apiRequestCounts;

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
