import crypto from 'crypto';

/**
 * Backend utility functions for generating content-based hashes
 * Used for creating stable message IDs across re-renders
 */

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

/**
 * Generates a user message ID based on content
 * @param content - The message content
 * @returns A user message ID
 */
export function generateUserMessageId(content: string): string {
  const hash = generateContentHash(content);
  return `msg-${hash}`;
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

/**
 * Validates if a message ID has the correct format
 * @param messageId - The message ID to validate
 * @param expectedPrefix - The expected prefix
 * @returns True if the message ID is valid
 */
export function isValidMessageId(messageId: string, expectedPrefix?: string): boolean {
  if (!messageId || typeof messageId !== 'string') {
    return false;
  }
  
  if (expectedPrefix) {
    return messageId.startsWith(`${expectedPrefix}-`);
  }
  
  // Check if it matches any known pattern
  const patterns = ['msg-', 'ai-', 'user-', 'session-', 'temp-'];
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
