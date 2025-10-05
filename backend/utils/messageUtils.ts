import crypto from 'crypto';
import type { UnifiedMessage } from '../types/index.js';

/**
 * Consolidated message utilities for backend
 * All message-related functionality in one place
 */

// ============================================================================
// CONTENT HASH GENERATION
// ============================================================================

/**
 * Generates a content hash using MD5 algorithm
 * @param content - The content to hash
 * @param length - The desired hash length (default: 8)
 * @returns A hex hash string
 */
export function generateContentHash(content: string, length: number = 8): string {
  if (!content || typeof content !== 'string') {
    return 'empty';
  }
  
  return crypto.createHash('md5').update(content).digest('hex').substring(0, length);
}

// ============================================================================
// MESSAGE ID GENERATION
// ============================================================================

/**
 * Generates a user message ID based on content with timestamp for uniqueness
 * 
 * ============================================================================
 * CRITICAL: UNIQUE MESSAGE ID GENERATION FOR BACKEND
 * ============================================================================
 * 
 * IMPORTANT: This timestamp-based ID generation is ESSENTIAL and must NOT be changed!
 * 
 * Why this design is critical:
 * 1. PREVENTS DUPLICATE MESSAGE IDS: Users can send identical text multiple times
 *    (e.g., "2 + 2" and "2+2") and each must get a unique ID
 * 2. REACT KEY UNIQUENESS: Frontend React requires unique keys for list items
 * 3. DATABASE INTEGRITY: Prevents duplicate key conflicts in Firestore
 * 4. SESSION MANAGEMENT: Each message must be uniquely identifiable
 * 
 * DO NOT REMOVE TIMESTAMP:
 * - Content-based hashing alone causes duplicate IDs for identical content
 * - Timestamp ensures uniqueness even for identical content
 * - This was the root cause of the "duplicate children" React warnings
 * 
 * This approach guarantees uniqueness:
 * - Content hash provides content-based identification
 * - Timestamp ensures uniqueness even for identical content
 * - Format: msg-{contentHash}-{timestamp}
 * ============================================================================
 * 
 * @param content - The message content
 * @param timestamp - Optional timestamp for uniqueness
 * @returns A user message ID
 */
export function generateUserMessageId(content: string, timestamp?: number): string {
  const hash = generateContentHash(content);
  const time = timestamp || Date.now();
  return `msg-${hash}-${time}`;
}

/**
 * Generates an AI message ID based on content
 * @param content - The message content
 * @param timestamp - Optional timestamp for uniqueness
 * @returns An AI message ID
 */
export function generateAIMessageId(content: string, timestamp?: number): string {
  const hash = generateContentHash(content);
  const time = timestamp || Date.now();
  return `ai-${hash}-${time}`;
}

/**
 * Generates a message ID with a specific prefix
 * @param content - The content to hash
 * @param prefix - The prefix for the ID (e.g., 'msg', 'ai', 'user')
 * @param timestamp - Optional timestamp for uniqueness
 * @returns A message ID
 */
export function generateMessageId(content: string, prefix: string, timestamp?: number): string {
  const hash = generateContentHash(content);
  const time = timestamp ? `-${timestamp}` : '';
  return `${prefix}-${hash}${time}`;
}

/**
 * Generates a session ID
 * @param userId - Optional user ID
 * @param timestamp - Optional timestamp
 * @returns A session ID
 */
export function generateSessionId(userId?: string, timestamp?: number): string {
  const time = timestamp || Date.now();
  const user = userId ? `-${userId.substring(0, 8)}` : '';
  const random = Math.random().toString(36).substr(2, 9);
  return `session-${time}${user}-${random}`;
}

/**
 * Generates a temporary session ID
 * @param timestamp - Optional timestamp
 * @returns A temporary session ID
 */
export function generateTempSessionId(timestamp?: number): string {
  const time = timestamp || Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `temp-${time}-${random}`;
}

// ============================================================================
// MESSAGE CREATION
// ============================================================================

export interface UserMessageOptions {
  content: string;
  imageLink?: string;
  imageData?: string;
  sessionId?: string;
  model?: string;
  messageId?: string;
}

export interface AIMessageOptions {
  content: string;
  imageData?: string;
  fileName?: string;
  progressData?: any;
  metadata?: any;
  messageId?: string;
  isQuestionOnly?: boolean;
}

/**
 * Creates a user message object
 * @param options - User message options
 * @returns A user message object
 */
