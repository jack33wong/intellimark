/**
 * Session Management Service
 * Handles all session-related operations for marking and question modes
 * Extracted from markingRouter.ts for better maintainability
 */

import type { Request } from 'express';
import { generateSessionTitle } from '../utils/markingRouterHelpers.js';
import { createUserMessage, createAIMessage, calculateMessageProcessingStats, calculateSessionStats } from '../utils/messageUtils.js';
import { ImageStorageService } from './imageStorageService.js';
import type { 
  SessionContext, 
  MarkingSessionContext, 
  QuestionSessionContext, 
  SessionResult, 
  SessionStats, 
  CreateSessionData 
} from '../types/sessionManagement.js';
import type { QuestionResult } from './marking/MarkingExecutor.js';
import type { Express } from 'express';

// Interfaces moved from DatabasePersistenceService
export interface FileUploadResult {
  originalImageLinks: string[];
  structuredImageDataArray?: Array<{ url: string; originalFileName: string; fileSize: number }>;
  structuredPdfContexts?: Array<{ url: string; originalFileName: string; fileSize: number }>;
}

export interface UserMessageData {
  content: string;
  files: Express.Multer.File[];
  isPdf: boolean;
  isMultiplePdfs: boolean;
  customText?: string;
  sessionId: string;
  model: string;
  pdfContext?: any;
}

export interface AIMessageData {
  allQuestionResults: QuestionResult[];
  finalAnnotatedOutput: string[];
  files: Express.Multer.File[];
  actualModel: string;
  startTime: number;
  markingSchemesMap: Map<string, any>;
  globalQuestionText: string;
  resolvedAIMessageId: string;
}

