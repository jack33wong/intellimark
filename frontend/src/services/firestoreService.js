/**
 * Frontend Firestore Service
 * Handles communication with backend chat API endpoints
 */

import ApiClient from './apiClient';

export class FirestoreService {
  /**
   * Get all chat sessions for a user
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Array of chat sessions
   */
  static async getChatSessions(userId) {
    try {
      const data = await ApiClient.get(`/chat/sessions/${userId || 'anonymous'}`);
      return data.success ? data.sessions : [];
    } catch (error) {
      console.error('Failed to get chat sessions:', error);
      return [];
    }
  }

  /**
   * Get a specific chat session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Chat session or null if not found
   */
  static async getChatSession(sessionId) {
    try {
      const data = await ApiClient.get(`/chat/session/${sessionId}`);
      return data.success ? data.session : null;
    } catch (error) {
      if (error.message.includes('404')) {
        return null;
      }
      console.error('Failed to get chat session:', error);
      return null;
    }
  }

  /**
   * Create a new chat session
   * @param {Object} sessionData - Session data
   * @returns {Promise<string>} Session identifier
   */
  static async createChatSession(sessionData) {
    try {
      const data = await ApiClient.post('/chat', {
        message: 'New chat session',
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', // 1x1 transparent PNG
        model: 'chatgpt-4o',
        userId: sessionData.userId,
        imageName: 'new-session.png'
      });

      if (!data.success) {
        throw new Error(data.error || 'Failed to create chat session');
      }

      return data.sessionId;
    } catch (error) {
      console.error('Failed to create chat session:', error);
      throw error;
    }
  }

  /**
   * Update an existing chat session
   * @param {string} sessionId - Session identifier
   * @param {Object} updates - Fields to update
   * @param {string} authToken - Authentication token
   * @returns {Promise<boolean>} Success status
   */
  static async updateChatSession(sessionId, updates, authToken = null) {
    try {
      const data = await ApiClient.put(`/api/messages/session/${sessionId}`, updates, authToken);
      return data.success;
    } catch (error) {
      console.error('Failed to update chat session:', error);
      return false;
    }
  }

  /**
   * Add a message to an existing chat session
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message to add
   * @returns {Promise<boolean>} Success status
   */
  static async addMessageToSession(sessionId, message) {
    // This will be handled by the chat API when sending messages
    // We just need to ensure the session exists
    return true;
  }

  /**
   * Delete a chat session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} Success status
   */
  static async deleteChatSession(sessionId) {
    try {
      const data = await ApiClient.delete(`/chat/session/${sessionId}`);
      return data.success;
    } catch (error) {
      console.error('Failed to delete chat session:', error);
      return false;
    }
  }

  /**
   * Clear all chat sessions for a user
   * @param {string} userId - User identifier
   * @returns {Promise<boolean>} Success status
   */
  static async clearAllSessions(userId) {
    try {
      // For now, we'll delete sessions one by one
      const sessions = await this.getChatSessions(userId);
      const deletePromises = sessions.map(session => this.deleteChatSession(session.id));
      await Promise.all(deletePromises);
      return true;
    } catch (error) {
      console.error('Failed to clear all sessions:', error);
      return false;
    }
  }
}

export default FirestoreService;
