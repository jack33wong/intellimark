/**
 * Session Management Service
 * Handles all session-related operations for marking and question modes
 * Extracted from markingRouter.ts for better maintainability
 */

import type { Request } from 'express';
import { generateSessionTitle } from '../services/marking/MarkingHelpers.js';
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
  questionOnlyResponses?: string[];
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
    
    // FIXED: Create separate database and response objects
    const { MessageFactory } = await import('./messageFactory.js');
    const dbMessages = MessageFactory.createForDatabase(context.userMessage, dbAiMessage);
    
    // Persist to database for authenticated users
    if (isAuthenticated) {
      await this.persistAuthenticatedSession(
        FirestoreService,
        currentSessionId,
        sessionTitle,
        userId,
        context,
        dbMessages[1] // Use database AI message
      );
    }
    
    // Create unified session data for frontend
    const unifiedSession = isAuthenticated ? await this.createUnifiedSessionData(
      currentSessionId,
      sessionTitle,
      userId,
      context,
      dbMessages[1] // Use database AI message
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
    const sessionTitle = generateSessionTitle(context.questionDetection, context.globalQuestionText || '', 'Question');
    
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
    const unifiedSession = isAuthenticated ? await this.createUnifiedSessionData(
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
    
    // Create detectedQuestion data from markingSchemesMap for frontend display
    if (context.markingSchemesMap) {
      const detectedQuestion = this.createDetectedQuestionFromMarkingSchemes(context.markingSchemesMap, context.globalQuestionText);
      dbAiMessage.detectedQuestion = detectedQuestion;
    }
    
    return dbAiMessage;
  }

  /**
   * Prepare AI message for question mode
   */
  private static prepareQuestionAiMessage(context: QuestionSessionContext): any {
    const dbAiMessage = { ...context.aiMessage };
    
    // Transform question detection result to match frontend DetectedQuestion structure
    if (context.questionDetection?.found) {
      const match = context.questionDetection.match;
      if (match) {
        // Create single exam paper structure
        const examPapers = [{
          examBoard: match.board || '',
          examCode: match.paperCode || '',
          year: match.year || '',
          tier: match.tier || '',
          subject: match.qualification || '',
          paperTitle: match ? `${match.board} ${match.qualification} ${match.paperCode} (${match.year})` : '',
          questions: [{
            questionNumber: match.questionNumber || '',
            questionText: context.questionDetection.questionText || '',
            marks: match.marks || 0,
            sourceImageIndex: 0,
            markingScheme: (context.questionDetection.markingScheme || '').split('\n').map(line => ({
              mark: '',
              answer: line.trim(),
              comments: ''
            })).filter(item => item.answer)
          }],
          totalMarks: match.marks || 0
        }];
        
        const transformedDetectedQuestion = {
          found: context.questionDetection.found,
          multipleExamPapers: false,
          multipleQuestions: false,
          totalMarks: match.marks || 0,
          examPapers
        };
        
        dbAiMessage.detectedQuestion = transformedDetectedQuestion;
      }
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
        // Extract just the question number from unique keys (e.g., "13_Pearson Edexcel_1MA1/2H" -> "13")
        const questionNumbersOnly = allQuestionNumbers.map(key => key.split('_')[0]);
        const questionNumberDisplay = questionNumbersOnly.length > 1 
          ? questionNumbersOnly.join(', ') 
          : questionNumbersOnly[0];
        
        // Check if we have multiple exam papers
        const examBoards = new Set();
        const examCodes = new Set();
        const years = new Set();
        
        Array.from(context.markingSchemesMap.values()).forEach(scheme => {
          const questionDetection = scheme.questionDetection;
          if (questionDetection?.match) {
            examBoards.add(questionDetection.match.board);
            examCodes.add(questionDetection.match.paperCode);
            years.add(questionDetection.match.year);
          }
        });
        
        // If different exam boards, codes, or years, use simplified title
        if (examBoards.size > 1 || examCodes.size > 1 || years.size > 1) {
          return `Past paper - Q${questionNumberDisplay}`;
        }
        
        // Same exam paper - use detailed title
        const firstQuestionDetection = firstQuestionScheme.questionDetection;
        if (firstQuestionDetection?.match) {
          const { board, qualification, paperCode, year, tier } = firstQuestionDetection.match;
          return `${board} ${qualification} ${paperCode} (${year}) Q${questionNumberDisplay} ${totalMarks} marks`;
        }
      }
    }
    
    return generateSessionTitle(null, '', 'Marking');
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
   * FIXED: Uses database objects and creates proper response objects
   */
  private static async createUnifiedSessionData(
    currentSessionId: string,
    sessionTitle: string,
    userId: string,
    context: SessionContext,
    dbAiMessage: any
  ): Promise<any> {
    const additionalData = (context as any).allQuestionResults ? context as MarkingSessionContext : null;
    
    // FIXED: Create response objects from database objects
    const { MessageFactory } = await import('./messageFactory.js');
    const dbMessages = MessageFactory.createForDatabase(context.userMessage, dbAiMessage);
    const responseMessages = MessageFactory.createForResponse(dbMessages);
    
    return {
      id: currentSessionId,
      title: sessionTitle,
      messages: responseMessages, // Use response messages (follows design)
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
          // Check if file is a PDF
          const isPdf = file.mimetype === 'application/pdf';
          
          if (isPdf) {
            // Upload as PDF
            const pdfLink = await ImageStorageService.uploadPdf(
              `data:application/pdf;base64,${file.buffer.toString('base64')}`,
              userId,
              `multi-${submissionId}`,
              file.originalname || `document-${index + 1}.pdf`
            );
            return pdfLink;
          } else {
            // Upload as image
            const imageLink = await ImageStorageService.uploadImage(
              file.buffer.toString('base64'),
              userId,
              `multi-${submissionId}`,
              'original'
            );
            return imageLink;
          }
        } catch (uploadError) {
          const fileName = file.originalname || `file-${index + 1}`;
          const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
          const errorMessage = uploadError instanceof Error ? uploadError.message : String(uploadError);
          console.error(`❌ [UPLOAD] Failed to upload original file ${index} (${fileName}):`);
          console.error(`  - File size: ${fileSizeMB}MB`);
          console.error(`  - Error: ${errorMessage}`);
          if (uploadError instanceof Error && uploadError.stack) {
            console.error(`  - Stack: ${uploadError.stack}`);
          }
          throw new Error(`Failed to upload original file ${index} (${fileName}): ${errorMessage}`);
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
    pdfContext?: any,
    isAuthenticated?: boolean
  ): { structuredImageDataArray?: any[]; structuredPdfContexts?: any[] } {
    let structuredImageDataArray: any[] | undefined = undefined;
    let structuredPdfContexts: any[] | undefined = undefined;


    if (isPdf || isMultiplePdfs) {
      // For PDFs, use pdfContexts for all users - simplified structure matching imageDataArray
      // CRITICAL: Only use Firebase Storage URLs, never base64 fallback
      if (pdfContext?.isMultiplePdfs && pdfContext.pdfContexts) {
        // Multiple PDFs case - only use originalPdfLink (Firebase URL)
        structuredPdfContexts = pdfContext.pdfContexts.map((ctx: any) => {
          if (!ctx.originalPdfLink) {
            // Detailed logging for authenticated users to diagnose why originalPdfLink is null
            console.error(`❌ [PDF UPLOAD DIAGNOSTIC] Multiple PDFs - Missing Firebase URL for ${ctx.originalFileName || 'unknown'}:`);
            console.error(`  - isAuthenticated: ${isAuthenticated}`);
            console.error(`  - originalPdfLink: ${ctx.originalPdfLink || 'null'}`);
            console.error(`  - originalPdfDataUrl: ${ctx.originalPdfDataUrl ? 'exists' : 'null'}`);
            console.error(`  - fileSize: ${ctx.fileSize || 'unknown'} bytes`);
            console.error(`  - fileSizeMB: ${ctx.fileSizeMB || 'unknown'}`);
            console.error(`  - fileIndex: ${ctx.fileIndex !== undefined ? ctx.fileIndex : 'unknown'}`);
            console.error(`  - pdfContext structure: isMultiplePdfs=${pdfContext.isMultiplePdfs}, pdfContexts.length=${pdfContext.pdfContexts?.length || 0}`);
            throw new Error(`PDF upload failed for ${ctx.originalFileName || 'unknown'}: No Firebase URL available (authenticated user - upload should have succeeded)`);
          }
          return {
            url: ctx.originalPdfLink, // Only Firebase URL, no base64 fallback
          originalFileName: ctx.originalFileName,
            fileSize: ctx.fileSize || 0
          };
        });
      } else if (pdfContext && !pdfContext.isMultiplePdfs) {
        // Single PDF case - only use originalPdfLink (Firebase URL)
        if (!pdfContext.originalPdfLink) {
          // Detailed logging for authenticated users to diagnose why originalPdfLink is null
          console.error(`❌ [PDF UPLOAD DIAGNOSTIC] Single PDF - Missing Firebase URL for ${pdfContext.originalFileName || 'unknown'}:`);
          console.error(`  - isAuthenticated: ${isAuthenticated}`);
          console.error(`  - originalPdfLink: ${pdfContext.originalPdfLink || 'null'}`);
          console.error(`  - originalPdfDataUrl: ${pdfContext.originalPdfDataUrl ? 'exists' : 'null'}`);
          console.error(`  - fileSize: ${pdfContext.fileSize || 'unknown'} bytes`);
          console.error(`  - fileSizeMB: ${pdfContext.fileSizeMB || 'unknown'}`);
          console.error(`  - originalFileType: ${pdfContext.originalFileType || 'unknown'}`);
          console.error(`  - pdfContext structure: isMultiplePdfs=${pdfContext.isMultiplePdfs}, has pdfContexts=${!!pdfContext.pdfContexts}`);
          throw new Error(`PDF upload failed for ${pdfContext.originalFileName || 'unknown'}: No Firebase URL available (authenticated user - upload should have succeeded)`);
        }
        structuredPdfContexts = [{
          url: pdfContext.originalPdfLink, // Only Firebase URL, no base64 fallback
          originalFileName: pdfContext.originalFileName,
          fileSize: pdfContext.fileSize || 0
        }];
      } else {
        // No pdfContext provided - this should not happen if upload succeeded
        console.error(`❌ [PDF UPLOAD DIAGNOSTIC] PDF context missing:`);
        console.error(`  - isAuthenticated: ${isAuthenticated}`);
        console.error(`  - isPdf: ${isPdf}`);
        console.error(`  - isMultiplePdfs: ${isMultiplePdfs}`);
        console.error(`  - pdfContext: ${pdfContext ? 'exists but invalid structure' : 'null/undefined'}`);
        if (pdfContext) {
          console.error(`  - pdfContext keys: ${Object.keys(pdfContext).join(', ')}`);
        }
        throw new Error('PDF context missing: PDF upload may have failed');
      }
      
    } else {
      // For images, use imageDataArray for all users
      if (files.length === 1) {
        structuredImageDataArray = [{
          url: null, // Will be updated to Firebase URL for authenticated users
          originalFileName: files[0].originalname,
          fileSize: files[0].size
        }];
      } else {
        structuredImageDataArray = files.map(f => ({
          url: null, // Will be updated to Firebase URL for authenticated users
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
      resolvedAIMessageId,
      questionOnlyResponses
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
    // DIAGNOSTIC: Check for base64 in finalAnnotatedOutput (causes Firestore payload size error)
    finalAnnotatedOutput.forEach((item, idx) => {
      const isBase64 = typeof item === 'string' && item.startsWith('data:image');
      const sizeMB = typeof item === 'string' ? item.length / (1024 * 1024) : 0;
      if (isBase64) {
        console.log(`🔍 [DIAGNOSTIC] Item ${idx} (${files[idx]?.originalname || 'unknown'}): BASE64 detected, size: ${sizeMB.toFixed(2)}MB`);
      }
    });
    const totalPayloadSizeMB = JSON.stringify(finalAnnotatedOutput).length / (1024 * 1024);
    console.log(`🔍 [DIAGNOSTIC] Total finalAnnotatedOutput payload: ${totalPayloadSizeMB.toFixed(2)}MB`);
    
    const structuredAiImageDataArray = finalAnnotatedOutput.map((annotatedImage, index) => ({
      url: annotatedImage,
      originalFileName: files[index]?.originalname || `annotated-image-${index + 1}.png`,
      fileSize: annotatedImage.length
    }));

    // Create detectedQuestion data from markingSchemesMap for frontend display
    const detectedQuestion = this.createDetectedQuestionFromMarkingSchemes(markingSchemesMap, globalQuestionText);

    // Create AI message content - include question-only responses if available
    let aiContent = 'Marking completed - see results below';
    if (questionOnlyResponses && questionOnlyResponses.length > 0) {
      aiContent += '\n\n' + questionOnlyResponses.join('\n\n');
    }

    const dbAiMessage = createAIMessage({
      content: aiContent,
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
    // Validate required parameters and throw descriptive errors
    if (!userMessage) {
      throw new Error(`createUnauthenticatedSession: userMessage is null or undefined. submissionId: ${submissionId}`);
    }
    if (!aiMessage) {
      throw new Error(`createUnauthenticatedSession: aiMessage is null or undefined. submissionId: ${submissionId}`);
    }
    if (userMessage.timestamp === null || userMessage.timestamp === undefined) {
      throw new Error(`createUnauthenticatedSession: userMessage.timestamp is null or undefined. userMessage: ${JSON.stringify(userMessage)}`);
    }
    if (aiMessage.timestamp === null || aiMessage.timestamp === undefined) {
      throw new Error(`createUnauthenticatedSession: aiMessage.timestamp is null or undefined. aiMessage: ${JSON.stringify(aiMessage)}`);
    }
    
    return {
      id: submissionId,
      title: generateSessionTitle(null, '', 'Question'),
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
        multipleExamPapers: false,
        multipleQuestions: false,
        totalMarks: 0,
        examPapers: []
      };
    }

    // Get the first (and usually only) marking scheme entry
    const firstEntry = Array.from(markingSchemesMap.entries())[0];
    if (!firstEntry) {
      return {
        found: false,
        multipleExamPapers: false,
        multipleQuestions: false,
        totalMarks: 0,
        examPapers: []
      };
    }

    const [questionNumber, schemeData] = firstEntry;
    const questionDetection = schemeData.questionDetection;

    if (!questionDetection || !questionDetection.found) {
      return {
        found: false,
        multipleExamPapers: false,
        multipleQuestions: false,
        totalMarks: schemeData.totalMarks || 0,
        examPapers: []
      };
    }

    const match = questionDetection.match;
    if (!match) {
      return {
        found: false,
        multipleExamPapers: false,
        multipleQuestions: false,
        totalMarks: schemeData.totalMarks || 0,
        examPapers: []
      };
    }

    // Handle multiple questions case - ENHANCED STRUCTURE WITH EXAM PAPER GROUPING
    if (markingSchemesMap.size > 1) {
      // Group questions by exam paper (board + code + year + tier)
      const examPaperGroups = new Map<string, any>();
      
      Array.from(markingSchemesMap.entries()).forEach(([qNum, data], index) => {
        const questionDetection = data.questionDetection;
        const match = questionDetection?.match;
        
        if (!match) return; // Skip if no match data
        
        const examBoard = match.board || '';
        const examCode = match.paperCode || '';
        const year = match.year || '';
        const tier = match.tier || '';
        
        // Create unique key for exam paper grouping
        const examPaperKey = `${examBoard}_${examCode}_${year}_${tier}`;
        
        if (!examPaperGroups.has(examPaperKey)) {
          examPaperGroups.set(examPaperKey, {
            examBoard,
            examCode,
            year,
            tier,
            subject: match.qualification || '',
            paperTitle: match ? `${match.board} ${match.qualification} ${match.paperCode} (${match.year})` : '',
            questions: [],
            totalMarks: 0
          });
        }
        
        const examPaper = examPaperGroups.get(examPaperKey);
        
        let marksArray = data.questionMarks || [];
        
        // Handle case where questionMarks might not be an array
        if (!Array.isArray(marksArray)) {
          if (marksArray && typeof marksArray === 'object' && marksArray.marks) {
            marksArray = marksArray.marks;
          } else {
            console.warn(`[MARKING SCHEME] Invalid marks for question ${qNum}:`, marksArray);
            marksArray = [];
          }
        }
        
        // Extract question text - prioritize the stored questionText field from markingRouter
        let questionTextForThisQ = '';
        
        // First try the questionText stored directly in the scheme data
        if (data.questionText) {
          questionTextForThisQ = data.questionText;
        } else if (data.questionDetection?.questionText) {
          questionTextForThisQ = data.questionDetection.questionText;
        } else if (data.questionDetection?.match?.questionText) {
          questionTextForThisQ = data.questionDetection.match.questionText;
        } else {
          // Fallback to global question text
          questionTextForThisQ = globalQuestionText || '';
        }
        
        // Extract question number from key (e.g., "1_Pearson Edexcel_1MA1/1H" -> "1")
        const extractedQNum = qNum.split('_')[0];
        
        examPaper.questions.push({
          questionNumber: extractedQNum,
          questionText: questionTextForThisQ,
          marks: data.totalMarks || 0,
          sourceImageIndex: index, // Use index as sourceImageIndex
          markingScheme: marksArray.map((mark: any) => ({
            mark: mark.mark || '',
            answer: mark.answer || '',
            comments: mark.comments || ''
          }))
        });
        examPaper.totalMarks += data.totalMarks || 0;
      });
      
      // Convert to array and determine if multiple exam papers
      const examPapers = Array.from(examPaperGroups.values());
      const multipleExamPapers = examPapers.length > 1;
      
      // Calculate total marks across all questions
      const totalMarks = Array.from(markingSchemesMap.values()).reduce((sum, data) => sum + (data.totalMarks || 0), 0);

      return {
        found: true,
        multipleExamPapers,
        multipleQuestions: true,
        totalMarks,
        examPapers
      };
    }

    // Single question case - ENHANCED STRUCTURE
    let singleMarkingScheme = schemeData.questionMarks || [];
    
    // Handle case where questionMarks might not be an array
    if (!Array.isArray(singleMarkingScheme)) {
      // If it's an object with marks property, extract it
      if (singleMarkingScheme && typeof singleMarkingScheme === 'object' && singleMarkingScheme.marks) {
        singleMarkingScheme = singleMarkingScheme.marks;
      } else {
        console.warn(`[MARKING SCHEME] Invalid marks for single question`);
        singleMarkingScheme = [];
      }
    }
    
    // Create single question array for consistency
    const questionsArray = [{
      questionNumber: questionNumber.split('_')[0], // Extract just the question number
      questionText: globalQuestionText || '',
      marks: schemeData.totalMarks || match.marks || 0,
      sourceImageIndex: 0,
      markingScheme: singleMarkingScheme.map((mark: any) => ({
        mark: mark.mark || '',
        answer: mark.answer || '',
        comments: mark.comments || ''
      }))
    }];
    
    // Create single exam paper structure
    const examPapers = [{
      examBoard: match.board || '',
      examCode: match.paperCode || '',
      year: match.year || '',
      tier: match.tier || '',
      subject: match.qualification || '',
      paperTitle: match ? `${match.board} ${match.qualification} ${match.paperCode} (${match.year})` : '',
      questions: questionsArray,
      totalMarks: schemeData.totalMarks || match.marks || 0
    }];
    
    return {
      found: true,
      multipleExamPapers: false,
      multipleQuestions: false,
      totalMarks: schemeData.totalMarks || match.marks || 0,
      examPapers
    };
  }
}