export class SessionManagementService {
  /**
   * Persist marking session to database
   */
  static async persistMarkingSession(context: MarkingSessionContext): Promise<SessionResult> {
    const { FirestoreService } = await import('../services/firestoreService.js');
    
    // Extract request data
    const userId = (context.req as any)?.user?.uid || 'anonymous';
    const userEmail = (context.req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(context.req as any)?.user?.uid;
    const sessionId = context.req.body.sessionId || context.submissionId;
    const currentSessionId = sessionId.startsWith('temp-') ? context.submissionId : sessionId;
    
    // Create database AI message with detected question data
    const dbAiMessage = this.prepareMarkingAiMessage(context);
    
    // Generate session title
    const sessionTitle = this.generateMarkingSessionTitle(context);
    
    // Persist to database for authenticated users
    if (isAuthenticated) {
      await this.persistAuthenticatedSession(
        FirestoreService,
        currentSessionId,
        sessionTitle,
        userId,
        context,
        dbAiMessage
      );
    }
    
    // Create unified session data for frontend
    const unifiedSession = isAuthenticated ? this.createUnifiedSessionData(
      currentSessionId,
      sessionTitle,
      userId,
      context,
      dbAiMessage
    ) : undefined;
    
    return {
      sessionId: currentSessionId,
      sessionTitle,
      unifiedSession
    };
  }

  /**
   * Persist question session to database
   */
  static async persistQuestionSession(context: QuestionSessionContext): Promise<SessionResult> {
    const { FirestoreService } = await import('../services/firestoreService.js');
    
    // Extract request data
    const userId = (context.req as any)?.user?.uid || 'anonymous';
    const userEmail = (context.req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(context.req as any)?.user?.uid;
    const sessionId = context.req.body.sessionId || context.submissionId;
    const currentSessionId = sessionId.startsWith('temp-') ? context.submissionId : sessionId;
    
    // Create database AI message with detected question data
    const dbAiMessage = this.prepareQuestionAiMessage(context);
    
    // Generate session title
    const sessionTitle = generateSessionTitle(context.questionDetection);
    
    // Persist to database for authenticated users
    if (isAuthenticated) {
      await this.persistAuthenticatedSession(
        FirestoreService,
        currentSessionId,
        sessionTitle,
        userId,
        context,
        dbAiMessage
      );
    }
    
    // Create unified session data for frontend
    const unifiedSession = isAuthenticated ? this.createUnifiedSessionData(
      currentSessionId,
      sessionTitle,
      userId,
      context,
      dbAiMessage
    ) : undefined;
    
    return {
      sessionId: currentSessionId,
      sessionTitle,
      unifiedSession
    };
  }

  /**
   * Prepare AI message for marking mode
   */
  private static prepareMarkingAiMessage(context: MarkingSessionContext): any {
    const dbAiMessage = { ...context.aiMessage };
    
    if (context.markingSchemesMap) {
      const allQuestionNumbers = Array.from(context.markingSchemesMap.keys());
      const totalMarks = Array.from(context.markingSchemesMap.values()).reduce((sum, scheme) => sum + (scheme.totalMarks || 0), 0);
      const firstQuestionScheme = allQuestionNumbers.length > 0 ? context.markingSchemesMap.get(allQuestionNumbers[0]) : null;
      
      if (firstQuestionScheme && allQuestionNumbers.length > 0) {
        const questionNumberDisplay = allQuestionNumbers.length > 1 
          ? allQuestionNumbers.join(', ') 
          : allQuestionNumbers[0];
        
      } else {
      }
    }
    
    return dbAiMessage;
  }

  /**
   * Prepare AI message for question mode
   */
  private static prepareQuestionAiMessage(context: QuestionSessionContext): any {
    const dbAiMessage = { ...context.aiMessage };
    
    if (context.questionDetection?.found) {
    } else {
    }
    
    return dbAiMessage;
  }

  /**
   * Generate session title for marking mode
   */
  private static generateMarkingSessionTitle(context: MarkingSessionContext): string {
    if (context.markingSchemesMap) {
      const allQuestionNumbers = Array.from(context.markingSchemesMap.keys());
      const totalMarks = Array.from(context.markingSchemesMap.values()).reduce((sum, scheme) => sum + (scheme.totalMarks || 0), 0);
      const firstQuestionScheme = allQuestionNumbers.length > 0 ? context.markingSchemesMap.get(allQuestionNumbers[0]) : null;
      
      if (allQuestionNumbers.length > 0 && firstQuestionScheme) {
        const questionNumberDisplay = allQuestionNumbers.length > 1 
          ? allQuestionNumbers.join(', ') 
          : allQuestionNumbers[0];
        
        // Use actual exam board data from question detection
        const firstQuestionDetection = firstQuestionScheme.questionDetection;
        if (firstQuestionDetection?.match) {
          const { board, qualification, paperCode, year, tier } = firstQuestionDetection.match;
          return `${board} ${qualification} ${paperCode} (${year}) Q${questionNumberDisplay} ${totalMarks} marks`;
        }
      }
    }
    
    return generateSessionTitle(null);
  }

  /**
   * Persist session for authenticated users
   */
  private static async persistAuthenticatedSession(
    FirestoreService: any,
    currentSessionId: string,
    sessionTitle: string,
    userId: string,
    context: SessionContext,
    dbAiMessage: any
  ): Promise<void> {
    if (context.req.body.sessionId && !context.req.body.sessionId.startsWith('temp-')) {
      // Check if session exists before trying to add messages
      try {
        const sessionExists = await FirestoreService.getUnifiedSession(currentSessionId);
        if (sessionExists) {
          // Adding to existing session
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, context.userMessage);
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, dbAiMessage);
        } else {
          // Session doesn't exist, create new one
          console.log(`🔍 [PERSISTENCE] Session ${currentSessionId} not found, creating new session`);
          await this.createNewSession(FirestoreService, currentSessionId, sessionTitle, userId, context, dbAiMessage);
        }
      } catch (error) {
        console.error(`❌ [PERSISTENCE] Error checking session existence:`, error);
        // Fallback: create new session
        await this.createNewSession(FirestoreService, currentSessionId, sessionTitle, userId, context, dbAiMessage);
      }
    } else {
      // Creating new session
      await this.createNewSession(FirestoreService, currentSessionId, sessionTitle, userId, context, dbAiMessage);
    }
  }

  /**
   * Create new session in database
   */
  private static async createNewSession(
    FirestoreService: any,
    currentSessionId: string,
    sessionTitle: string,
    userId: string,
    context: SessionContext,
    dbAiMessage: any
  ): Promise<void> {
    const sessionStats = this.createSessionStats(context);
    
    await FirestoreService.createUnifiedSessionWithMessages({
      sessionId: currentSessionId,
      title: sessionTitle,
      userId: userId,
      messageType: context.mode,
      messages: [context.userMessage, dbAiMessage],
      isPastPaper: false,
      sessionStats
    });
  }

