/**
 * Question Mode Handler Service
 * Handles question-only mode processing: detection, AI responses, and database persistence
 */

import type { Response } from 'express';
import type { ModelType } from '../../types/index.js';
import type { StandardizedPage } from '../../types/markingRouter.js';
import { questionDetectionService } from './questionDetectionService.js';
import { extractQuestionsFromClassification } from './MarkingHelpers.js';
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
    logStep
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
  }): Promise<QuestionModeResult> {
    console.log(`📚 [QUESTION MODE] Processing ${standardizedPages.length} question-only image(s)`);

    // Step 1: Enhanced Question Detection for Multiple Questions
    sendSseUpdate(res, createProgressData(4, 'Detecting question types...', MULTI_IMAGE_STEPS));
    const logQuestionDetectionComplete = logStep('Question Detection', 'question-detection');

    // Extract individual questions from classification result
    const individualQuestions = extractQuestionsFromClassification(classificationResult, standardizedPages[0]?.originalFileName);

    // Detect each question individually to get proper exam data and marking schemes
    const allQuestionDetections = await Promise.all(
      individualQuestions.map(async (question, index) => {
        const detection = await questionDetectionService.detectQuestion(question.text, question.questionNumber);
        return {
          questionIndex: index,
          questionText: question.text,
          detection: detection,
          sourceImageIndex: classificationResult.questions[index]?.sourceImageIndex ?? index
        };
      })
    );

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
        markingScheme: qd.detection.markingScheme || '',
        questionIndex: qd.questionIndex,
        sourceImageIndex: qd.sourceImageIndex
      });
      examPaper.totalMarks += qd.detection.match?.marks || 0;
    });

    // Convert to array and determine if multiple exam papers
    const examPapers = Array.from(examPaperGroups.values());
    const multipleExamPapers = examPapers.length > 1;

    // Create enhanced question detection result
    const questionDetection = {
      found: allQuestionDetections.some(qd => qd.detection.found),
      multipleExamPapers,
      examPapers,
      totalMarks: allQuestionDetections.reduce((sum, qd) => sum + (qd.detection.match?.marks || 0), 0),
      // Legacy fields for backward compatibility (removed unnecessary fields: questionIndex, sourceImageIndex)
      multipleQuestions: allQuestionDetections.length > 1,
      questions: allQuestionDetections.map(qd => {
        // Use database question text if available, fallback to classification text
        const questionText = qd.detection.match?.databaseQuestionText || qd.questionText;

        // markingScheme must be plain text (fail-fast for old format)
        let markingSchemePlainText = '';
        if (qd.detection.markingScheme) {
          if (typeof qd.detection.markingScheme !== 'string') {
            throw new Error(`[LEGACY QUESTIONS ARRAY] Invalid marking scheme format for Q${qd.detection.match?.questionNumber || '?'}: expected plain text string, got ${typeof qd.detection.markingScheme}. Please clear old data and create new sessions.`);
          }
          // Fail-fast if it looks like JSON (old format)
          if (qd.detection.markingScheme.trim().startsWith('{') || qd.detection.markingScheme.trim().startsWith('[')) {
            throw new Error(`[LEGACY QUESTIONS ARRAY] Invalid marking scheme format for Q${qd.detection.match?.questionNumber || '?'}: expected plain text, got JSON. Please clear old data and create new sessions.`);
          }
          markingSchemePlainText = qd.detection.markingScheme;
        }

        return {
          questionNumber: qd.detection.match?.questionNumber || '',
          questionText: questionText,
          marks: qd.detection.match?.marks || 0,
          markingScheme: markingSchemePlainText,
          examBoard: qd.detection.match?.board || '',
          examCode: qd.detection.match?.paperCode || '',
          paperTitle: qd.detection.match ? `${qd.detection.match.board} ${qd.detection.match.qualification} ${qd.detection.match.paperCode} (${qd.detection.match.examSeries})` : '',
          subject: qd.detection.match?.qualification || '',
          tier: qd.detection.match?.tier || '',
          examSeries: qd.detection.match?.examSeries || ''
        };
      })
    };

    logQuestionDetectionComplete();

    // Step 2: Enhanced AI Response Generation for Multiple Questions
    sendSseUpdate(res, createProgressData(6, 'Generating responses...', MULTI_IMAGE_STEPS));
    const logAiResponseComplete = logStep('AI Response Generation', actualModel);
    const { MarkingServiceLocator } = await import('./MarkingServiceLocator.js');

    // Generate AI responses for each question individually
    const aiResponses = await Promise.all(
      allQuestionDetections.map(async (qd, index) => {
        const imageData = standardizedPages[qd.sourceImageIndex]?.imageData || standardizedPages[0].imageData;
        const response = await MarkingServiceLocator.generateChatResponse(
          imageData,
          qd.questionText,
          actualModel as ModelType,
          "questionOnly", // category
          false // debug
        );
        return {
          questionIndex: index,
          questionNumber: qd.detection.match?.questionNumber || `Q${index + 1}`,
          response: response.response,
          apiUsed: response.apiUsed,
          usageTokens: response.usageTokens
        };
      })
    );

    // Debug logging for multi-question responses
    console.log(`🔍 [QUESTION MODE] Generated ${aiResponses.length} individual AI responses:`);
    aiResponses.forEach((ar, index) => {
      console.log(`  ${index + 1}. ${ar.questionNumber}: ${ar.response.substring(0, 100)}...`);
    });

    // Combine all responses into a single comprehensive response with clear separation
    const combinedResponse = aiResponses.map(ar =>
      `## ${ar.questionNumber}\n\n${ar.response}`
    ).join('\n\n' + '='.repeat(50) + '\n\n');

    const aiResponse = {
      response: combinedResponse,
      apiUsed: aiResponses[0]?.apiUsed || 'Unknown',
      usageTokens: aiResponses.reduce((sum, ar) => sum + (ar.usageTokens || 0), 0) + (classificationResult.usageTokens || 0)
    };

    logAiResponseComplete();

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
          sessionId: req.body.sessionId || submissionId,
          model: req.body.model || 'auto'
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

    // Send final result
    const finalResult: QuestionModeResult = {
      success: true,
      message: aiMessage,
      sessionId: submissionId,
      mode: 'Question',
      unifiedSession: unifiedSession // Include unified session data for both user types
    };

    // Send final result with completion flag
    const finalProgressData = createProgressData(7, 'Complete!', MULTI_IMAGE_STEPS);
    finalProgressData.isComplete = true;
    sendSseUpdate(res, finalProgressData);

    // Send completion event in the format expected by frontend
    const completionEvent = {
      type: 'complete',
      result: finalResult
    };
    res.write(`data: ${JSON.stringify(completionEvent)}\n\n`);
    res.end();

    return finalResult;
  }
}

