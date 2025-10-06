/**
 * Unified Data Structure for Frontend, Backend, and Memory
 * Single source of truth for all chat and marking data
 */

// ============================================================================
// CORE MESSAGE TYPES
// ============================================================================

export interface UnifiedMessage {
  id: string; // Frontend ID (mapped from messageId)
  messageId?: string; // Backend messageId (for compatibility)
  sessionId?: string; // Backend session reference
  userId?: string; // Backend user reference
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string; // ISO string format
  type?: 'chat' | 'marking_original' | 'marking_annotated' | 'question_original' | 'question_response' | 'follow_up';
  
  // Image data (imageLink only - Firebase Storage URLs)
  imageLink?: string;
  fileName?: string;
  
  // Display options
  isImageContext?: boolean;
  
  // Question detection with full exam paper metadata
  detectedQuestion?: {
    found: boolean;
    questionText?: string;
    examBoard?: string;
    examCode?: string;
    paperTitle?: string;
    subject?: string;
    tier?: string;
    year?: string;
  };
  
  // Message-specific processing stats
  processingStats?: {
    processingTimeMs?: number;   
    confidence?: number;
    annotations?: number;       		 
    imageSize?: number;
    ocrMethod?: string;
    classificationResult?: any;
    modelUsed?: string;				// Real model version (e.g., "gemini-2.5-pro")
    apiUsed?: string;              // API service used (e.g., "Google Gemini API")
    llmTokens?: number;               
    mathpixCalls?: number;  
  };
  
  // Firestore timestamps (for backend compatibility)
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// SESSION TYPES
// ============================================================================

export interface UnifiedSession {
  id: string;
  title: string;
  messages: UnifiedMessage[];
  userId: string;
  messageType: 'Marking' | 'Question' | 'Chat' | 'Mixed';
  
  // Session timestamps
  createdAt: string;    // When session was created
  updatedAt: string;    // When session was last modified
  
  // User preferences
  favorite?: boolean;
  rating?: number;
  
  // Session-specific flags
  isPastPaper?: boolean;
  
  // Context
  contextSummary?: string;
  lastSummaryUpdate?: string;
  
  // Aggregated stats across ALL messages
  sessionStats?: {
    totalProcessingTimeMs?: number;   
    totalLlmTokens?: number;               
    totalMathpixCalls?: number;  
    totalMessages: number;            
    totalTokens?: number;   // sum of totalLlmTokens + totalMathpixCalls

    // Additional fields for Task Details dropdown
    imageSize?: number;           // For "Image Size" display
    averageConfidence?: number;   // For "Confidence" display  
    totalAnnotations?: number;    // For "Annotations" display
    lastApiUsed?: string;         // For consistency
    lastModelUsed?: string;       // For consistency
  };
}

// ============================================================================
// LIGHTWEIGHT SESSION (for sidebar)
// ============================================================================

export interface LightweightSession {
  id: string;
  title: string;
  userId: string;
  messageType: 'Marking' | 'Question' | 'Chat' | 'Mixed';
  createdAt: string;
  updatedAt: string;
  favorite?: boolean;
  rating?: number;
  
  // Lightweight preview data
  lastMessage?: {
    content: string;
    role: 'user' | 'assistant';
    timestamp: string;
  };
  
  // Session stats
  hasImage: boolean;
  lastApiUsed?: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface MarkHomeworkRequest {
  imageData: string;
  model: string;
  additionalInstructions?: string;
  userId?: string;
}

export interface MarkHomeworkResponse {
  success: boolean;
  session: UnifiedSession; // Full session data with all messages
  error?: string;
}

export interface ChatRequest {
  message: string;
  model: string;
  imageData?: string;
  sessionId?: string;
  userId?: string;
  mode?: 'marking' | 'question' | 'chat';
}

export interface ChatResponse {
  success: boolean;
  session: UnifiedSession; // Full session data with all messages
  error?: string;
}

// ============================================================================
