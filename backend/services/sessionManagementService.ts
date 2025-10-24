/**
 * Session Management Service
 * Handles all session-related operations for marking and question modes
 * Extracted from markingRouter.ts for better maintainability
 */

import type { Request } from 'express';
import { createDetectedQuestionData, generateSessionTitle } from '../utils/markingRouterHelpers.js';
import type { 
  SessionContext, 
  MarkingSessionContext, 
  QuestionSessionContext, 
  SessionResult, 
  SessionStats, 
  CreateSessionData 
} from '../types/sessionManagement.js';

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
        
        (dbAiMessage as any).detectedQuestion = createDetectedQuestionData(
          context.allQuestionResults || [],
          context.markingSchemesMap,
          context.globalQuestionText,
          {
            useQuestionDetection: true,
            questionNumberDisplay: questionNumberDisplay,
            totalMarks: totalMarks
          }
        );
      } else {
        (dbAiMessage as any).detectedQuestion = createDetectedQuestionData(
          context.allQuestionResults || [],
          context.markingSchemesMap,
          context.globalQuestionText
        );
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
      // Found matching past paper
      (dbAiMessage as any).detectedQuestion = {
        found: true,
        questionText: context.globalQuestionText || '',
        questionNumber: context.questionDetection.match?.questionNumber || '',
        subQuestionNumber: '',
        examBoard: context.questionDetection.match?.board || '',
        examCode: context.questionDetection.match?.paperCode || '',
        paperTitle: context.questionDetection.match?.qualification || '',
        subject: context.questionDetection.match?.qualification || '',
        tier: context.questionDetection.match?.tier || '',
        year: context.questionDetection.match?.year || '',
        marks: context.questionDetection.match?.marks,
        markingScheme: context.questionDetection.match?.markingScheme?.questionMarks ? JSON.stringify(context.questionDetection.match.markingScheme.questionMarks) : ''
      };
    } else {
      // No matching past paper found, but still show question text for question mode
      (dbAiMessage as any).detectedQuestion = {
        found: false,
        questionText: context.globalQuestionText || '',
        questionNumber: '',
        subQuestionNumber: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        year: '',
        marks: 0,
        markingScheme: ''
      };
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
          return `${board} ${qualification} ${paperCode} (${year}) Tier ${tier} Q${questionNumberDisplay} ${totalMarks} marks`;
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
   * Create session statistics
   */
  private static createSessionStats(context: SessionContext): SessionStats {
    const additionalData = (context as any).allQuestionResults ? context as MarkingSessionContext : null;
    
    return {
      totalProcessingTimeMs: Date.now() - context.startTime,
      lastModelUsed: additionalData?.model || 'auto',
      lastApiUsed: `unified_${context.mode.toLowerCase()}_pipeline`,
      totalLlmTokens: additionalData?.usageTokens || 0,
      totalMathpixCalls: 0,
      totalTokens: additionalData?.usageTokens || 0,
      averageConfidence: 0,
      imageSize: additionalData?.files ? additionalData.files.reduce((sum, f) => sum + f.size, 0) : 0,
      totalAnnotations: additionalData?.allQuestionResults ? additionalData.allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0) : 0
    };
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
}
