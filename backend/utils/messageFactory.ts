import { generateUserMessageId, generateAIMessageId } from './contentHash';
import type { UnifiedMessage } from '../types/index.js';

/**
 * Message creation utilities for consistent message objects
 */

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
    id: messageId || generateUserMessageId(content),
    messageId: messageId || generateUserMessageId(content),
    role: 'user',
    content: content || (imageData ? 'Image uploaded' : ''),
    type: 'chat_user',
    timestamp: new Date().toISOString(),
    imageLink: imageLink,
    imageData: imageData,
    detectedQuestion: { found: false, message: content || 'Chat message' },
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
    content: content || 'I have analyzed your homework and provided feedback.',
    type: isQuestionOnly ? 'question_response' : 'marking_annotated',
    timestamp: new Date().toISOString(),
    imageData: imageData || null,
    fileName: fileName || (isQuestionOnly ? null : 'annotated-image.png'),
    progressData: progressData,
    detectedQuestion: { found: false, message: 'AI response' },
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

/**
 * Creates a progress data object for AI processing
 * @param currentStep - Current processing step description
 * @param allSteps - All processing steps
 * @param completedSteps - Completed steps
 * @param isComplete - Whether processing is complete
 * @returns A progress data object
 */
export function createProgressData(
  currentStep: string,
  allSteps: string[],
  completedSteps: string[] = [],
  isComplete: boolean = false
) {
  return {
    isComplete,
    currentStepDescription: currentStep,
    allSteps,
    completedSteps
  };
}

/**
 * Creates a chat progress data object
 * @param isComplete - Whether processing is complete
 * @returns A chat progress data object
 */
export function createChatProgressData(isComplete: boolean = false) {
  return createProgressData(
    isComplete ? 'Generating response...' : 'Processing question...',
    ['Processing question...', 'Generating response...'],
    isComplete ? ['Processing question...', 'Generating response...'] : [],
    isComplete
  );
}

/**
 * Creates a marking progress data object
 * @param isComplete - Whether processing is complete
 * @returns A marking progress data object
 */
export function createMarkingProgressData(isComplete: boolean = false) {
  return createProgressData(
    isComplete ? 'Generating feedback...' : 'Analyzing image...',
    [
      'Analyzing image...',
      'Detecting question type...',
      'Extracting text and math...',
      'Generating feedback...',
      'Creating annotations...',
      'Finalizing response...',
      'Almost done...'
    ],
    isComplete ? [
      'Analyzing image...',
      'Detecting question type...',
      'Extracting text and math...',
      'Generating feedback...',
      'Creating annotations...',
      'Finalizing response...',
      'Almost done...'
    ] : [],
    isComplete
  );
}
