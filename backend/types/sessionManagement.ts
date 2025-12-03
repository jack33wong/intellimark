/**
 * Type definitions for session management
 * Extracted from markingRouter.ts for better maintainability
 */

import type { Request } from 'express';
import type { UnifiedSession, UnifiedMessage } from './index.js';

export interface SessionContext {
  req: Request;
  submissionId: string;
  startTime: number;
  userMessage: UnifiedMessage;
  aiMessage: UnifiedMessage;
  questionDetection: any;
  globalQuestionText: string;
  mode: 'Marking' | 'Question';
}

export interface MarkingSessionContext extends SessionContext {
  allQuestionResults: import('../services/marking/MarkingExecutor.js').QuestionResult[];
  markingSchemesMap?: Map<string, any>;
  files?: Express.Multer.File[];
  usageTokens?: number;
  apiRequests?: number;                           // NEW: Total API request count
  apiRequestBreakdown?: { [key: string]: number }; // NEW: Breakdown by phase
}

export interface QuestionSessionContext extends SessionContext {
  // Question mode specific data
}

export interface SessionResult {
  sessionId: string;
  sessionTitle: string;
  unifiedSession?: UnifiedSession;
}

export interface SessionStats {
  totalProcessingTimeMs: number;
  lastModelUsed: string;
  lastApiUsed: string;
  totalLlmTokens: number;
  totalMathpixCalls: number;
  totalTokens: number;
  averageConfidence: number;
  imageSize: number;
  totalAnnotations: number;
  apiRequests?: number;
  apiRequestBreakdown?: { [key: string]: number };
}

export interface CreateSessionData {
  sessionId: string;
  title: string;
  userId: string;
  messageType: 'Marking' | 'Question';
  messages: UnifiedMessage[];
  isPastPaper: boolean;
  sessionStats: SessionStats;
}
