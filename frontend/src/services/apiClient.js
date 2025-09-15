/**
 * Centralized API Client
 * 
 * Provides a clean interface for all API calls with consistent error handling,
 * authentication, and response formatting.
 */

import API_CONFIG from '../config/api';

class ApiClient {
  /**
   * Make a GET request
   * @param {string} endpoint - API endpoint
   * @param {string} authToken - Authentication token
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response data
   */
  static async get(endpoint, authToken = null, options = {}) {
    const url = `${API_CONFIG.BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        ...options
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error(`API GET Error (${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Make a POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @param {string} authToken - Authentication token
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response data
   */
  static async post(endpoint, data = null, authToken = null, options = {}) {
    const url = `${API_CONFIG.BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: data ? JSON.stringify(data) : null,
        ...options
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return responseData;
    } catch (error) {
      console.error(`API POST Error (${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Make a PUT request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @param {string} authToken - Authentication token
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response data
   */
  static async put(endpoint, data = null, authToken = null, options = {}) {
    const url = `${API_CONFIG.BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'PUT',
        headers,
        body: data ? JSON.stringify(data) : null,
        ...options
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return responseData;
    } catch (error) {
      console.error(`API PUT Error (${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Make a DELETE request
   * @param {string} endpoint - API endpoint
   * @param {string} authToken - Authentication token
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Response data
   */
  static async delete(endpoint, authToken = null, options = {}) {
    const url = `${API_CONFIG.BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers,
        ...options
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error(`API DELETE Error (${endpoint}):`, error);
      throw error;
    }
  }

  /**
   * Upload file with progress tracking
   * @param {string} endpoint - API endpoint
   * @param {FormData} formData - Form data with file
   * @param {string} authToken - Authentication token
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Object>} Response data
   */
  static async uploadFile(endpoint, formData, authToken = null, onProgress = null) {
    const url = `${API_CONFIG.BASE_URL}${endpoint}`;
    const headers = {};

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error(`API Upload Error (${endpoint}):`, error);
      throw error;
    }
  }
}

export default ApiClient;
