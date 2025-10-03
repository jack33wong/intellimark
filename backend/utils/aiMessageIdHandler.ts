import { generateAIMessageId } from './contentHash';

/**
 * Utility for handling AI message IDs consistently across all endpoints
 */

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
 * Validates an AI message ID
 * @param messageId - The message ID to validate
 * @returns True if the message ID is valid
 */
export function isValidAIMessageId(messageId: string): boolean {
  if (!messageId || typeof messageId !== 'string') {
    return false;
  }
  
  // Check if it starts with 'ai-' or matches expected patterns
  return messageId.startsWith('ai-') || 
         messageId.startsWith('msg-') || 
         messageId.length > 5; // Basic length check
}

/**
 * Extracts the content hash from an AI message ID
 * @param messageId - The AI message ID
 * @returns The content hash or null if not found
 */
export function extractContentHashFromAIMessageId(messageId: string): string | null {
  if (!messageId || typeof messageId !== 'string') {
    return null;
  }
  
  // Pattern: ai-{hash}-{timestamp} or msg-{hash}
  const match = messageId.match(/^(?:ai|msg)-([a-f0-9]+)(?:-\d+)?$/);
  return match ? match[1] : null;
}

/**
 * Creates a consistent AI message ID for different contexts
 * @param content - The content to hash
 * @param context - The context (chat, marking, question)
 * @param timestamp - Optional timestamp
 * @returns A consistent AI message ID
 */
export function createContextualAIMessageId(
  content: string, 
  context: 'chat' | 'marking' | 'question' = 'chat',
  timestamp?: number
): string {
  const time = timestamp || Date.now();
  
  switch (context) {
    case 'chat':
      return generateAIMessageId(content, time);
    case 'marking':
      return `ai-marking-${time}`;
    case 'question':
      return `ai-question-${time}`;
    default:
      return generateAIMessageId(content, time);
  }
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
