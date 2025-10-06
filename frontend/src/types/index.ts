/**
 * Type definitions barrel export
 */

export * from './components';
export * from './api';
export * from './payment';

/**
 * Centralized TypeScript interfaces for the application.
 */

// ============================================================================
// MESSAGE LEVEL - Individual message data
// ============================================================================
export interface UnifiedMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  
    // Image data
    imageLink?: string;
    imageData?: string; // For optimistic UI
    fileName?: string;
  
    // Other message fields
    isProcessing?: boolean;
    type?: 'chat' | 'marking_original' | 'marking_annotated';
    progressData?: {
      currentStepDescription: string;
      allSteps: string[];
      currentStepIndex: number;
      isComplete: boolean;
    };
    
    // Question detection with full exam paper metadata
    detectedQuestion?: {
      found: boolean;
      questionText?: string;
      questionNumber?: string;       // Question number from exam paper
      subQuestionNumber?: string;    // Optional sub-question number if matched
      examBoard?: string;
      examCode?: string;
      paperTitle?: string;
      subject?: string;
      tier?: string;
      year?: string;
    };
  }
  
  // ============================================================================
  // SESSION LEVEL - Aggregated data
  // ============================================================================
  export interface UnifiedSession {
    id: string;
    title: string;
    messages: UnifiedMessage[];
    userId: string;
    messageType: 'Marking' | 'Question' | 'Chat';
  
    // Session timestamps
    createdAt: string;
    updatedAt: string;
  
    // User preferences
    favorite?: boolean;
    rating?: number;
    
    // This can hold any legacy or unstructured metadata.
    sessionStats?: any;
  }
  