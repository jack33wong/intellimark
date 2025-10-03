import { generateUserMessageId, generateAIMessageId, generateMessageId } from './contentHash';

/**
 * Utility functions for generating message IDs
 * Centralizes all message ID generation logic
 */

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
  return generateUserMessageId(content);
}

/**
 * Generates an AI message ID
 * @param content - The message content
 * @param timestamp - Optional timestamp for uniqueness
 * @returns An AI message ID
 */
export function createAIMessageId(content: string, timestamp?: number): string {
  return generateAIMessageId(content, timestamp);
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
  return generateMessageId(content, prefix, timestamp);
}

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
