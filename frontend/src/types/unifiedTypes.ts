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
  
  // AI metadata
  model?: string;
  apiUsed?: string;
  
  // Display options
  isImageContext?: boolean;
  
  // Question detection (simplified)
  detectedQuestion?: {
    found: boolean;
    questionText?: string;
    message?: string;
  };
  
  // Processing metadata (matches backend)
  metadata?: {
    resultId?: string;
    processingTime?: string;
    totalProcessingTimeMs?: number;
    modelUsed?: string;
    tokens?: number[];
    confidence?: number;
    totalAnnotations?: number;
    imageSize?: number;
    ocrMethod?: string;
    classificationResult?: any;
    apiUsed?: string;
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
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  
  // User preferences
  favorite?: boolean;
  rating?: number;
  
  // Context
  contextSummary?: string;
  lastSummaryUpdate?: string;
  
  // Session metadata
  sessionMetadata?: {
    totalProcessingTimeMs?: number;
    totalTokens?: number;
    averageConfidence?: number;
    lastApiUsed?: string;
    lastModelUsed?: string;
    totalMessages?: number;
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
  messageCount: number;
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
// LOCAL SESSION SERVICE TYPES
// ============================================================================

export interface SessionManagerState {
  // Full session data (only 1 in memory)
  currentSession: UnifiedSession | null;
  
  // Lightweight sessions (up to 50 in memory)
  sidebarSessions: LightweightSession[];
  
  // Loading states
  isLoading: boolean;
  isProcessing: boolean;
  
  // Error handling
  error: string | null;
}

export interface SessionManagerActions {
  // Session management
  loadSession: (sessionId: string) => Promise<void>;
  createSession: (sessionData: Partial<UnifiedSession>) => Promise<string>;
  updateSession: (sessionId: string, updates: Partial<UnifiedSession>) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  
  // Message management
  addMessage: (message: UnifiedMessage) => Promise<void>;
  updateMessage: (messageId: string, updates: Partial<UnifiedMessage>) => Promise<void>;
  
  // Sidebar management
  refreshSidebar: () => Promise<void>;
  clearAllSessions: () => Promise<void>;
  
  // Processing
  processImage: (imageData: string, model: string, mode: 'marking' | 'question') => Promise<UnifiedSession>;
  sendMessage: (message: string, imageData?: string) => Promise<void>;
}
