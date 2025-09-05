/**
 * Service for managing marking history from sessions
 */

import API_CONFIG from '../config/api';

const API_BASE = API_CONFIG.BASE_URL;

class MarkingHistoryService {
  /**
   * Get marking history from sessions for a specific user
   * @param {string} userId - The user ID
   * @param {number} limit - Maximum number of sessions to return
   * @param {string} authToken - Authentication token (optional)
   * @returns {Promise<Object>} The marking history data from sessions
   */
  static async getMarkingHistoryFromSessions(userId, limit = 50, authToken = null) {
    try {
      const url = `${API_BASE}/api/chat/sessions/${userId}`;
      console.log('🔍 MarkingHistoryService: Fetching sessions from URL:', url);
      
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
      
      console.log('🔍 MarkingHistoryService: Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('🔍 MarkingHistoryService: Raw response:', result);
      
      // Check if the response has sessions array
      const sessions = result.sessions || result;
      console.log('🔍 MarkingHistoryService: Sessions array:', sessions);
      
      // Debug: Log message types in each session
      sessions.forEach((session, index) => {
        console.log(`🔍 MarkingHistoryService: Session ${index} messages:`, session.messages);
        if (session.messages) {
          session.messages.forEach((msg, msgIndex) => {
            console.log(`🔍 MarkingHistoryService: Message ${msgIndex}:`, {
              type: msg.type,
              role: msg.role,
              content: msg.content ? msg.content.substring(0, 100) + '...' : 'no content'
            });
          });
        }
      });
      
      // Filter sessions that contain marking messages
      const markingSessions = sessions.filter(session => 
        session.messages && session.messages.some(msg => 
          msg.type === 'marking_original' || msg.type === 'marking_annotated' || msg.type === 'question_original'
        )
      );
      
      console.log('🔍 MarkingHistoryService: Filtered marking sessions:', markingSessions);

      return {
        success: true,
        userId: userId,
        sessions: markingSessions,
        total: markingSessions.length,
        limit: limit
      };
    } catch (error) {
      console.error('Error fetching marking history from sessions:', error);
      throw error;
    }
  }

  /**
   * Get marking messages from a specific session
   * @param {string} sessionId - The session ID
   * @param {string} authToken - Authentication token (optional)
   * @returns {Promise<Object>} The marking messages from the session
   */
  static async getMarkingMessagesFromSession(sessionId, authToken = null) {
    try {
      const url = `${API_BASE}/api/chat/sessions/${sessionId}`;
      
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

      const session = await response.json();
      
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
   * Legacy method for backward compatibility - now uses sessions
   * @deprecated Use getMarkingHistoryFromSessions instead
   */
  static async getUserMarkingHistory(userId, limit = 50, authToken = null) {
    console.warn('getUserMarkingHistory is deprecated. Use getMarkingHistoryFromSessions instead.');
    return this.getMarkingHistoryFromSessions(userId, limit, authToken);
  }

  /**
   * Delete a chat session
   * @param {string} sessionId - The session ID to delete
   * @param {string} authToken - Authentication token (required)
   * @returns {Promise<Object>} The deletion result
   */
  static async deleteSession(sessionId, authToken) {
    try {
      const url = `${API_BASE}/api/chat/session/${sessionId}`;
      console.log('🔍 MarkingHistoryService: Deleting session:', sessionId);
      
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
      
      console.log('🔍 MarkingHistoryService: Delete response status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error || 'Unknown error'}`);
      }

      const result = await response.json();
      console.log('🔍 MarkingHistoryService: Delete result:', result);

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
   * Legacy method for backward compatibility - now uses sessions
   * @deprecated Use getMarkingMessagesFromSession instead
   */
  static async getMarkingResult(resultId, authToken = null) {
    console.warn('getMarkingResult is deprecated. Use getMarkingMessagesFromSession instead.');
    // For backward compatibility, treat resultId as sessionId
    return this.getMarkingMessagesFromSession(resultId, authToken);
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
