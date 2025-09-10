/**
 * API type definitions
 */
import type { ChatMessage } from './components';

// API Response base
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Chat API response
export interface ChatResponse {
  success: boolean;
  response: string;
  sessionId?: string;
  apiUsed?: string;
  error?: string;
}

// Marking API response
export interface MarkingResponse {
  success: boolean;
  isQuestionOnly: boolean;
  reasoning?: string;
  apiUsed?: string;
  questionDetection?: {
    match?: {
      markingScheme?: {
        examDetails: Record<string, any>;
        questionMarks: Record<string, any>;
        confidence: number;
      };
      examDetails: Record<string, any>;
      questionNumber: string;
      questionText: string;
      confidence: number;
    };
  };
  sessionId?: string;
  error?: string;
}

// Session data
export interface SessionData {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: string;
  userId: string;
  createdAt: string;
  updatedAt?: string;
}

// File upload
export interface FileUpload {
  file: File;
  type: string;
  size: number;
  name: string;
}

// Error response
export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, any>;
}
