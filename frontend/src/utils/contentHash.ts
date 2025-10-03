/**
 * Utility functions for generating content-based hashes
 * Used for creating stable message IDs across re-renders
 */

/**
 * Generates a simple hash from a string content
 * Uses a simple hash algorithm that matches the backend approach
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

/**
 * Generates a user message ID based on content
 * @param content - The message content
 * @returns A user message ID
 */
export function generateUserMessageId(content: string): string {
  const hash = generateContentHash(content);
  return `user-${hash}`;
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
 * Generates a message ID for any content type
 * @param content - The content to hash
 * @param prefix - The prefix for the ID (e.g., 'user', 'ai', 'msg')
 * @param timestamp - Optional timestamp for uniqueness
 * @returns A message ID
 */
export function generateMessageId(content: string, prefix: string, timestamp?: number): string {
  const hash = generateContentHash(content);
  const time = timestamp ? `-${timestamp}` : '';
  return `${prefix}-${hash}${time}`;
}