  /**
   * Create session statistics using calculateSessionStats
   */
  private static createSessionStats(context: SessionContext): SessionStats {
    const additionalData = (context as any).allQuestionResults ? context as MarkingSessionContext : null;
    
    if (additionalData) {
      // For marking mode, use calculateSessionStats with allQuestionResults
      return calculateSessionStats(
        additionalData.allQuestionResults,
        Date.now() - context.startTime,
        additionalData.model || 'auto',
        additionalData.files || []
      );
    } else {
      // For question mode, use calculateSessionStats with empty results
      return calculateSessionStats(
        [], // No question results in question mode
        Date.now() - context.startTime,
        'auto',
        []
      );
    }
  }

  /**
   * Get real model name from model type
   */
  private static getRealModelName(modelType: string): string {
    if (modelType === 'auto') {
      return 'gemini-2.5-flash'; // Default model for auto
    }
    return modelType; // Return the actual model name
  }

  /**
   * Get real API name from model
   */
  private static getRealApiName(modelName: string): string {
    if (modelName.includes('gemini')) {
      return 'Google Gemini API';
    }
    // Add other API mappings as needed
    return 'Unknown API';
  }

  /**
   * Create unified session data for frontend
   */
  private static createUnifiedSessionData(
    currentSessionId: string,
    sessionTitle: string,
    userId: string,
    context: SessionContext,
    dbAiMessage: any
  ): any {
    const additionalData = (context as any).allQuestionResults ? context as MarkingSessionContext : null;
    
    return {
      id: currentSessionId,
      title: sessionTitle,
      messages: [context.userMessage, dbAiMessage],
      userId: userId,
      messageType: context.mode,
      createdAt: context.userMessage.timestamp,
      updatedAt: dbAiMessage.timestamp,
      isPastPaper: false,
      sessionStats: this.createSessionStats(context)
    };
  }

  // ============================================================================
  // METHODS MOVED FROM DatabasePersistenceService
  // ============================================================================

  /**
   * Upload original files to Firebase Storage for authenticated users
   */
  static async uploadOriginalFiles(
    files: Express.Multer.File[],
    userId: string,
    submissionId: string,
    isAuthenticated: boolean
  ): Promise<FileUploadResult> {
    const result: FileUploadResult = {
      originalImageLinks: []
    };

    if (!isAuthenticated) {
      return result; // No upload needed for unauthenticated users
    }

    try {
      const uploadPromises = files.map(async (file, index) => {
        try {
          const imageLink = await ImageStorageService.uploadImage(
            file.buffer.toString('base64'),
            userId,
            `multi-${submissionId}`,
            'original'
          );
          return imageLink;
        } catch (uploadError) {
          console.error(`❌ [UPLOAD] Failed to upload original file ${index}:`, uploadError);
          return file.buffer.toString('base64'); // Fallback to base64
        }
      });
      
      result.originalImageLinks = await Promise.all(uploadPromises);
    } catch (error) {
      console.error('❌ [UPLOAD] Failed to upload original files:', error);
    }

    return result;
  }

  /**
   * Create structured data for images and PDFs
   */
  static createStructuredData(
    files: Express.Multer.File[],
    isPdf: boolean,
    isMultiplePdfs: boolean,
    pdfContext?: any
  ): { structuredImageDataArray?: any[]; structuredPdfContexts?: any[] } {
    let structuredImageDataArray: any[] | undefined = undefined;
    let structuredPdfContexts: any[] | undefined = undefined;


    if (isPdf || isMultiplePdfs) {
      // For PDFs, use pdfContexts for all users
      if (pdfContext?.isMultiplePdfs && pdfContext.pdfContexts) {
        // Multiple PDFs case
        structuredPdfContexts = pdfContext.pdfContexts.map((ctx: any) => ({
          url: ctx.originalPdfDataUrl || ctx.originalPdfLink,
          originalPdfDataUrl: ctx.originalPdfDataUrl && ctx.originalPdfDataUrl.length < 1000000 ? ctx.originalPdfDataUrl : null, // Limit base64 size for Firestore
          originalPdfLink: ctx.originalPdfLink,
          originalFileName: ctx.originalFileName,
          fileSize: ctx.fileSize || ctx.fileSizeBytes || 0
        }));
      } else if (pdfContext && !pdfContext.isMultiplePdfs) {
        // Single PDF case
        structuredPdfContexts = [{
          url: pdfContext.originalPdfDataUrl || pdfContext.originalPdfLink,
          originalPdfDataUrl: pdfContext.originalPdfDataUrl,
          originalPdfLink: pdfContext.originalPdfLink,
          originalFileName: pdfContext.originalFileName,
          fileSize: pdfContext.fileSize || pdfContext.fileSizeBytes || 0
        }];
      } else {
        // Fallback: create from files directly
        structuredPdfContexts = files.map((file, index) => ({
          url: `data:application/pdf;base64,${file.buffer.toString('base64')}`,
          originalFileName: file.originalname || `document-${index + 1}.pdf`,
          fileSize: file.size
        }));
      }
      
    } else {
      // For images, use imageDataArray for all users
      if (files.length === 1) {
        structuredImageDataArray = [{
          url: files[0].buffer.toString('base64'), // Will be updated to Firebase URL for authenticated users
          originalFileName: files[0].originalname,
          fileSize: files[0].size
        }];
      } else {
        structuredImageDataArray = files.map(f => ({
          url: f.buffer.toString('base64'), // Will be updated to Firebase URL for authenticated users
          originalFileName: f.originalname,
          fileSize: f.size
        }));
      }
    }

    return { structuredImageDataArray, structuredPdfContexts };
  }

