/**
 * Service for managing marking history
 */

const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

class MarkingHistoryService {
  /**
   * Get marking history for a specific user
   * @param {string} userId - The user ID
   * @param {number} limit - Maximum number of results to return
   * @param {string} authToken - Authentication token (optional)
   * @returns {Promise<Object>} The marking history data
   */
  static async getUserMarkingHistory(userId, limit = 50, authToken = null) {
    try {
      const url = `${API_BASE}/api/mark-homework/user/${userId}?limit=${limit}`;
      
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

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching marking history:', error);
      throw error;
    }
  }

  /**
   * Get a specific marking result by ID
   * @param {string} resultId - The result ID
   * @param {string} authToken - Authentication token (optional)
   * @returns {Promise<Object>} The marking result data
   */
  static async getMarkingResult(resultId, authToken = null) {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add authorization header if token is provided
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(`${API_BASE}/api/mark-homework/results/${resultId}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching marking result:', error);
      throw error;
    }
  }

  /**
   * Extract question text from marking result for display
   * @param {Object} result - The marking result object
   * @returns {string} The extracted question text
   */
  static extractQuestionText(result) {
    if (!result) {
      throw new Error('Result is null or undefined');
    }
    
    // Try to get OCR text first
    if (result.ocrResult && result.ocrResult.ocrText) {
      const text = result.ocrResult.ocrText.trim();
      if (text) {
        // Truncate long text for display
        return text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
    }
    
    // Fallback to classification reasoning
    if (result.classification && result.classification.reasoning) {
      const text = result.classification.reasoning.trim();
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
