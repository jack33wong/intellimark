/**
 * Service for managing marking history from sessions
 */

import API_CONFIG from '../config/api';

const API_BASE = API_CONFIG.BASE_URL;

class MarkingHistoryService {
  static inFlightRequests = new Map();

  /**
   * Get marking history from sessions for a specific user
   * @param {string} userId - The user ID
   * @param {number} limit - Maximum number of sessions to return
   * @param {string} authToken - Authentication token (optional)
   * @returns {Promise<Object>} The marking history data from sessions
   */
  static async getMarkingHistoryFromSessions(userId, limit = 50, authToken = null, lastUpdatedAt = null, messageType = null) {
    const requestKey = `${userId}-${limit}-${lastUpdatedAt}-${messageType}`;

    if (this.inFlightRequests.has(requestKey)) {
      return this.inFlightRequests.get(requestKey);
    }

    const fetchPromise = (async () => {
      try {
        // Use new messages API instead of old chat API
        let url = `${API_BASE}/api/messages/sessions/${userId}?limit=${limit}`;
        if (lastUpdatedAt && lastUpdatedAt !== 'undefined' && lastUpdatedAt !== 'null') {
          url += `&lastUpdatedAt=${encodeURIComponent(lastUpdatedAt)}`;
        }
        if (messageType && messageType !== 'all') {
          url += `&messageType=${encodeURIComponent(messageType)}`;
        }


        const headers = {
          'Content-Type': 'application/json',
        };

        // Add authorization header if token is provided
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(url, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Check if the response has sessions array
        const sessions = result.sessions || result;

        // Filter sessions that contain any messages OR have a lastMessage preview
        // This is necessary because optimized sessions return messages as an empty array
        const markingSessions = sessions.filter(session =>
          (session.messages && session.messages.length > 0) || session.lastMessage
        );

        return {
          success: true,
          userId: userId,
          sessions: markingSessions,
          total: markingSessions.length,
          limit: limit
        };
      } finally {
        this.inFlightRequests.delete(requestKey);
      }
    })();

    this.inFlightRequests.set(requestKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Get marking messages from a specific session
   * @param {string} sessionId - The session ID
   * @param {string} authToken - Authentication token (optional)
   * @returns {Promise<Object>} The marking messages from the session
   */
  static async getMarkingMessagesFromSession(sessionId, authToken = null) {
    try {
      // Use new messages API instead of old chat API
      const url = `${API_BASE}/api/messages/session/${sessionId}`;

      const headers = {
        'Content-Type': 'application/json',
      };

      // Add authorization header if token is provided
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      const session = result.session;

      // Filter only marking messages
      const markingMessages = session.messages.filter(msg =>
        msg.type === 'marking_original' || msg.type === 'marking_annotated'
      );

      return {
        success: true,
        sessionId: sessionId,
        messages: markingMessages,
        session: session
      };
    } catch (error) {
      console.error('Error fetching marking messages from session:', error);
      throw error;
    }
  }


  /**
   * Update a chat session
   * @param {string} sessionId - The session ID to update
   * @param {object} updates - The updates to apply (title, favorite, rating, etc.)
   * @param {string} authToken - Authentication token (required)
   * @returns {Promise<Object>} The update result
   */
  static async updateSession(sessionId, updates, authToken) {
    try {
      const url = `${API_BASE}/api/messages/session/${sessionId}`;

      const headers = {
        'Content-Type': 'application/json',
      };

      // Add authorization header (required for updates)
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        throw new Error('Authentication token is required to update sessions');
      }

      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updates)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();

      return {
        success: true,
        sessionId: sessionId,
        message: result.message || 'Session updated successfully',
        session: result.session
      };
    } catch (error) {
      console.error('Error updating session:', error);
      throw error;
    }
  }

  /**
   * Delete a chat session
   * @param {string} sessionId - The session ID to delete
   * @param {string} authToken - Authentication token (required)
   * @returns {Promise<Object>} The deletion result
   */
  static async deleteSession(sessionId, authToken) {
    try {
      const url = `${API_BASE}/api/messages/session/${sessionId}`;

      const headers = {
        'Content-Type': 'application/json',
      };

      // Add authorization header (required for deletion)
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      } else {
        throw new Error('Authentication token is required to delete sessions');
      }

      const response = await fetch(url, {
        method: 'DELETE',
        headers,
      });


      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();

      return {
        success: true,
        sessionId: sessionId,
        message: result.message || 'Session deleted successfully'
      };
    } catch (error) {
      console.error('Error deleting session:', error);
      throw error;
    }
  }


  /**
   * Extract question text from marking message for display
   * @param {Object} message - The marking message object
   * @returns {string} The extracted question text
   */
  static extractQuestionText(message) {
    if (!message) {
      throw new Error('Message is null or undefined');
    }

    // Try to get OCR text from markingData first
    if (message.markingData && message.markingData.ocrResult && message.markingData.ocrResult.ocrText) {
      const text = message.markingData.ocrResult.ocrText.trim();
      if (text) {
        // Truncate long text for display
        return text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
    }

    // Fallback to classification reasoning
    if (message.markingData && message.markingData.classification && message.markingData.classification.reasoning) {
      const text = message.markingData.classification.reasoning.trim();
      if (text) {
        return text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
    }

    // Fallback to message content
    if (message.content) {
      const text = message.content.trim();
      if (text) {
        return text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
    }

    return 'Question Image';
  }

  /**
   * Format date for display
   * @param {Object} timestamp - Firestore timestamp
   * @returns {string} Formatted date string
   */
  static formatDate(timestamp) {
    if (!timestamp) {
      throw new Error('Timestamp is null or undefined');
    }

    let date;

    // Handle different timestamp formats
    if (timestamp.toDate && typeof timestamp.toDate === 'function') {
      // Firestore timestamp object
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      // Firestore timestamp with seconds property
      date = new Date(timestamp.seconds * 1000);
    } else if (timestamp._seconds) {
      // Alternative Firestore timestamp format
      date = new Date(timestamp._seconds * 1000);
    } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
      // String or number timestamp
      date = new Date(timestamp);
    } else {
      // Log the actual structure for debugging
      console.error('Unknown timestamp format:', timestamp);
      throw new Error(`Unknown timestamp format: ${JSON.stringify(timestamp)}`);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp after conversion: ${JSON.stringify(timestamp)}`);
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

export default MarkingHistoryService;
