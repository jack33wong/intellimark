/**
 * Common utilities for message handling
 * Provides consistent message appending logic for both authenticated and anonymous users
 */

import { ensureStringContent } from './contentUtils';

/**
 * Formats messages from backend response to frontend format
 * @param {Array} messages - Raw messages from backend
 * @param {string} apiUsed - API used for the response
 * @returns {Array} Formatted messages for frontend display
 */
export const formatMessages = (messages, apiUsed = null) => {
  if (!Array.isArray(messages)) return [];
  
  return messages.map(msg => ({
    id: msg.messageId || msg.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: msg.role,
    content: ensureStringContent(msg.content),
    timestamp: msg.timestamp,
    type: msg.type,
    detectedQuestion: msg.detectedQuestion,
    metadata: msg.metadata,
    apiUsed: msg.metadata?.apiUsed || apiUsed,
    imageLink: msg.imageLink // Include image link for display
  }));
};

/**
 * Deduplicates messages by ID to prevent duplicates
 * @param {Array} messages - Array of messages
 * @returns {Array} Deduplicated messages
 */
export const deduplicateMessages = (messages) => {
  const seen = new Set();
  return messages.filter(message => {
    if (seen.has(message.id)) {
      return false;
    }
    seen.add(message.id);
    return true;
  });
};

/**
 * Appends new follow-up messages to existing chat messages
 * Common logic for both authenticated and anonymous users
 * @param {Array} currentMessages - Current chat messages
 * @param {Array} newMessages - New messages to append
 * @returns {Array} Combined messages with deduplication
 */
export const appendFollowUpMessages = (currentMessages, newMessages) => {
  if (!Array.isArray(newMessages) || newMessages.length === 0) {
    return currentMessages;
  }
  
  const formattedNewMessages = formatMessages(newMessages);
  return deduplicateMessages([...currentMessages, ...formattedNewMessages]);
};

/**
 * Replaces all messages with complete session data
 * Used for initial load or history click
 * @param {Array} sessionMessages - Complete session messages from backend
 * @param {string} apiUsed - API used for the response
 * @returns {Array} Formatted and deduplicated messages
 */
export const replaceWithCompleteSession = (sessionMessages, apiUsed = null) => {
  const formattedMessages = formatMessages(sessionMessages, apiUsed);
  return deduplicateMessages(formattedMessages);
};

/**
 * Determines if response contains complete session or just new messages
 * @param {Object} response - Backend response
 * @returns {Object} Response type and messages
 */
export const parseResponse = (response) => {
  // Check for complete session response (authenticated users)
  const sessionMessages = response.session?.unifiedMessages || response.session?.messages || [];
  
  if (response.session && sessionMessages.length > 0) {
    return {
      type: 'complete_session',
      messages: sessionMessages,
      session: response.session
    };
  }
  
  // Check for new messages only (follow-up response)
  if (response.newMessages && Array.isArray(response.newMessages)) {
    return {
      type: 'follow_up',
      messages: response.newMessages,
      session: response.session
    };
  }
  
  // Fallback to old format (single AI response)
  if (response.response) {
    return {
      type: 'single_response',
      messages: [{
        role: 'assistant',
        content: response.response,
        timestamp: new Date().toISOString(),
        apiUsed: response.apiUsed
      }]
    };
  }
  
  return {
    type: 'unknown',
    messages: []
  };
};