export function createUserMessage(options: UserMessageOptions): UnifiedMessage {
  const {
    content,
    imageLink,
    imageData,
    sessionId,
    model = 'auto',
    messageId
  } = options;

  return {
    // CRITICAL: Always pass Date.now() to ensure unique IDs for identical content
    // DO NOT remove Date.now() - this prevents duplicate message ID conflicts
    id: messageId || generateUserMessageId(content, Date.now()),
    messageId: messageId || generateUserMessageId(content, Date.now()),
    role: 'user',
    content: content || (imageData ? 'Image uploaded' : ''),
    type: 'chat',
    timestamp: new Date().toISOString(),
    imageLink: imageLink,
    detectedQuestion: { found: false, message: content || 'User message' },
    metadata: {
      resultId: `chat-${Date.now()}`,
      processingTime: new Date().toISOString(),
      totalProcessingTimeMs: 0,
      modelUsed: model,
      totalAnnotations: 0,
      imageSize: imageData ? imageData.length : 0,
      confidence: 0,
      tokens: [0, 0],
      ocrMethod: 'Chat'
    }
  };
}

/**
 * Creates an AI message object
 * @param options - AI message options
 * @returns An AI message object
 */
export function createAIMessage(options: AIMessageOptions): UnifiedMessage {
  const {
    content,
    imageData,
    fileName,
    progressData,
    metadata,
    messageId,
    isQuestionOnly = false
  } = options;

  return {
    id: messageId || generateAIMessageId(content),
    messageId: messageId || generateAIMessageId(content),
    role: 'assistant',
    content: content,
    type: isQuestionOnly ? 'question_response' : 'marking_annotated',
    timestamp: new Date().toISOString(),
    fileName: fileName || (isQuestionOnly ? null : 'annotated-image.png'),
    progressData: progressData,
    detectedQuestion: { found: false, message: content },
    metadata: {
      resultId: `chat-${Date.now()}`,
      processingTime: new Date().toISOString(),
      totalProcessingTimeMs: 0,
      modelUsed: 'auto',
      totalAnnotations: 0,
      imageSize: imageData ? imageData.length : 0,
      confidence: 0,
      tokens: [0, 0],
      ocrMethod: 'Chat',
      ...metadata
    }
  };
}

// ============================================================================
// PROGRESS DATA CREATION
// ============================================================================

/**
 * Creates a chat progress data object
 * @param isComplete - Whether processing is complete
 * @returns A chat progress data object
 */
export function createChatProgressData(isComplete: boolean = false) {
  return {
    isComplete,
    currentStepDescription: isComplete ? 'Generating response...' : 'AI is thinking...',
    allSteps: isComplete ? ['AI is thinking...', 'Generating response...'] : ['AI is thinking...'],
    currentStepIndex: isComplete ? 1 : 0 // Use new format with currentStepIndex
  };
}

// ============================================================================
// AI MESSAGE ID HANDLING
// ============================================================================

export interface AIMessageIdOptions {
  providedId?: string;
  content: string;
  fallbackPrefix?: string;
  timestamp?: number;
}

/**
 * Resolves the AI message ID to use, with fallback logic
 * @param options - AI message ID options
 * @returns The resolved AI message ID
 */
export function resolveAIMessageId(options: AIMessageIdOptions): string {
  const { providedId, content, fallbackPrefix = 'ai', timestamp } = options;
  
  // Use provided ID if valid
  if (providedId && typeof providedId === 'string' && providedId.trim() !== '') {
    return providedId;
  }
  
  // Generate fallback ID based on content
  if (fallbackPrefix === 'ai') {
    return generateAIMessageId(content, timestamp);
  }
  
  // Generate fallback ID with custom prefix
  const time = timestamp || Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${fallbackPrefix}-${time}-${random}`;
}

/**
 * Handles AI message ID resolution for different endpoint types
 * @param requestBody - The request body containing aiMessageId
 * @param content - The AI response content
 * @param endpointType - The type of endpoint (chat, marking, question)
 * @returns The resolved AI message ID
 */
export function handleAIMessageIdForEndpoint(
  requestBody: any,
  content: string,
  endpointType: 'chat' | 'marking' | 'question' = 'chat'
): string {
  const providedId = requestBody.aiMessageId;
  
  return resolveAIMessageId({
    providedId,
    content,
    fallbackPrefix: 'ai',
    timestamp: Date.now()
  });
}
