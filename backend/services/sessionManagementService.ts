/**
 * Session Management Service
 * Handles all session-related operations for marking and question modes
 * Extracted from markingRouter.ts for better maintainability
 */

import type { Request } from 'express';
import { generateSessionTitle, getShortSubjectName, getShortExamBoard } from '../services/marking/MarkingHelpers.js';
import { createUserMessage, createAIMessage, calculateMessageProcessingStats, calculateSessionStats } from '../utils/messageUtils.js';
import { ImageStorageService } from './imageStorageService.js';
import { getBaseQuestionNumber } from '../utils/TextNormalizationUtils.js';
import { formatMarkingSchemeAsBullets } from '../config/prompts.js';
import { generateSessionTitleFromDetectionResults } from './marking/questionDetectionService.js';
import type {
  SessionContext,
  MarkingSessionContext,
  QuestionSessionContext,
  SessionResult,
  SessionStats,
  CreateSessionData
} from '../types/sessionManagement.js';
import type { QuestionResult } from '../types/marking.js';
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
  files?: Express.Multer.File[];
  actualModel: string;
  startTime: number;
  markingSchemesMap?: Map<string, any>;
  detectionResults?: any[];  // Add detection results for Exam Tab building
  globalQuestionText: string;
  resolvedAIMessageId: string;
  questionOnlyResponses?: string[];
  studentScore?: {
    totalMarks: number;
    awardedMarks: number;
    scoreText: string;
  };
  grade?: string | null;
  gradeBoundaryType?: 'Paper-Specific' | 'Overall-Total' | null;
  gradeBoundaries?: { [grade: string]: number };
  markingContext?: import('../types/index.js').MarkingContext;
  usageTracker?: any;
  stepTimings?: any;
  standardizedPages?: import('../types/markingRouter.js').StandardizedPage[]; // NEW: For metadata sync
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
    // Generate session title using common function (if detectionResults available)
    const sessionTitle = context.detectionResults && context.detectionResults.length > 0
      ? generateSessionTitleFromDetectionResults(context.detectionResults, 'Marking')
      : this.generateMarkingSessionTitle(context);  // Fallback to old method

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

    // Generate session title using common function
    const sessionTitle = context.detectionResults && context.detectionResults.length > 0
      ? generateSessionTitleFromDetectionResults(context.detectionResults, 'Question')
      : generateSessionTitle(context.questionDetection, context.globalQuestionText || '', 'Question');  // Fallback

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

    // ==================================================================================
    // [V2 CLEAN PASS] PROTECTION RULE
    // If the engine already built a clean-string structure, we respect it.
    // ==================================================================================
    if (dbAiMessage.detectedQuestion) {
      return dbAiMessage;
    }

    // Default: Empty if not provided by engine
    dbAiMessage.detectedQuestion = {
      found: false,
      multipleExamPapers: false,
      multipleQuestions: false,
      totalMarks: 0,
      examPapers: []
    };

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
        // Extract question text - use database question text (not classification text)
        const questionText = match.databaseQuestionText || context.questionDetection.questionText || '';

        // markingScheme must be plain text (fail-fast for old format)
        let plainTextMarkingScheme = '';
        if (context.questionDetection.markingScheme) {
          if (typeof context.questionDetection.markingScheme !== 'string') {
            throw new Error(`[QUESTION MODE] Invalid marking scheme format: expected plain text string, got ${typeof context.questionDetection.markingScheme}. Please clear old data and create new sessions.`);
          }
          // Fail-fast if it looks like JSON (old format)
          if (context.questionDetection.markingScheme.trim().startsWith('{') || context.questionDetection.markingScheme.trim().startsWith('[')) {
            throw new Error(`[QUESTION MODE] Invalid marking scheme format: expected plain text, got JSON. Please clear old data and create new sessions.`);
          }
          plainTextMarkingScheme = context.questionDetection.markingScheme;
        }

        // Get subject from fullExamPapers.metadata.subject (source of truth via match.subject)
        // Fallback to markingScheme.examDetails.subject, then qualification
        const markingSchemeMatch = match.markingScheme;
        const actualSubject = match.subject || // Primary: from fullExamPapers.metadata.subject
          markingSchemeMatch?.examDetails?.subject ||
          match.qualification ||
          '';

        // Create single exam paper structure
        const examPapers = [{
          examBoard: match.board || '',
          examCode: match.paperCode || '',
          examSeries: match.examSeries || '',
          tier: match.tier || '',
          subject: actualSubject, // Use subject from fullExamPapers.metadata.subject (via match.subject)
          paperTitle: `${match.examSeries} ${getShortExamBoard(match.board)} ${getShortSubjectName(actualSubject)} ${match.tier || ''}`.replace(/\s+/g, ' ').trim(),
          questions: [{
            questionNumber: match.questionNumber || '',
            questionText: questionText,
            marks: match.marks || 0,
            markingScheme: plainTextMarkingScheme // [V2 CLEAN FIX] Pure string, no wrapping
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
        // Extract base question numbers, sort, and check for sequence
        const baseNumbers = allQuestionNumbers
          .map(key => {
            const qNum = key.split('_')[0];
            const baseNum = getBaseQuestionNumber(qNum);
            // getBaseQuestionNumber returns string, convert to number
            const num = parseInt(baseNum, 10);
            return isNaN(num) ? 0 : num;
          })
          .filter(num => num > 0)
          .sort((a, b) => a - b);

        const uniqueNumbers = Array.from(new Set(baseNumbers));

        // Format question number display
        let questionNumberDisplay: string;
        if (uniqueNumbers.length === 0) {
          // Fallback: show all question numbers as-is
          questionNumberDisplay = allQuestionNumbers.map(key => key.split('_')[0]).join(', ');
        } else if (uniqueNumbers.length === 1) {
          questionNumberDisplay = `Q${uniqueNumbers[0]}`;
        } else {
          // Check if in sequence
          const isSequence = uniqueNumbers.every((num, index) =>
            index === 0 || num === uniqueNumbers[index - 1] + 1
          );

          if (isSequence) {
            questionNumberDisplay = `Q${uniqueNumbers[0]} to Q${uniqueNumbers[uniqueNumbers.length - 1]}`;
          } else {
            questionNumberDisplay = uniqueNumbers.map(num => `Q${num}`).join(', ');
          }
        }

        // Check if we have multiple exam papers
        const examBoards = new Set();
        const examCodes = new Set();
        const examSeriesSet = new Set();

        Array.from(context.markingSchemesMap.values()).forEach(scheme => {
          const questionDetection = scheme.questionDetection;
          if (questionDetection?.match) {
            examBoards.add(questionDetection.match.board);
            examCodes.add(questionDetection.match.paperCode);
            examSeriesSet.add(questionDetection.match.examSeries);
          }
        });

        // If different exam boards, codes, or exam series, use simplified title
        if (examBoards.size > 1 || examCodes.size > 1 || examSeriesSet.size > 1) {
          return `Past paper - ${questionNumberDisplay}`;
        }

        // Same exam paper - use detailed title
        const firstQuestionDetection = firstQuestionScheme.questionDetection;
        if (firstQuestionDetection?.match) {
          const { board, examSeries, tier, subject, qualification } = firstQuestionDetection.match;
          const boardShort = getShortExamBoard(board);
          const subjectShort = getShortSubjectName(subject || qualification || '');
          const baseTitle = `${examSeries} ${boardShort} ${subjectShort} ${tier || ''}`.replace(/\s+/g, ' ').trim();
          return `${baseTitle} ${questionNumberDisplay} ${totalMarks} marks`.replace(/\s+/g, ' ').trim();
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
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, context.userMessage, context.mode);
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, dbAiMessage, context.mode);
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

    const usageMode = context.mode === 'Marking' ? 'marking' :
      context.mode === 'Question' ? 'question' :
        'unknown';

    await FirestoreService.createUnifiedSessionWithMessages({
      sessionId: currentSessionId,
      title: sessionTitle,
      userId: userId,
      messageType: context.mode,
      messages: [context.userMessage, dbAiMessage],
      isPastPaper: false,
      sessionStats,
      usageMode
    });
  }

  /**
   * Create session statistics using calculateSessionStats
   */
  private static createSessionStats(context: SessionContext): SessionStats {
    const additionalData = (context as any).allQuestionResults ? context as MarkingSessionContext : null;

    let stats: SessionStats;
    if (additionalData) {
      // For marking mode, use calculateSessionStats with allQuestionResults
      // CRITICAL: Use actual mathpix count from context if available
      const mathpixCount = (additionalData as any).mathpixCallCount ??
        additionalData.allQuestionResults.reduce((sum, q) => sum + (q.mathpixCalls || 0), 0);

      stats = calculateSessionStats(
        additionalData.allQuestionResults,
        Date.now() - context.startTime,
        additionalData.model || 'auto',
        additionalData.files || [],
        additionalData.usageTokens, // Pass the total from UsageTracker
        additionalData.llmInputTokens, // NEW
        additionalData.llmOutputTokens // NEW
      );

      // Override mathpix count with actual value
      stats.totalMathpixCalls = mathpixCount;
      stats.totalTokens = (additionalData.usageTokens || 0) + mathpixCount;
    } else {
      stats = calculateSessionStats(
        [], // No question results in question mode
        Date.now() - context.startTime,
        (context as QuestionSessionContext).model || 'auto',
        (context as QuestionSessionContext).files || [],
        (context as QuestionSessionContext).usageTokens || 0,
        (context as QuestionSessionContext).llmInputTokens,
        (context as QuestionSessionContext).llmOutputTokens
      );
    }

    // Add API request counts if available in context
    if ((context as MarkingSessionContext).apiRequests !== undefined) {
      stats.apiRequests = (context as MarkingSessionContext).apiRequests;
      stats.apiRequestBreakdown = (context as MarkingSessionContext).apiRequestBreakdown;
    }

    // CRITICAL: Use UsageTracker cost if available (single source of truth)
    // This ensures logged cost matches credit deduction
    if ((context as any).totalCost !== undefined) {
      stats.totalCost = (context as any).totalCost;
      stats.costBreakdown = (context as any).costBreakdown;
    }

    return stats;
  }

  /**
   * Get real model name from model type
   */
  private static getRealModelName(modelType: string): string {
    if (modelType === 'auto') {
      return 'gemini-2.0-flash'; // Default model for backward compatibility
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
   * FIXED: Fetches sessionStats from database to include cost calculation
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

    // FIXED: Fetch sessionStats from database to include cost (calculated in createUnifiedSessionWithMessages)
    const { FirestoreService } = await import('../services/firestoreService.js');
    const dbSession = await FirestoreService.getUnifiedSession(currentSessionId);
    const dbSessionStats = dbSession?.sessionStats || this.createSessionStats(context);

    // [V2 CLEAN FIX] 🏗️ Building UI Structure directly from Engine Results
    // If we are in marking mode, we take the clean strings from allQuestionResults
    // and jam them directly into the response message structure.
    if (context.mode === 'Marking' && additionalData?.allQuestionResults) {
      console.log(`[V2 CLEAN FIX] 🏗️ Building UI Structure directly from ${additionalData.allQuestionResults.length} Engine Results...`);
      const responseAiMessage = responseMessages[1];
      if (responseAiMessage) {
        responseAiMessage.questionResponses = additionalData.allQuestionResults.map(qr => ({
          questionNumber: String(qr.questionNumber || ''),
          questionText: qr.questionText || '', // CLEAN STRING
          markingScheme: qr.markingScheme || '', // CLEAN STRING
          score: qr.score,
          annotations: qr.annotations,
          studentWork: qr.studentWork,
          overallPerformanceSummary: qr.overallPerformanceSummary || qr.feedback
        }));
        console.log(`[V2 CLEAN FIX] ✅ UI Structure ready (Strings preserved)`);
      }
    }

    return {
      id: currentSessionId,
      sessionId: currentSessionId, // ADDED: For backward compatibility and credit deduction
      title: sessionTitle,
      messages: responseMessages, // Use response messages (follows design)
      userId: userId,
      messageType: context.mode,
      createdAt: context.userMessage.timestamp,
      updatedAt: dbAiMessage.timestamp,
      isPastPaper: false,
      sessionStats: dbSessionStats // Use sessionStats from database (includes cost)
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
    standardizedPages?: import('../types/markingRouter.ts').StandardizedPage[]
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
      if (standardizedPages && standardizedPages.length > 0) {
        // PREFER standardizedPages for metadata sync (essential for re-indexing)
        structuredImageDataArray = standardizedPages.map(page => ({
          url: null,
          originalFileName: page.originalFileName || 'unknown-page',
          fileSize: page.fileSize || 0
        }));
      } else if (files.length === 1) {
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
      }

      // Update structured data with Firebase URLs (ALWAYS do this, even for single files)
      this.updateStructuredDataWithFirebaseUrls(
        structuredImageDataArray,
        structuredPdfContexts,
        originalImageLinks
      );
    }

    return dbUserMessage;
  }

  /**
   * Create AI message for database
   */
  static async createAIMessageForDatabase(
    aiData: AIMessageData
  ): Promise<any> {
    const {
      allQuestionResults,
      finalAnnotatedOutput,
      files,
      actualModel,
      startTime,
      markingSchemesMap,
      globalQuestionText,
      resolvedAIMessageId,
      questionOnlyResponses,
      studentScore,
      grade,
      gradeBoundaryType,
      gradeBoundaries,
      markingContext,
      usageTracker,
      standardizedPages // NEW
    } = aiData;

    // Calculate real processing stats for the AI message using the tracker for accuracy
    const { total: totalCost, mathpix: mathpixCost } = usageTracker
      ? usageTracker.calculateCost(actualModel)
      : { total: 0, mathpix: 0 };
    const costBreakdown = { llmCost: totalCost - mathpixCost, mathpixCost };

    const totalAnnotations = allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0);
    const totalLlmTokens = allQuestionResults.reduce((sum, q) => sum + (q.usageTokens || 0), 0);
    const mockAiResponse = { usageTokens: totalLlmTokens, confidence: 0.85 };

    const realProcessingStats = calculateMessageProcessingStats(
      mockAiResponse,
      actualModel,
      Date.now() - startTime,
      allQuestionResults.flatMap(q => q.annotations || []),
      files.reduce((sum, f) => sum + f.size, 0),
      allQuestionResults,
      totalCost,
      costBreakdown
    );

    // Create structured imageDataArray for AI message
    // DIAGNOSTIC: Check for base64 in finalAnnotatedOutput (causes Firestore payload size error) - REMOVED to reduce log noise

    const structuredAiImageDataArray = finalAnnotatedOutput.map((annotatedImage, index) => {
      // FIX: Use actual standardized page metadata if available, fallback to indexed files
      const page = standardizedPages?.[index];
      const fileName = page?.originalFileName || files[index]?.originalname || `annotated-image-${index + 1}.png`;
      const size = page?.fileSize || annotatedImage.length;

      return {
        url: annotatedImage,
        originalFileName: fileName,
        fileSize: size
      };
    });

    // ==================================================================================
    // [V2 CLEAN FIX] REUSE EXISTING WORKING DATA FROM ENGINE
    // We stop relying on schema-based structure builders when we have actual engine results.
    // This ensures markingScheme and questionText ARE THE STRINGS used in the AI prompt.
    // ==================================================================================
    let detectedQuestion: any;

    if (allQuestionResults && allQuestionResults.length > 0) {
      console.log(`[V2 CLEAN FIX] 🏗️ Building UI Structure directly from ${allQuestionResults.length} Engine Results...`);

      // Calculate total marks from engine results
      const syncTotal = allQuestionResults.reduce((sum, r) => sum + (r.totalMarks || r.marks || 0), 0);

      // Build a simple flat exam paper structure
      const questions = allQuestionResults.map(r => {
        // [V2 CLEAN FIX] 1. Select the best source (Prompt > DB)
        let rawScheme = r.promptMarkingScheme || r.markingScheme || '';

        // [V2 CLEAN FIX] 2. Apply cleanup (Remove Chief Examiner Preamble)
        if (typeof rawScheme === 'string' && rawScheme.includes('[OFFICIAL SCHEME]')) {
          rawScheme = rawScheme.split('[OFFICIAL SCHEME]')[1].trim();
        }

        return {
          questionNumber: String(r.questionNumber),
          questionText: r.promptQuestionText || r.questionText || '', // [V2 CLEAN FIX] Prioritize exact prompt text
          markingScheme: rawScheme, // [V2 CLEAN FIX] Cleaned scheme

          marks: r.marks ?? 0,
          totalMarks: r.totalMarks ?? 0
        };
      });

      // Extract metadata from first detection result if available
      const firstDetection = aiData.detectionResults?.[0]?.detectionResult?.match || {};
      const firstQuestionMetadata = aiData.detectionResults?.[0]?.question || {};

      detectedQuestion = {
        found: true,
        multipleExamPapers: false,
        multipleQuestions: questions.length > 1,
        totalMarks: syncTotal,
        examPapers: [{
          examBoard: firstDetection.board || '',
          examCode: firstDetection.paperCode || '',
          examSeries: firstDetection.examSeries || firstDetection.year || '',
          tier: firstDetection.tier || '',
          subject: firstDetection.subject || firstDetection.qualification || '',
          paperTitle: firstDetection.paperTitle || firstQuestionMetadata.paperTitle || "Annotated Paper",
          totalMarks: syncTotal,
          questions: questions
        }]
      };

      console.log(`[V2 CLEAN FIX] ✅ UI Structure ready (Strings preserved)`);
    } else {
      // Default: Empty
      detectedQuestion = {
        found: false,
        multipleExamPapers: false,
        multipleQuestions: false,
        totalMarks: 0,
        examPapers: []
      };
    }
    // ==================================================================================
    // ==================================================================================

    // Aggregated Summaries Redesign: Distilled Data Pass
    const summaryStartTime = Date.now();
    const overallPerformanceSummary = await this.generateMasterPerformanceSummary(allQuestionResults, actualModel, aiData.usageTracker);

    // Record timing if stepTimings is provided
    if (aiData.stepTimings) {
      aiData.stepTimings['performance_summary'] = {
        start: summaryStartTime,
        duration: Date.now() - summaryStartTime
      };

      const green = '\x1b[32m';
      const bold = '\x1b[1m';
      const reset = '\x1b[0m';
      const durationSec = ((Date.now() - summaryStartTime) / 1000).toFixed(1);
      console.log(`${bold}${green}✅ [PERFORMANCE SUMMARY AI]${reset} ${bold}COMPLETED${reset} in ${bold}${durationSec}s${reset} (${green}${bold}${actualModel.toUpperCase()}${reset})`);
    }


    // Use fallback text for content field (not the AI summary)
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
      detectedQuestion: detectedQuestion,
      markingContext: markingContext // FIXED: Pass markingContext to message creation
    });

    // Add AI performance summary as separate field
    if (overallPerformanceSummary) {
      (dbAiMessage as any).performanceSummary = overallPerformanceSummary;
    }

    // Add questionOnlyResponses if provided (for mixed content)
    if (questionOnlyResponses && questionOnlyResponses.length > 0) {
      (dbAiMessage as any).questionOnlyResponses = questionOnlyResponses;
    }

    // Add studentScore if provided
    if (studentScore) {
      (dbAiMessage as any).studentScore = studentScore;
    }

    // ==================================================================================
    // [FIRESTORE SIZE OPTIMIZATION] - The Trimming Layer
    // Strip redundant and massive objects from allQuestionResults before persistence.
    // These are redundant because 'markingContext' contains the distilled summary.
    // ==================================================================================
    if (allQuestionResults && allQuestionResults.length > 0) {
      const trimmedResults = allQuestionResults.map(qr => {
        // Create a copy without the heavy OCR fields
        // [SAFETY] Keep 'markingScheme' as requested, only strip the data-heavy ones
        const {
          classificationBlocks,
          cleanedOcrText,
          rawAnnotations,
          ...rest
        } = qr;
        return rest;
      });
      (dbAiMessage as any).allQuestionResults = trimmedResults;
    }

    // [SIZE OPTIMIZATION] Explicitly remove markingSchemesMap - it's massive and redundant
    // The distilled logic survives in 'markingContext'
    delete (dbAiMessage as any).markingSchemesMap;

    // Add grade if provided
    if (grade) {
      (dbAiMessage as any).grade = grade;
      (dbAiMessage as any).gradeBoundaryType = gradeBoundaryType;
      if (gradeBoundaries) {
        (dbAiMessage as any).gradeBoundaries = gradeBoundaries;
      }
    }

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
      sessionId: submissionId, // Ensure sessionId is present for consistency
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
   * Generates a cohesive master performance summary based on distilled results of all questions.
   */
  private static async generateMasterPerformanceSummary(allQuestionResults: any[], model: string, tracker?: any): Promise<string | undefined> {
    if (!allQuestionResults || allQuestionResults.length === 0) return undefined;

    // Distill the data for the AI pass
    const distilledData = allQuestionResults.map(qr => {
      const qNum = qr.questionNumber || 'Unknown';

      // Distill topic/text (prioritize database text, then question text)
      let topic = qr.databaseQuestionText || qr.questionText || 'Topic unknown';
      if (topic.length > 120) {
        topic = topic.substring(0, 117) + '...';
      }

      const score = qr.studentScore?.scoreText || (qr.score ? `${qr.score.awardedMarks || 0}/${qr.score.totalMarks || 0}` : 'Unknown Score');

      // Distill reasonings into a concise list of missing points or key accomplishments
      const feedback = qr.annotations
        ?.filter((a: any) => a.reasoning && a.reasoning.trim() !== '')
        .map((a: any) => `${a.text}: ${a.reasoning}`)
        .slice(0, 5) // Map max 5 annotations for brevity
        .join(', ') || 'No specific feedback available';

      return `Q${qNum} (${topic}): Score ${score}. Key Points: ${feedback}`;
    }).join('\n');

    try {
      const { ModelProvider } = await import('../utils/ModelProvider.js');
      const { getPrompt } = await import('../config/prompts.js');

      const systemPrompt = getPrompt('masterSummary.system');
      const userPrompt = getPrompt('masterSummary.user', distilledData);

      // Call AI for final synthesis
      const response = await ModelProvider.callText(systemPrompt, userPrompt, model as any, false, tracker, 'performanceSummary');

      let finalContent = response.content;

      // Safeguard: If AI mistakenly returns JSON, extract the text
      if (finalContent && (finalContent.startsWith('{') || finalContent.includes('"master_summary"'))) {
        try {
          // Find potential JSON block
          const jsonMatch = finalContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            finalContent = parsed.master_summary || parsed.summary || parsed.content || Object.values(parsed)[0] || finalContent;
          }
        } catch (e) {
          console.warn('[MASTER SUMMARY] Failed to parse accidental JSON:', e);
        }
      }

      return finalContent;
    } catch (error) {
      console.error('[MASTER SUMMARY] Error generating summary:', error);
      return undefined;
    }
  }
}
