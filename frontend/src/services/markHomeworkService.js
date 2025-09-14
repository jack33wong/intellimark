/**
 * Service for mark homework API calls
 * Centralizes all API communication for homework marking functionality
 */

import API_CONFIG from '../config/api';

class MarkHomeworkService {
  /**
   * Analyze image through mark homework API
   * @param {string} imageData - Base64 encoded image data
   * @param {string} model - AI model to use
   * @param {string} authToken - Authentication token
   * @returns {Promise<Object>} Analysis result
   */
  static async analyzeImage(imageData, model = 'chatgpt-4o', authToken = null) {
    const payload = {
      imageData: imageData,
      model: model
    };

    const apiUrl = API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK;

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // Add authorization header if token is available
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Mark Homework API Error:', errorText);
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Send message to chat API
   * @param {Object} messageData - Message data
   * @param {string} authToken - Authentication token
   * @returns {Promise<Object>} Chat response
   */
  static async sendMessage(messageData, authToken = null) {
    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_CONFIG.BASE_URL}/api/chat/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(messageData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Chat API Error:', errorText);
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get session data from API
   * @param {string} sessionId - Session ID
   * @param {string} authToken - Authentication token
   * @returns {Promise<Object>} Session data
   */
  static async getSession(sessionId, authToken = null) {
    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`/api/chat/session/${sessionId}`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Get Session API Error:', errorText);
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}

export default MarkHomeworkService;
