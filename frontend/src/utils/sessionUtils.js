/**
 * Session Utilities
 * Helper functions for working with UnifiedSessions
 * 
 * IMPORTANT: There are two different type fields:
 * 1. UnifiedSession.messageType - Overall session type ('Question', 'Marking', 'Chat', 'Mixed')
 * 2. UnifiedMessage.type - Individual message type ('marking_original', 'marking_annotated', 'question_original', 'question_response', etc.)
 * 
 * Use the appropriate utility function for the context:
 * - Session-level logic: isQuestionOnlySession(), isMarkingSession()
 * - Message-level logic: isMarkingMessage(), isQuestionMessage(), isOriginalImageMessage(), etc.
 */

/**
 * Check if a UnifiedSession is a question-only session
 * @param {UnifiedSession} unifiedSession - The unified session
 * @returns {boolean} - True if it's a question-only session
 */
export const isQuestionOnlySession = (unifiedSession) => {
  return unifiedSession?.messageType === 'Question';
};

/**
 * Check if a UnifiedSession is a marking session
 * @param {UnifiedSession} unifiedSession - The unified session
 * @returns {boolean} - True if it's a marking session
 */
export const isMarkingSession = (unifiedSession) => {
  return unifiedSession?.messageType === 'Marking';
};

/**
 * Check if a message is a marking message based on its type
 * @param {UnifiedMessage} message - The message to check
 * @returns {boolean} - True if it's a marking-related message
 */
export const isMarkingMessage = (message) => {
  return message?.type === 'marking_original' || 
         message?.type === 'marking_annotated' || 
         message?.type === 'question_original';
};

/**
 * Check if a message is a question message based on its type
 * @param {UnifiedMessage} message - The message to check
 * @returns {boolean} - True if it's a question-related message
 */
export const isQuestionMessage = (message) => {
  return message?.type === 'question_original' || 
         message?.type === 'question_response';
};

/**
 * Check if a message is an original image message (user uploaded)
 * @param {UnifiedMessage} message - The message to check
 * @returns {boolean} - True if it's an original image message
 */
export const isOriginalImageMessage = (message) => {
  return message?.type === 'marking_original' || 
         message?.type === 'question_original';
};

/**
 * Check if a message is an annotated image message (AI processed)
 * @param {UnifiedMessage} message - The message to check
 * @returns {boolean} - True if it's an annotated image message
 */
export const isAnnotatedImageMessage = (message) => {
  return message?.type === 'marking_annotated';
};

/**
 * Check if a message is a text response (AI generated)
 * @param {UnifiedMessage} message - The message to check
 * @returns {boolean} - True if it's a text response message
 */
export const isTextResponseMessage = (message) => {
  return message?.type === 'question_response' || 
         message?.type === 'marking_response';
};

/**
 * Get the session type for sidebar display
 * @param {UnifiedSession} unifiedSession - The unified session
 * @returns {string} - The session type ('question' or 'marking')
 */
export const getSessionTypeForSidebar = (unifiedSession) => {
  if (!unifiedSession) return 'marking';
  return isQuestionOnlySession(unifiedSession) ? 'question' : 'marking';
};

/**
 * Get the display title for a session
 * @param {UnifiedSession} unifiedSession - The unified session
 * @returns {string} - The display title
 */
export const getSessionDisplayTitle = (unifiedSession) => {
  if (!unifiedSession) return 'Unknown Session';
  
  const type = isQuestionOnlySession(unifiedSession) ? 'Question' : 'Marking';
  return `${type} Session`;
};

/**
 * Check if a session has any messages
 * @param {UnifiedSession} unifiedSession - The unified session
 * @returns {boolean} - True if the session has messages
 */
export const hasSessionMessages = (unifiedSession) => {
  return unifiedSession?.messages && unifiedSession.messages.length > 0;
};

/**
 * Get the last message from a session
 * @param {UnifiedSession} unifiedSession - The unified session
 * @returns {UnifiedMessage|null} - The last message or null
 */
export const getLastSessionMessage = (unifiedSession) => {
  if (!hasSessionMessages(unifiedSession)) return null;
  return unifiedSession.messages[unifiedSession.messages.length - 1];
};
