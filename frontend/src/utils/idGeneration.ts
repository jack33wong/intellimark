/**
 * Consolidated ID generation utilities
 * All ID generation logic in one place
 */

// ============================================================================
// CONTENT HASH GENERATION
// ============================================================================

/**
 * Generates a simple hash from a string content
 * @param content - The string content to hash
 * @param length - The desired hash length (default: 8)
 * @returns A base36 hash string
 */
export function generateContentHash(content: string, length: number = 8): string {
  if (!content || typeof content !== 'string') {
    return 'empty';
  }
  
  const hash = content.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  return Math.abs(hash).toString(36).substring(0, length);
}

// ============================================================================
// MESSAGE ID GENERATION
// ============================================================================

/**
 * Message ID types
 */
export type MessageIdType = 'user' | 'ai' | 'msg' | 'session';

/**
 * Generates a user message ID
 * @param content - The message content
 * @returns A user message ID
 */
export function createUserMessageId(content: string): string {
  return `user-${generateContentHash(content)}`;
}

/**
 * Generates an AI message ID
 * @param content - The message content
 * @param timestamp - Optional timestamp for uniqueness
 * @returns An AI message ID
 */
export function createAIMessageId(content: string, timestamp?: number): string {
  const hash = generateContentHash(content);
  const time = timestamp || Date.now();
  return `ai-${hash}-${time}`;
}

/**
 * Generates a session ID
 * @param userId - The user ID
 * @param timestamp - Optional timestamp
 * @returns A session ID
 */
export function createSessionId(userId?: string, timestamp?: number): string {
  const time = timestamp || Date.now();
  const user = userId ? `-${userId.substring(0, 8)}` : '';
  return `session-${time}${user}`;
}

/**
 * Generates a temporary session ID
 * @param timestamp - Optional timestamp
 * @returns A temporary session ID
 */
export function createTempSessionId(timestamp?: number): string {
  const time = timestamp || Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `temp-${time}-${random}`;
}

/**
 * Generates a message ID with a specific prefix
 * @param content - The content to hash
 * @param prefix - The prefix for the ID
 * @param timestamp - Optional timestamp
 * @returns A message ID
 */
export function createMessageId(content: string, prefix: MessageIdType, timestamp?: number): string {
  const hash = generateContentHash(content);
  const time = timestamp ? `-${timestamp}` : '';
  return `${prefix}-${hash}${time}`;
}

// ============================================================================
// ID VALIDATION AND UTILITIES
// ============================================================================

/**
 * Validates if a message ID has the correct format
 * @param messageId - The message ID to validate
 * @param expectedPrefix - The expected prefix
 * @returns True if the message ID is valid
 */
export function isValidMessageId(messageId: string, expectedPrefix?: MessageIdType): boolean {
  if (!messageId || typeof messageId !== 'string') {
    return false;
  }
  
  if (expectedPrefix) {
    return messageId.startsWith(`${expectedPrefix}-`);
  }
  
  // Check if it matches any known pattern
  const patterns = ['user-', 'ai-', 'msg-', 'session-', 'temp-'];
  return patterns.some(pattern => messageId.startsWith(pattern));
}

/**
 * Extracts the prefix from a message ID
 * @param messageId - The message ID
 * @returns The prefix or null if not found
 */
export function extractMessageIdPrefix(messageId: string): string | null {
  if (!messageId || typeof messageId !== 'string') {
    return null;
  }
  
  const match = messageId.match(/^([a-z]+)-/);
  return match ? match[1] : null;
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
