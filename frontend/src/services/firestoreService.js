/**
 * Frontend Firestore Service
 * Handles communication with backend chat API endpoints
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';

export class FirestoreService {
  /**
   * Get all chat sessions for a user
   * @param {string} userId - User identifier
   * @returns {Promise<Array>} Array of chat sessions
   */
  static async getChatSessions(userId) {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/tasks/${userId || 'anonymous'}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
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
      const response = await fetch(`${API_BASE_URL}/chat/task/${sessionId}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.success ? data.session : null;
    } catch (error) {
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
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'New chat session',
          imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', // 1x1 transparent PNG
          model: 'chatgpt-4o',
          userId: sessionData.userId,
          imageName: 'new-session.png'
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
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
      const headers = {
        'Content-Type': 'application/json',
      };

      // Add authorization header if token is provided
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${API_BASE_URL}/chat/task/${sessionId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
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
      const response = await fetch(`${API_BASE_URL}/chat/task/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
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
