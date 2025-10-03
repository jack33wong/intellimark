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
      completedSteps: string[];
      allSteps: string[];
      isComplete: boolean;
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
    sessionMetadata?: any;
  }
  