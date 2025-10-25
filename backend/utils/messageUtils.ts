import crypto from 'crypto';
import type { UnifiedMessage, DetectedQuestion } from '../types/index.js';

/**
 * Consolidated message utilities for backend
 * All message-related functionality in one place
 */

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Creates a default detected question object
 */
function createDefaultDetectedQuestion(): any {
  return {
    found: false,
    questionText: '',
    questionNumber: '',
    subQuestionNumber: '',
    examBoard: '',
    examCode: '',
    paperTitle: '',
    subject: '',
    tier: '',
    year: '',
    marks: 0
  };
}

/**
 * Checks if detected question is empty
 */
function isEmptyDetectedQuestion(detectedQuestion: any): boolean {
  if (!detectedQuestion) return true;
  return !detectedQuestion.found && 
         !detectedQuestion.questionText && 
         !detectedQuestion.questionNumber;
}

/**
 * Check if processing stats are empty (all default/zero values)
 * For user messages, we consider stats empty if they only contain default values
 */
function isEmptyProcessingStats(stats: any): boolean {
  return (
    stats.processingTimeMs === 0 &&
    stats.annotations === 0 &&
    stats.confidence === 0 &&
    stats.llmTokens === 0 &&
    stats.mathpixCalls === 0 &&
    stats.ocrMethod === 'Chat' &&
    // For user messages, imageSize can be 0 (no image) or > 0 (has image)
    // We only exclude if it's 0 AND there's no actual processing done
    (stats.imageSize === 0 || stats.imageSize === undefined)
  );
}

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

// New structured image data interface
export interface StructuredImageData {
  url: string;
  originalFileName: string;
  fileSize: number;
}

export interface UserMessageOptions {
  content: string;
  imageLink?: string;
  imageData?: string;
  imageDataArray?: StructuredImageData[]; // New structured format
  sessionId?: string;
  model?: string;
  messageId?: string;
  originalFileType?: 'pdf';
  pdfContexts?: StructuredImageData[]; // For PDFs, using same structure
  detectedQuestion?: DetectedQuestion;
}

export interface AIMessageOptions {
  content: string;
  imageData?: string;
  imageDataArray?: StructuredImageData[]; // New structured format
  originalFileName?: string;
  progressData?: any;
  processingStats?: any;
  messageId?: string;
  isQuestionOnly?: boolean;
  suggestedFollowUps?: Array<{ text: string; mode: string }> | string[];
  detectedQuestion?: DetectedQuestion;
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
    imageDataArray,
    sessionId,
    model = 'auto',
    messageId,
    originalFileType,
    pdfContexts
  } = options;

  console.log('🔍 [CREATE USER MESSAGE DEBUG] Options:', {
    content: content?.substring(0, 50) + '...',
    originalFileType,
    hasPdfContexts: !!pdfContexts,
    pdfContextsLength: pdfContexts?.length,
    pdfContexts: pdfContexts?.map(ctx => ({
      fileName: ctx.originalFileName,
      fileSize: ctx.fileSize,
      hasUrl: !!ctx.url
    }))
  });

  // Create default objects
  const defaultProcessingStats = {
    processingTimeMs: 0,
    modelUsed: model,
    annotations: 0,
    imageSize: imageData ? imageData.length : 0,
    confidence: 0,
    llmTokens: 0,
    mathpixCalls: 0,
    ocrMethod: 'Chat',
    apiUsed: 'Unknown API' // Will be overridden with real values when available
  };

  // Build the message object
  const message: UnifiedMessage = {
    // CRITICAL: Always pass Date.now() to ensure unique IDs for identical content
    // DO NOT remove Date.now() - this prevents duplicate message ID conflicts
    id: messageId || generateUserMessageId(content, Date.now()),
    messageId: messageId || generateUserMessageId(content, Date.now()),
    role: 'user',
    content: content || (imageData ? 'Image uploaded' : (imageDataArray ? `${imageDataArray.length} image(s) uploaded` : (originalFileType === 'pdf' ? 'PDF uploaded' : ''))),
    type: 'chat',
    timestamp: new Date().toISOString(),
    imageLink: imageLink,
    imageData: imageData,
    imageDataArray: imageDataArray,
    pdfContexts: pdfContexts
  };


  // Only include processingStats if it has meaningful data
  // For user messages, include if there's image data or other meaningful stats
  if (imageData || imageDataArray || !isEmptyProcessingStats(defaultProcessingStats)) {
    message.processingStats = defaultProcessingStats;
  }

  // Add PDF context if applicable
  if (originalFileType === 'pdf') {
    (message as any).originalFileType = 'pdf';
  }

  // Add detectedQuestion if provided
  if (options.detectedQuestion && !isEmptyDetectedQuestion(options.detectedQuestion)) {
    message.detectedQuestion = options.detectedQuestion;
  }

  console.log('🔍 [CREATE USER MESSAGE DEBUG] Final message:', {
    id: message.id,
    role: message.role,
    originalFileType: (message as any).originalFileType,
    hasPdfContexts: !!(message as any).pdfContexts,
    pdfContextsLength: (message as any).pdfContexts?.length,
    pdfContexts: (message as any).pdfContexts?.map((ctx: any) => ({
      fileName: ctx.originalFileName,
      fileSize: ctx.fileSize,
      hasUrl: !!ctx.url
    }))
  });

  return message;
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
    imageDataArray,
    progressData,
    processingStats,
    messageId,
    isQuestionOnly = false,
    suggestedFollowUps
  } = options;

  // Determine message type based on content and context
  let messageType: 'chat' | 'marking_original' | 'marking_annotated' | 'question_original' | 'question_response' | 'follow_up';
  if (isQuestionOnly) {
    messageType = 'question_response';
  } else if (imageData) {
    // If there's image data, it's likely a marking response
    messageType = 'marking_annotated';
  } else {
    // Text-only chat response
    messageType = 'chat';
  }

  // Create default objects
  const defaultProcessingStats = {
    processingTimeMs: 0,
    modelUsed: 'auto',
    annotations: 0,
    imageSize: imageData ? imageData.length : 0,
    confidence: 0,
    llmTokens: 0,
    mathpixCalls: 0,
    ocrMethod: 'Chat',
    apiUsed: 'Unknown API', // Will be overridden with real values when available
    ...processingStats
  };

  // Build the message object
  const message: UnifiedMessage = {
    id: messageId || generateAIMessageId(content),
    messageId: messageId || generateAIMessageId(content),
    role: 'assistant',
    content: content,
    type: messageType,
    timestamp: new Date().toISOString(),
    imageData: imageData, // Include imageData for unauthenticated users
    imageDataArray: imageDataArray, // Include imageDataArray for multi-image cases
    progressData: progressData,
    suggestedFollowUps: suggestedFollowUps
  };


  // Only include processingStats if it has meaningful data
  // For AI messages, include if there's image data or other meaningful stats
  if (imageData || imageDataArray || !isEmptyProcessingStats(defaultProcessingStats)) {
    message.processingStats = defaultProcessingStats;
  }

  // Add detectedQuestion if provided
  if (options.detectedQuestion && !isEmptyDetectedQuestion(options.detectedQuestion)) {
    message.detectedQuestion = options.detectedQuestion;
  }

  return message;
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
// PROCESSING STATS CALCULATION (Reusing existing logic)
// ============================================================================

