/**
 * Question Mode Handler Service
 * Handles question-only mode processing: detection, AI responses, and database persistence
 */

import type { Response } from 'express';
import type { ModelType } from '../../types/index.js';
import type { StandardizedPage } from '../../types/markingRouter.js';

import { extractQuestionsFromClassification, convertMarkingSchemeToPlainText } from './MarkingHelpers.js';
import { MarkingSchemeOrchestrationService } from './MarkingSchemeOrchestrationService.js';
import { getSuggestedFollowUps } from './MarkingHelpers.js';
import { createAIMessage } from '../../utils/messageUtils.js';
import { calculateMessageProcessingStats } from '../../utils/messageUtils.js';
import { sendSseUpdate, createProgressData } from '../../utils/sseUtils.js';
import { SessionManagementService } from '../sessionManagementService.js';
import type { QuestionSessionContext } from '../../types/sessionManagement.js';
import type { Express } from 'express-serve-static-core';

const MULTI_IMAGE_STEPS = [
  'Input Validation',
  'Standardization',
  'Preprocessing',
  'OCR & Classification',
  'Question Detection',
  'Segmentation',
  'Marking',
  'Output Generation'
];

export interface QuestionModeResult {
  success: boolean;
  message: any;
  sessionId: string;
  mode: 'Question';
  unifiedSession: any;
}

export class QuestionModeHandlerService {
  /**
   * Handle question mode processing
   */
  static async handleQuestionMode({
    classificationResult,
    standardizedPages,
    files,
    actualModel,
    userId,
    submissionId,
    req,
    res,
    startTime,
    logStep,
    usageTracker,  // Add tracker parameter
    suppressSseCompletion = false  // Skip SSE completion in mixed mode
  }: {
    classificationResult: any;
    standardizedPages: StandardizedPage[];
    files: Express.Multer.File[];
    actualModel: string;
    userId: string | null;
    submissionId: string;
    req: any;
    res: Response;
    startTime: number;
    logStep: (stepName: string, modelInfo: string) => () => void;
    usageTracker?: any;  // Add tracker type
    suppressSseCompletion?: boolean;  // Optional flag for mixed mode
  }): Promise<QuestionModeResult> {
    console.log(`📚 [QUESTION MODE] Processing ${standardizedPages.length} question-only image(s)`);

    // Step 1: Enhanced Question Detection for Multiple Questions
    sendSseUpdate(res, createProgressData(4, 'Detecting question types...', MULTI_IMAGE_STEPS));
    const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');

    // Extract individual questions from classification result
    let individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);