  /**
   * Update structured data with Firebase URLs for authenticated users
   */
  static updateStructuredDataWithFirebaseUrls(
    structuredImageDataArray: any[] | undefined,
    structuredPdfContexts: any[] | undefined,
    originalImageLinks: string[]
  ): void {
    if (structuredPdfContexts) {
      // For PDFs, update the URLs in pdfContexts
      structuredPdfContexts.forEach((ctx, index) => {
        if (originalImageLinks[index]) {
          ctx.url = originalImageLinks[index];
        }
      });
    } else if (structuredImageDataArray) {
      // For images, update the URLs in imageDataArray
      structuredImageDataArray.forEach((item, index) => {
        if (originalImageLinks[index]) {
          item.url = originalImageLinks[index];
        }
      });
    }
  }

  /**
   * Create user message for database
   */
  static createUserMessageForDatabase(
    userData: UserMessageData,
    structuredImageDataArray?: any[],
    structuredPdfContexts?: any[],
    originalImageLinks?: string[]
  ): any {
    const { content, files, isPdf, isMultiplePdfs, customText, sessionId, model, pdfContext } = userData;
    const isAuthenticated = !!originalImageLinks && originalImageLinks.length > 0;

    const dbUserMessage = createUserMessage({
      content,
      imageData: !isAuthenticated && files.length === 1 && !isPdf ? files[0].buffer.toString('base64') : undefined,
      imageDataArray: structuredImageDataArray,
      pdfContexts: structuredPdfContexts,
      sessionId,
      model,
      originalFileType: isPdf || isMultiplePdfs ? 'pdf' : undefined
    });

    // Add image links for authenticated users
    if (isAuthenticated && originalImageLinks) {
      if (files.length === 1) {
        (dbUserMessage as any).imageLink = originalImageLinks[0];
      } else {
        // Update structured data with Firebase URLs
        this.updateStructuredDataWithFirebaseUrls(
          structuredImageDataArray,
          structuredPdfContexts,
          originalImageLinks
        );
      }
    }

    return dbUserMessage;
  }

  /**
   * Create AI message for database
   */
  static createAIMessageForDatabase(
    aiData: AIMessageData
  ): any {
    const {
      allQuestionResults,
      finalAnnotatedOutput,
      files,
      actualModel,
      startTime,
      markingSchemesMap,
      globalQuestionText,
      resolvedAIMessageId
    } = aiData;

    // Calculate real processing stats for the AI message
    const totalAnnotations = allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0);
    const totalLlmTokens = allQuestionResults.reduce((sum, q) => sum + (q.usageTokens || 0), 0);
    const totalMathpixCalls = allQuestionResults.reduce((sum, q) => sum + (q.mathpixCalls || 0), 0);
    const mockAiResponse = { usageTokens: totalLlmTokens, confidence: 0.85 };

    const realProcessingStats = calculateMessageProcessingStats(
      mockAiResponse,
      actualModel,
      Date.now() - startTime,
      allQuestionResults.flatMap(q => q.annotations || []),
      files.reduce((sum, f) => sum + f.size, 0),
      allQuestionResults
    );