/**
 * Calculate real processing stats for a message (reusing logic from originalPipeline.ts)
 */
export function calculateMessageProcessingStats(
  aiResponse: any,
  actualModel: string,
  processingTimeMs: number,
  annotations: any[] = [],
  imageSize: number = 0,
  questionResults: any[] = []
): any {
  // Get real API name (reusing logic from sessionManagementService.ts)
  const getRealApiName = (modelName: string): string => {
    if (modelName.includes('gemini')) {
      return 'Google Gemini API';
    }
    return 'Unknown API';
  };

  // Get real model name (reusing logic from sessionManagementService.ts)
  const getRealModelName = (modelType: string): string => {
    if (modelType === 'auto') {
      return 'gemini-2.5-flash'; // Default model for auto
    }
    return modelType;
  };

  const realModel = getRealModelName(actualModel);
  const realApi = getRealApiName(realModel);

  // Calculate total LLM tokens from question results if available
  const totalLlmTokens = questionResults.length > 0 
    ? questionResults.reduce((sum, q) => sum + (q.usageTokens || 0), 0)
    : (aiResponse?.usageTokens || 0);

  // Calculate total mathpix calls from question results if available
  const totalMathpixCalls = questionResults.length > 0 
    ? questionResults.reduce((sum, q) => sum + (q.mathpixCalls || 0), 0)
    : 0;

  return {
    processingTimeMs,
    modelUsed: realModel,
    apiUsed: realApi,
    annotations: annotations.length,
    imageSize,
    confidence: aiResponse?.confidence || 0,
    llmTokens: totalLlmTokens,
    mathpixCalls: totalMathpixCalls,
    ocrMethod: 'Google Vision API' // TODO: Get real OCR method from processing
  };
}

/**
 * Calculate session-level totals and averages (reusing logic from originalPipeline.ts)
 */
export function calculateSessionStats(
  allQuestionResults: any[],
  totalProcessingTimeMs: number,
  actualModel: string,
  files: any[] = []
): any {
  // Get real API name (reusing logic from sessionManagementService.ts)
  const getRealApiName = (modelName: string): string => {
    if (modelName.includes('gemini')) {
      return 'Google Gemini API';
    }
    return 'Unknown API';
  };

  // Get real model name (reusing logic from sessionManagementService.ts)
  const getRealModelName = (modelType: string): string => {
    if (modelType === 'auto') {
      return 'gemini-2.5-flash'; // Default model for auto
    }
    return modelType;
  };

  const realModel = getRealModelName(actualModel);
  const realApi = getRealApiName(realModel);

  // Calculate totals (reusing logic from originalPipeline.ts)
  const totalAnnotations = allQuestionResults.reduce((sum, q) => sum + (q.annotations?.length || 0), 0);
  const totalLlmTokens = allQuestionResults.reduce((sum, q) => sum + (q.usageTokens || 0), 0);
  const totalMathpixCalls = allQuestionResults.reduce((sum, q) => sum + (q.mathpixCalls || 0), 0);
  const totalTokens = totalLlmTokens + totalMathpixCalls;

  // Calculate average confidence (reusing logic from imageAnnotationService.ts)
  const confidences = allQuestionResults
    .map(q => q.confidence || 0)
    .filter(c => c > 0);
  const averageConfidence = confidences.length > 0 
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length 
    : 0;

  return {
    totalProcessingTimeMs,
    lastModelUsed: realModel,
    lastApiUsed: realApi,
    totalLlmTokens,
    totalMathpixCalls,
    totalTokens,
    averageConfidence,
    imageSize: files.reduce((sum, f) => sum + f.size, 0),
    totalAnnotations
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
