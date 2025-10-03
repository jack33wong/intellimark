import { UnifiedMessage } from '../types';

/**
 * Utility functions for filtering and cleaning messages
 */

/**
 * Checks if a message is a "ghost message" (empty assistant message)
 * @param message - The message to check
 * @returns True if the message should be filtered out
 */
export function isGhostMessage(message: UnifiedMessage): boolean {
  if (message.role !== 'assistant') {
    return false;
  }
  
  // Keep assistant messages that have content or are processing
  const hasContent = message.content && message.content.trim() !== '';
  const isProcessing = message.isProcessing === true;
  const hasProgressData = !!message.progressData;
  
  // Filter out empty assistant messages that are not processing
  return !hasContent && !isProcessing && !hasProgressData;
}

/**
 * Filters out ghost messages from an array of messages
 * @param messages - Array of messages to filter
 * @returns Filtered array without ghost messages
 */
export function filterGhostMessages(messages: UnifiedMessage[]): UnifiedMessage[] {
  return messages.filter(message => !isGhostMessage(message));
}

/**
 * Checks if a message should be rendered
 * @param message - The message to check
 * @returns True if the message should be rendered
 */
export function shouldRenderMessage(message: UnifiedMessage): boolean {
  if (message.role === 'user') {
    return true; // Always render user messages
  }
  
  // For assistant messages, check if it's not a ghost message
  return !isGhostMessage(message);
}

/**
 * Validates message content and structure
 * @param message - The message to validate
 * @returns Object with validation results
 */
export function validateMessage(message: UnifiedMessage): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!message.id) {
    errors.push('Message missing ID');
  }
  
  if (!message.role || !['user', 'assistant'].includes(message.role)) {
    errors.push('Message missing or invalid role');
  }
  
  if (!message.timestamp) {
    errors.push('Message missing timestamp');
  }
  
  if (message.role === 'assistant' && !message.content && !message.isProcessing && !message.progressData) {
    errors.push('Assistant message has no content, processing state, or progress data');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
