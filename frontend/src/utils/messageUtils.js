/**
 * Message Utility Functions
 * Extracted for consistent message handling across components
 */

// Message types
export const MESSAGE_TYPES = {
  CHAT: 'chat',
  MARKING_ORIGINAL: 'marking_original',
  MARKING_ANNOTATED: 'marking_annotated',
  QUESTION_ORIGINAL: 'question_original',
  QUESTION_RESPONSE: 'question_response',
  FOLLOW_UP: 'follow_up'
};

// Message roles
export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system'
};

/**
 * Create a new message object
 * @param {Object} options - Message options
 * @returns {Object} - Message object
 */
export const createMessage = (options = {}) => {
  const {
    id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role = MESSAGE_ROLES.USER,
    content = '',
    type = MESSAGE_TYPES.CHAT,
    imageLink = null,
    imageData = null,
    fileName = null,
    sessionId = null,
    userId = null,
    timestamp = new Date().toISOString(),
    metadata = {}
  } = options;

  return {
    id,
    role,
    content,
    type,
    imageLink,
    imageData,
    fileName,
    sessionId,
    userId,
    timestamp,
    metadata
  };
};

/**
 * Create a user message
 * @param {string} content - Message content
 * @param {Object} options - Additional options
 * @returns {Object} - User message object
 */
export const createUserMessage = (content, options = {}) => {
  return createMessage({
    role: MESSAGE_ROLES.USER,
    content,
    ...options
  });
};

/**
 * Create an assistant message
 * @param {string} content - Message content
 * @param {Object} options - Additional options
 * @returns {Object} - Assistant message object
 */
export const createAssistantMessage = (content, options = {}) => {
  return createMessage({
    role: MESSAGE_ROLES.ASSISTANT,
    content,
    ...options
  });
};

/**
 * Create a system message
 * @param {string} content - Message content
 * @param {Object} options - Additional options
 * @returns {Object} - System message object
 */
export const createSystemMessage = (content, options = {}) => {
  return createMessage({
    role: MESSAGE_ROLES.SYSTEM,
    content,
    ...options
  });
};

/**
 * Check if message is from user
 * @param {Object} message - Message object
 * @returns {boolean} - True if user message
 */
export const isUserMessage = (message) => {
  return message && message.role === MESSAGE_ROLES.USER;
};

/**
 * Check if message is from assistant
 * @param {Object} message - Message object
 * @returns {boolean} - True if assistant message
 */
export const isAssistantMessage = (message) => {
  return message && message.role === MESSAGE_ROLES.ASSISTANT;
};

/**
 * Check if message is from system
 * @param {Object} message - Message object
 * @returns {boolean} - True if system message
 */
export const isSystemMessage = (message) => {
  return message && message.role === MESSAGE_ROLES.SYSTEM;
};

/**
 * Check if message has image
 * @param {Object} message - Message object
 * @returns {boolean} - True if message has image
 */
export const hasImage = (message) => {
  return message && (message.imageLink || message.imageData);
};

/**
 * Get message preview text (first N characters)
 * @param {Object} message - Message object
 * @param {number} maxLength - Maximum length (default: 50)
 * @returns {string} - Preview text
 */
export const getMessagePreview = (message, maxLength = 50) => {
  if (!message || !message.content) {
    return 'No message content';
  }

  const content = (message.content || '').trim();
  if (content.length <= maxLength) {
    return content;
  }

  return content.substring(0, maxLength) + '...';
};

/**
 * Get message display text
 * @param {Object} message - Message object
 * @returns {string} - Display text
 */
export const getMessageDisplayText = (message) => {
  if (!message) {
    return 'No message';
  }

  if (message.content) {
    return message.content;
  }

  if (hasImage(message)) {
    return 'Image message';
  }

  return 'Empty message';
};

/**
 * Get message timestamp in readable format
 * @param {Object} message - Message object
 * @returns {string} - Formatted timestamp
 */
export const getMessageTimestamp = (message) => {
  if (!message || !message.timestamp) {
    return 'Unknown time';
  }

  try {
    const date = new Date(message.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return 'Invalid time';
  }
};

/**
 * Get message date in readable format
 * @param {Object} message - Message object
 * @returns {string} - Formatted date
 */
export const getMessageDate = (message) => {
  if (!message || !message.timestamp) {
    return 'Unknown date';
  }

  try {
    const date = new Date(message.timestamp);
    return date.toLocaleDateString();
  } catch (error) {
    return 'Invalid date';
  }
};

/**
 * Sort messages by timestamp
 * @param {Array} messages - Array of messages
 * @param {boolean} ascending - Sort order (default: true)
 * @returns {Array} - Sorted messages
 */
export const sortMessagesByTimestamp = (messages, ascending = true) => {
  if (!Array.isArray(messages)) {
    return [];
  }

  return [...messages].sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    
    return ascending ? timeA - timeB : timeB - timeA;
  });
};

