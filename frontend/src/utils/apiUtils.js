/**
 * API Utility Functions
 * Extracted from services for reusability and maintainability
 */

import ApiClient from '../services/apiClient';

// API endpoints
export const API_ENDPOINTS = {
  PROCESS_IMAGE: '/api/process',
  PROCESS_AI: '/api/process/ai',
  MESSAGES_CHAT: '/api/messages/chat',
  MESSAGES_SESSION: '/api/messages/session',
  MESSIONS_SESSIONS: '/api/messages/sessions'
};

// Response types
export const RESPONSE_TYPES = {
  ORIGINAL_IMAGE: 'original_image',
  AI_RESPONSE: 'ai_response',
  COMPLETE: 'complete',
  ERROR: 'error'
};

/**
 * Process image through unified API
 * @param {string} imageData - Base64 image data
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} - API response
 */
export const processImageApi = async (imageData, options = {}) => {
  const { model, sessionId, isFollowUp } = options;
  
  const response = await ApiClient.post(API_ENDPOINTS.PROCESS_IMAGE, {
    imageData,
    model,
    sessionId,
    isFollowUp
  });

  return response;
};

/**
 * Process AI response through API
 * @param {string} imageData - Base64 image data
 * @param {string} sessionId - Session ID
 * @param {string} model - AI model
 * @returns {Promise<Object>} - API response
 */
export const processAiResponseApi = async (imageData, sessionId, model) => {
  const response = await ApiClient.post(API_ENDPOINTS.PROCESS_AI, {
    imageData,
    sessionId,
    model
  });

  return response;
};

/**
 * Send chat message through API
 * @param {Object} messageData - Message data
 * @returns {Promise<Object>} - API response
 */
export const sendChatMessageApi = async (messageData) => {
  const response = await ApiClient.post(API_ENDPOINTS.MESSAGES_CHAT, messageData);
  return response;
};

/**
 * Get session by ID
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} - API response
 */
export const getSessionApi = async (sessionId) => {
  const response = await ApiClient.get(`${API_ENDPOINTS.MESSAGES_SESSION}/${sessionId}`);
  return response;
};

/**
 * Get user sessions
 * @param {string} userId - User ID
 * @returns {Promise<Object>} - API response
 */
export const getUserSessionsApi = async (userId) => {
  const response = await ApiClient.get(`${API_ENDPOINTS.MESSIONS_SESSIONS}/${userId}`);
  return response;
};

/**
 * Update session metadata
 * @param {string} sessionId - Session ID
 * @param {Object} updates - Updates to apply
 * @returns {Promise<Object>} - API response
 */
export const updateSessionApi = async (sessionId, updates) => {
  const response = await ApiClient.put(`${API_ENDPOINTS.MESSAGES_SESSION}/${sessionId}`, updates);
  return response;
};

/**
 * Delete session
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} - API response
 */
export const deleteSessionApi = async (sessionId) => {
  const response = await ApiClient.delete(`${API_ENDPOINTS.MESSAGES_SESSION}/${sessionId}`);
  return response;
};

/**
 * Check if API response is successful
 * @param {Object} response - API response
 * @returns {boolean} - True if successful
 */
export const isApiResponseSuccess = (response) => {
  return response && response.success === true;
};

/**
 * Extract error message from API response
 * @param {Object} response - API response
 * @returns {string} - Error message
 */
export const extractApiErrorMessage = (response) => {
  if (!response) {
    return 'No response from server';
  }
  
  if (response.error) {
    return response.error;
  }
  
  if (response.message) {
    return response.message;
  }
  
  return 'Unknown error occurred';
};

/**
 * Create standardized API error
 * @param {string} message - Error message
 * @param {Object} details - Additional error details
 * @returns {Error} - Standardized error
 */
export const createApiError = (message, details = {}) => {
  const error = new Error(message);
  error.details = details;
  error.isApiError = true;
  return error;
};
