/**
 * Input Validation Utilities
 * Implements fail-fast design principles with early validation
 */

// File validation constants
export const FILE_CONSTRAINTS = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
  MIN_SIZE: 1024 // 1KB minimum
};

// Model validation constants
export const VALID_MODELS = ['chatgpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro'];

/**
 * Validate file input with fail-fast approach
 * @param {File} file - File to validate
 * @throws {Error} - Throws immediately on validation failure
 */
export const validateFile = (file) => {
  // Fail fast on null/undefined
  if (!file) {
    throw new Error('No file provided');
  }

  // Fail fast on invalid file type
  if (!FILE_CONSTRAINTS.ALLOWED_TYPES.includes(file.type)) {
    throw new Error(`Invalid file type. Allowed: ${FILE_CONSTRAINTS.ALLOWED_TYPES.join(', ')}`);
  }

  // Fail fast on file size
  if (file.size > FILE_CONSTRAINTS.MAX_SIZE) {
    throw new Error(`File too large. Maximum size: ${FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024)}MB`);
  }

  if (file.size < FILE_CONSTRAINTS.MIN_SIZE) {
    throw new Error(`File too small. Minimum size: ${FILE_CONSTRAINTS.MIN_SIZE / 1024}KB`);
  }

  // Fail fast on invalid file name
  if (!file.name || file.name.trim().length === 0) {
    throw new Error('Invalid file name');
  }

  return true;
};

/**
 * Validate model selection
 * @param {string} model - Model to validate
 * @throws {Error} - Throws immediately on validation failure
 */
export const validateModel = (model) => {
  if (!model) {
    throw new Error('No model selected');
  }

  if (!VALID_MODELS.includes(model)) {
    throw new Error(`Invalid model. Allowed: ${VALID_MODELS.join(', ')}`);
  }

  return true;
};

/**
 * Validate API response structure
 * @param {Object} response - API response to validate
 * @param {string} expectedType - Expected response type
 * @throws {Error} - Throws immediately on validation failure
 */
export const validateApiResponse = (response, expectedType = null) => {
  // Fail fast on null/undefined response
  if (!response) {
    throw new Error('No response from server');
  }

  // Fail fast on missing success field
  if (typeof response.success !== 'boolean') {
    throw new Error('Invalid response format: missing success field');
  }

  // Fail fast on error response without error message
  if (!response.success && !response.error) {
    throw new Error('Error response without error message');
  }

  // Fail fast on missing data field for successful responses
  if (response.success && !response.data) {
    throw new Error('Success response without data field');
  }

  // Validate expected response type
  if (expectedType && response.data && response.data.responseType !== expectedType) {
    throw new Error(`Unexpected response type: ${response.data.responseType}, expected: ${expectedType}`);
  }

  return response;
};

/**
 * Validate message structure
 * @param {Object} message - Message to validate
 * @throws {Error} - Throws immediately on validation failure
 */
export const validateMessage = (message) => {
  if (!message) {
    throw new Error('No message provided');
  }

  if (!message.id) {
    throw new Error('Message missing required id field');
  }

  if (!message.role || !['user', 'assistant', 'system'].includes(message.role)) {
    throw new Error('Message missing or invalid role field');
  }

  if (typeof message.content !== 'string') {
    throw new Error('Message content must be a string');
  }

  if (!message.timestamp) {
    throw new Error('Message missing required timestamp field');
  }

  return true;
};

/**
 * Validate session ID
 * @param {string} sessionId - Session ID to validate
 * @throws {Error} - Throws immediately on validation failure
 */
export const validateSessionId = (sessionId) => {
  if (!sessionId) {
    throw new Error('No session ID provided');
  }

  if (typeof sessionId !== 'string') {
    throw new Error('Session ID must be a string');
  }

  if (sessionId.trim().length === 0) {
    throw new Error('Session ID cannot be empty');
  }

  return true;
};

/**
 * Validate processing options
 * @param {Object} options - Processing options to validate
 * @throws {Error} - Throws immediately on validation failure
 */
export const validateProcessingOptions = (options) => {
  if (!options || typeof options !== 'object') {
    throw new Error('Processing options must be an object');
  }

  // Validate model if provided
  if (options.model) {
    validateModel(options.model);
  }

  // Validate sessionId if provided
  if (options.sessionId) {
    validateSessionId(options.sessionId);
  }

  // Validate isFollowUp if provided
  if (options.isFollowUp !== undefined && typeof options.isFollowUp !== 'boolean') {
    throw new Error('isFollowUp must be a boolean');
  }

  return true;
};