/**
 * Filter messages by role
 * @param {Array} messages - Array of messages
 * @param {string} role - Role to filter by
 * @returns {Array} - Filtered messages
 */
export const filterMessagesByRole = (messages, role) => {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.filter(message => message.role === role);
};

/**
 * Get last message from array
 * @param {Array} messages - Array of messages
 * @returns {Object|null} - Last message or null
 */
export const getLastMessage = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const sortedMessages = sortMessagesByTimestamp(messages, true);
  return sortedMessages[sortedMessages.length - 1];
};

/**
 * Get message count by role
 * @param {Array} messages - Array of messages
 * @returns {Object} - Count by role
 */
export const getMessageCountByRole = (messages) => {
  if (!Array.isArray(messages)) {
    return { user: 0, assistant: 0, system: 0 };
  }

  return messages.reduce((counts, message) => {
    const role = message.role || 'unknown';
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, { user: 0, assistant: 0, system: 0 });
};

/**
 * Check if message is recent (within last N minutes)
 * @param {Object} message - Message object
 * @param {number} minutes - Minutes threshold (default: 5)
 * @returns {boolean} - True if recent
 */
export const isRecentMessage = (message, minutes = 5) => {
  if (!message || !message.timestamp) {
    return false;
  }

  try {
    const messageTime = new Date(message.timestamp).getTime();
    const now = Date.now();
    const threshold = minutes * 60 * 1000; // Convert to milliseconds
    
    return (now - messageTime) <= threshold;
  } catch (error) {
    return false;
  }
};

/**
 * Deduplicate messages by ID
 * @param {Array} messages - Array of messages
 * @returns {Array} - Deduplicated messages
 */
export const deduplicateMessages = (messages) => {
  if (!Array.isArray(messages)) {
    return [];
  }

  const seen = new Set();
  return messages.filter(message => {
    if (!message || !message.id) {
      return false;
    }
    
    if (seen.has(message.id)) {
      return false;
    }
    
    seen.add(message.id);
    return true;
  });
};

/**
 * Parse API response to determine type
 * @param {Object} data - API response data
 * @returns {Object} - Parsed response with type and messages
 */
export const parseResponse = (data) => {
  if (!data) {
    return { type: 'error', messages: [] };
  }

  // Check if it's a complete session response
  if (data.session && data.session.messages) {
    return {
      type: 'complete_session',
      messages: data.session.messages,
      session: data.session
    };
  }

  // Check if it's a follow-up response
  if (data.newMessages && Array.isArray(data.newMessages)) {
    return {
      type: 'follow_up',
      messages: data.newMessages
    };
  }

  // Check if it's a single message response
  if (data.userMessage || data.aiMessage) {
    const messages = [];
    if (data.userMessage) messages.push(data.userMessage);
    if (data.aiMessage) messages.push(data.aiMessage);
    
    return {
      type: 'single_message',
      messages
    };
  }

  // Default to error
  return { type: 'error', messages: [] };
};

/**
 * Replace messages with complete session data
 * @param {Array} newMessages - New messages from API
 * @param {string} apiUsed - API used indicator
 * @returns {Array} - Complete message array
 */
export const replaceWithCompleteSession = (newMessages, apiUsed) => {
  if (!Array.isArray(newMessages)) {
    return [];
  }

  // Map message IDs for frontend compatibility
  return newMessages.map(msg => ({
    ...msg,
    id: msg.id || msg.messageId,
    messageId: msg.messageId || msg.id
  }));
};

/**
 * Append follow-up messages to existing messages
 * @param {Array} existingMessages - Current messages
 * @param {Array} newMessages - New messages to append
 * @returns {Array} - Combined messages array
 */
export const appendFollowUpMessages = (existingMessages, newMessages) => {
  if (!Array.isArray(existingMessages)) {
    existingMessages = [];
  }

  if (!Array.isArray(newMessages)) {
    return existingMessages;
  }

  // Map message IDs for frontend compatibility
  const mappedNewMessages = newMessages.map(msg => ({
    ...msg,
    id: msg.id || msg.messageId,
    messageId: msg.messageId || msg.id
  }));

  // Combine and deduplicate
  return deduplicateMessages([...existingMessages, ...mappedNewMessages]);
};