    // Use unified orchestration service (same as Marking Mode)
    const orchestrationResult = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
      individualQuestions,
      classificationResult
    );

    const { detectionStats, detectionResults } = orchestrationResult;

    // Log detection statistics
    MarkingSchemeOrchestrationService.logDetectionStatistics(detectionStats);

    // Map orchestration results to Question Mode format
    const allQuestionDetections = detectionResults.map((dr, index) => ({
      questionIndex: index,
      questionText: dr.question.text,
      classificationQuestionNumber: dr.question.questionNumber, // Preserve original classification Q# (e.g., "9i", "9ii", "19ai")
      detection: dr.detectionResult,
      sourceImageIndex: dr.question.sourceImageIndex ?? index
    }));

    // Group questions by exam paper (board + code + year + tier)
    const examPaperGroups = new Map<string, any>();

    allQuestionDetections.forEach(qd => {
      const examBoard = qd.detection.match?.board || '';
      const examCode = qd.detection.match?.paperCode || '';
      const examSeries = qd.detection.match?.examSeries || '';
      const tier = qd.detection.match?.tier || '';

      // Create unique key for exam paper grouping
      const examPaperKey = `${examBoard}_${examCode}_${examSeries}_${tier}`;

      if (!examPaperGroups.has(examPaperKey)) {
        examPaperGroups.set(examPaperKey, {
          examBoard,
          examCode,
          examSeries,
          tier,
          subject: qd.detection.match?.qualification || '',
          paperTitle: qd.detection.match ? `${qd.detection.match.board} ${qd.detection.match.qualification} ${qd.detection.match.paperCode} (${qd.detection.match.examSeries})` : '',
          questions: [],
          totalMarks: 0
        });
      }

      const examPaper = examPaperGroups.get(examPaperKey);
      examPaper.questions.push({
        questionNumber: qd.detection.match?.questionNumber || '',
        questionText: qd.questionText,
        marks: qd.detection.match?.marks || 0,
        markingScheme: qd.detection.match?.markingScheme || '',
        questionIndex: qd.questionIndex,
        sourceImageIndex: qd.sourceImageIndex
      });
      examPaper.totalMarks += qd.detection.match?.marks || 0;
    });

    // Convert to array and determine if multiple exam papers
    const examPapers = Array.from(examPaperGroups.values());
    const multipleExamPapers = examPapers.length > 1;

    // SMART DEDUPLICATION
    // Goal: Merge over-split questions (Q10a,b,c → Q10) while preserving genuine sub-questions (Q9i,ii,iii)
    // 
    // Strategy:
    // 1. Group by base question number (10a, 10b, 10c → "10")
    // 2. For each group, check if ALL parts matched to SAME database question using FALLBACK (low similarity ~0.700)
    // 3. If yes → merge into ONE question (mapper over-split)
    // 4. If no → keep separate (genuine sub-questions with high similarity to database)

    // Group questions by base number
    const questionsByBaseNumber = new Map<string, typeof allQuestionDetections>();
    allQuestionDetections.forEach(qd => {
      const baseNumber = qd.classificationQuestionNumber?.replace(/[a-z]+$/i, '') || 'unknown';
      if (!questionsByBaseNumber.has(baseNumber)) {
        questionsByBaseNumber.set(baseNumber, []);
      }
      questionsByBaseNumber.get(baseNumber)!.push(qd);
    });

    const deduplicatedDetections: typeof allQuestionDetections = [];

    for (const [baseNumber, questions] of questionsByBaseNumber.entries()) {
      if (questions.length === 1) {
        // Single question, no deduplication needed
        deduplicatedDetections.push(questions[0]);
        continue;
      }

      // Multiple parts - check if they should be merged
      const allMatchedToSameDbQuestion = questions.every(q =>
        q.detection.found &&
        q.detection.match?.questionNumber === questions[0].detection.match?.questionNumber
      );

      // Check if all used fallback (low similarity, typically 0.700-0.800)
      const allUsedFallback = questions.every(q =>
        q.detection.match?.confidence !== undefined &&
        q.detection.match.confidence < 0.85 // Threshold to detect fallback
      );

      const shouldMerge = allMatchedToSameDbQuestion && allUsedFallback;

      if (shouldMerge) {
        // MERGE: Mapper over-split (e.g., Q10a, Q10b, Q10c → Q10)
        const mergedQuestion = {
          ...questions[0],
          // Use base number without suffix for merged questions
          classificationQuestionNumber: baseNumber,
          // Combine question texts with line breaks
          questionText: questions.map(q => q.questionText).join('\n\n')
        };
        deduplicatedDetections.push(mergedQuestion);
      } else {
        // KEEP SEPARATE: Genuine sub-questions (e.g., Q9i, Q9ii, Q9iii)
        deduplicatedDetections.push(...questions);
      }
    }




    // Create enhanced question detection result
    const questionDetection = {
      found: deduplicatedDetections.some(qd => qd.detection.found),
      multipleExamPapers,
      examPapers,
      totalMarks: deduplicatedDetections.reduce((sum, qd) => sum + (qd.detection.match?.marks || 0), 0),
      // Legacy fields for backward compatibility (removed unnecessary fields: questionIndex, sourceImageIndex)
      multipleQuestions: deduplicatedDetections.length > 1,
      questions: deduplicatedDetections.map(qd => {
        // Use database question text if available, fallback to classification text
        const questionText = qd.detection.match?.databaseQuestionText || qd.questionText;

        // Extract marking scheme and convert to plain text if needed
        let markingSchemePlainText = '';
        if (qd.detection.match?.markingScheme) {
          const scheme = qd.detection.match.markingScheme;
          if (typeof scheme === 'string') {
            markingSchemePlainText = scheme;
          } else {
            // Convert object to plain text
            markingSchemePlainText = convertMarkingSchemeToPlainText(scheme, qd.detection.match.questionNumber || '');
          }
        }

        return {
          // Use CLASSIFICATION question number (e.g., "9i", "9ii") instead of database match (e.g., "9")
          // This preserves the sub-question structure in the AI response
          questionNumber: qd.classificationQuestionNumber || qd.detection.match?.questionNumber || `${qd.questionIndex + 1}`,
          questionText: questionText,
          marks: qd.detection.match?.marks || 0,
          markingScheme: markingSchemePlainText,
          examBoard: qd.detection.match?.board || '',
          examCode: qd.detection.match?.paperCode || '',
          paperTitle: qd.detection.match ? `${qd.detection.match.board} ${qd.detection.match.qualification} ${qd.detection.match.paperCode} (${qd.detection.match.examSeries})` : '',
          subject: qd.detection.match?.qualification || '',
          tier: qd.detection.match?.tier || '',
          examSeries: qd.detection.match?.examSeries || '',
          sourceImageIndex: qd.sourceImageIndex
        };
      })
    };

    logQuestionDetectionComplete();

    // Step 2: Enhanced AI Response Generation for Multiple Questions
    sendSseUpdate(res, createProgressData(6, 'Generating responses...', MULTI_IMAGE_STEPS));
    const logAiResponseComplete = logStep('AI Response Generation', actualModel);
    const { MarkingServiceLocator } = await import('./MarkingServiceLocator.js');

    // GROUP SUB-QUESTIONS by main question before AI generation
    // This preserves nested structure and reduces API calls
    // Example: Q9i, Q9ii, Q9iii → ONE request for Q9 with all parts

    const groupedQuestions = new Map<string, typeof questionDetection.questions>();
    questionDetection.questions.forEach(q => {
      // Extract base number (e.g., "9i" → "9", "19ai" → "19")
      const baseNumber = q.questionNumber.toString().replace(/[a-z()]+$/i, '');

      if (!groupedQuestions.has(baseNumber)) {
        groupedQuestions.set(baseNumber, []);
      }
      groupedQuestions.get(baseNumber)!.push(q);
    });



    // Generate AI responses for each MAIN question (with all sub-parts combined)
    const aiResponses = await Promise.all(
      Array.from(groupedQuestions.entries()).map(async ([baseNumber, subQuestions], groupIndex) => {
        const isGrouped = subQuestions.length > 1;

        // Combine question texts and marking schemes for grouped questions
        const combinedQuestionText = isGrouped
          ? subQuestions.map((sq, idx) => {
            // Extract sub-part label (e.g., "9i" → "i", "19ai" → "ai")
            const subPart = sq.questionNumber.toString().replace(baseNumber, '');
            const label = subPart ? `(${subPart})` : '';
            return `${label ? label + ' ' : ''}${sq.questionText}`;
          }).join('\n\n')
          : subQuestions[0].questionText;

        const combinedMarkingScheme = isGrouped
          ? subQuestions.map(sq => sq.markingScheme).filter(ms => ms).join('\n\n')
          : subQuestions[0].markingScheme;

        // Determine display question number
        // - If grouped (Q9i, Q9ii, Q9iii), show as "9(i, ii, iii)"
        // - If single question with suffix (Q1a alone), strip suffix to show "1" (mapper error)
        // - If single question without suffix (Q2), keep as "2"
        const mainQuestionNumber = isGrouped
          ? `${baseNumber}(${subQuestions.map(sq => sq.questionNumber.toString().replace(baseNumber, '')).join(', ')})`
          : baseNumber; // Use base number without suffix for single questions



        const response = await MarkingServiceLocator.generateChatResponse(
          combinedQuestionText,
          combinedQuestionText,
          actualModel as ModelType,
          "questionOnly",
          false, // debug
          undefined, // onProgress
          false, // useOcrText
          usageTracker,
          combinedMarkingScheme
        );

        // POST-PROCESS: Insert blank lines after marking codes for visual separation
        const formattedResponse = response.response
          .replace(/(\[M\d+(?:dep)?\])/g, '$1\n\n')  // [M1], [M1dep], [M2], etc.
          .replace(/(\[A\d+\])/g, '$1\n\n')          // [A1], [A2], etc.
          .replace(/(\[B\d+\])/g, '$1\n\n');         // [B1], [B2], etc.

        return {
          questionIndex: groupIndex,
          questionNumber: mainQuestionNumber,
          response: formattedResponse,
          apiUsed: response.apiUsed,
          usageTokens: response.usageTokens,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          isGrouped,
          subQuestions: isGrouped ? subQuestions.map(sq => sq.questionNumber) : undefined
        };
      })
    );

    // Combine all responses into a single comprehensive response with clear separation
    const combinedResponse = aiResponses.map((ar, index) =>
      `Question ${ar.questionNumber}\n\n${ar.response}`
    ).join('\n\n' + '_'.repeat(80) + '\n\n');

    const aiResponse = {
      response: combinedResponse,
      apiUsed: aiResponses[0]?.apiUsed || 'Unknown',
      usageTokens: aiResponses.reduce((sum, ar) => sum + (ar.usageTokens || 0), 0) + (classificationResult.usageTokens || 0)
    };

    logAiResponseComplete();

    // Log usage tracker summary (tokens, confidence, image size)
    if (usageTracker) {
      console.log(usageTracker.getSummary(actualModel, 0)); // 0 mathpix calls in question mode
    }


    // Generate suggested follow-ups (same as marking mode)
    const suggestedFollowUps = await getSuggestedFollowUps();

    // Complete progress
    sendSseUpdate(res, createProgressData(7, 'Question analysis complete!', MULTI_IMAGE_STEPS));

    // Create AI message for question mode with real processing stats
    const globalQuestionText = classificationResult?.questions && classificationResult.questions.length > 0
      ? classificationResult.questions[0].text
      : classificationResult?.extractedQuestionText;

    const realProcessingStats = calculateMessageProcessingStats(
      aiResponse,
      actualModel,
      Date.now() - startTime,
      [], // No annotations in question mode - no annotation means question mode
      standardizedPages[0].imageData.length,
      [] // No question results in question mode
    );

    // Transform question detection result to match frontend DetectedQuestion structure
    const transformedDetectedQuestion = questionDetection ? {
      found: questionDetection.found,
      multipleExamPapers: questionDetection.multipleExamPapers,
      multipleQuestions: questionDetection.multipleQuestions,
      totalMarks: questionDetection.totalMarks,
      examPapers: questionDetection.examPapers
    } : undefined;

    const aiMessage = createAIMessage({
      content: aiResponse.response,
      imageDataArray: undefined, // No annotation means question mode - no image data returned to frontend
      progressData: {
        currentStepDescription: 'Question analysis complete',
        allSteps: MULTI_IMAGE_STEPS,
        currentStepIndex: 7,
        isComplete: true
      },
      suggestedFollowUps: suggestedFollowUps,
      processingStats: realProcessingStats,
      detectedQuestion: transformedDetectedQuestion // FIXED: Include transformed detected question for exam paper tab display
    });

    // ========================= DATABASE PERSISTENCE FOR QUESTION MODE =========================
    let persistenceResult: any = null;
    let userMessage: any = null;
    try {
      // Upload original files for authenticated users
      const uploadResult = await SessionManagementService.uploadOriginalFiles(
        files,
        userId || 'anonymous',
        submissionId,
        !!userId
      );

      // Create structured data
      const { structuredImageDataArray } = SessionManagementService.createStructuredData(
        files,
        false, // isPdf
        false, // isMultiplePdfs
        undefined // pdfContext
      );

      // Create user message for question mode
      userMessage = SessionManagementService.createUserMessageForDatabase(
        {
          content: `I have uploaded 1 file(s) for analysis.`,
          files,
          isPdf: false,
          isMultiplePdfs: false,
          sessionId: req.body?.sessionId || submissionId,
          model: req.body?.model || 'auto'
        },
        structuredImageDataArray,
        undefined, // structuredPdfContexts
        uploadResult.originalImageLinks
      );

      // Override timestamp for database consistency (same as marking mode)
      const userTimestamp = new Date(Date.now() - 1000).toISOString(); // User message 1 second earlier
      const aiTimestamp = new Date().toISOString(); // AI message current time
      (userMessage as any).timestamp = userTimestamp;
      (aiMessage as any).timestamp = aiTimestamp;

      // Persist question session
      const questionContext: QuestionSessionContext = {
        req,
        submissionId,
        startTime,
        userMessage,
        aiMessage,
        questionDetection,
        globalQuestionText: globalQuestionText || '',
        mode: 'Question'
      };
      persistenceResult = await SessionManagementService.persistQuestionSession(questionContext);

      // Update the AI message with session data
      (aiMessage as any).sessionId = persistenceResult.sessionId;

    } catch (dbError) {
      console.error('❌ [QUESTION MODE] Database persistence failed:', dbError);
      // Continue with response even if database fails
    }

    // Create unifiedSession for unauthenticated users (same as marking mode)
    const isAuthenticated = !!(req as any)?.user?.uid;
    let unifiedSession = persistenceResult?.unifiedSession;

    if (!isAuthenticated && !unifiedSession) {
      // For unauthenticated users, create a temporary session structure
      unifiedSession = SessionManagementService.createUnauthenticatedSession(
        submissionId,
        userMessage,
        aiMessage,
        [], // No question results in question mode
        startTime,
        actualModel,
        files,
        'Question'
      );
    }

    // Add questionResponses to unifiedSession for mixed mode
    // This allows MarkingPipeline to combine questionOnly responses with marking results
    if (unifiedSession) {
      unifiedSession.questionResponses = aiResponses.map((ar: any) => ({
        questionNumber: ar.questionNumber,
        questionText: questionDetection.questions[ar.questionIndex]?.questionText || '',
        response: ar.response,
        apiUsed: ar.apiUsed,
        usageTokens: ar.usageTokens
      }));
    }

    // Send final result
    const finalResult: QuestionModeResult = {
      success: true,
      message: aiMessage,
      sessionId: submissionId,
      mode: 'Question',
      unifiedSession: unifiedSession // Include unified session data for both user types
    };

    // Send final result with completion flag (skip in mixed mode)
    if (!suppressSseCompletion) {
      const finalProgressData = createProgressData(7, 'Complete!', MULTI_IMAGE_STEPS);
      finalProgressData.isComplete = true;
      sendSseUpdate(res, finalProgressData);

      // Send completion event in the format expected by frontend
      const completionEvent = {
        type: 'complete',
        result: finalResult
      };
      res.write(`data: ${JSON.stringify(completionEvent)}\n\n`);
    } else {
      console.log('   [MIXED MODE] Suppressed SSE completion - MarkingPipeline will send combined result');
    }
    // Don't call res.end() here - let Pipeline/Aggregator handle response ending

    return finalResult;
  }
}