    // Create structured imageDataArray for AI message
    const structuredAiImageDataArray = finalAnnotatedOutput.map((annotatedImage, index) => ({
      url: annotatedImage,
      originalFileName: files[index]?.originalname || `annotated-image-${index + 1}.png`,
      fileSize: annotatedImage.length
    }));

    // Create detectedQuestion data from markingSchemesMap for frontend display
    const detectedQuestion = this.createDetectedQuestionFromMarkingSchemes(markingSchemesMap, globalQuestionText);

    const dbAiMessage = createAIMessage({
      content: 'Marking completed - see results below',
      messageId: resolvedAIMessageId,
      imageData: finalAnnotatedOutput.length === 1 ? finalAnnotatedOutput[0] : undefined,
      imageDataArray: structuredAiImageDataArray,
      progressData: {
        currentStepDescription: 'Marking completed',
        allSteps: ['Input Validation', 'Standardization', 'Preprocessing', 'OCR & Classification', 'Question Detection', 'Segmentation', 'Marking', 'Output Generation'],
        currentStepIndex: 7,
        isComplete: true
      },
      processingStats: realProcessingStats,
      suggestedFollowUps: [], // Will be populated by caller
      detectedQuestion: detectedQuestion
    });

    return dbAiMessage;
  }

  /**
   * Create unified session for unauthenticated users
   */
  static createUnauthenticatedSession(
    submissionId: string,
    userMessage: any,
    aiMessage: any,
    allQuestionResults: QuestionResult[],
    startTime: number,
    actualModel: string,
    files: Express.Multer.File[],
    mode: 'Marking' | 'Question'
  ): any {
    return {
      id: submissionId,
      title: generateSessionTitle(null),
      messages: [userMessage, aiMessage],
      userId: null,
      messageType: mode,
      createdAt: userMessage.timestamp,
      updatedAt: aiMessage.timestamp,
      isPastPaper: false,
      sessionStats: calculateSessionStats(
        allQuestionResults,
        Date.now() - startTime,
        actualModel,
        files
      )
    };
  }

  /**
   * Create detectedQuestion data from markingSchemesMap for frontend display
   */
  private static createDetectedQuestionFromMarkingSchemes(
    markingSchemesMap: Map<string, any>,
    globalQuestionText: string
  ): any {
    if (!markingSchemesMap || markingSchemesMap.size === 0) {
      return {
        found: false,
        questionText: '',
        questionNumber: '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        year: '',
        marks: 0
      };
    }

    // Get the first (and usually only) marking scheme entry
    const firstEntry = Array.from(markingSchemesMap.entries())[0];
    if (!firstEntry) {
      return {
        found: false,
        questionText: '',
        questionNumber: '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        year: '',
        marks: 0
      };
    }

    const [questionNumber, schemeData] = firstEntry;
    const questionDetection = schemeData.questionDetection;

    if (!questionDetection || !questionDetection.found) {
      return {
        found: false,
        questionText: globalQuestionText || '',
        questionNumber: questionNumber || '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        year: '',
        marks: schemeData.totalMarks || 0
      };
    }

    const match = questionDetection.match;
    if (!match) {
      return {
        found: false,
        questionText: globalQuestionText || '',
        questionNumber: questionNumber || '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        year: '',
        marks: schemeData.totalMarks || 0
      };
    }

    // Handle multiple questions case
    if (markingSchemesMap.size > 1) {
      const allQuestions = Array.from(markingSchemesMap.entries()).map(([qNum, data]) => ({
        questionNumber: qNum,
        marks: data.totalMarks || 0
      }));

      return {
        found: true,
        questionText: globalQuestionText || '',
        questionNumber: questionNumber || '',
        subQuestionNumber: '',
        examBoard: match.board || '',
        examCode: match.paperCode || '',
        paperTitle: match.qualification || '',
        subject: match.qualification || '',
        tier: match.tier || '',
        year: match.year || '',
        marks: allQuestions.reduce((sum, q) => sum + q.marks, 0),
        multipleQuestions: true,
        allQuestions: allQuestions
      };
    }

    // Single question case
    return {
      found: true,
      questionText: globalQuestionText || '',
      questionNumber: questionNumber || '',
      subQuestionNumber: match.subQuestionNumber || '',
      examBoard: match.board || '',
      examCode: match.paperCode || '',
      paperTitle: match.qualification || '',
      subject: match.qualification || '',
      tier: match.tier || '',
      year: match.year || '',
      marks: schemeData.totalMarks || match.marks || 0
    };
  }
}
