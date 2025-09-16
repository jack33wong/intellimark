/**
 * Error Utility Functions
 * Extracted for consistent error handling across components
 */

// Error types
export const ERROR_TYPES = {
  VALIDATION: 'validation',
  NETWORK: 'network',
  API: 'api',
  PROCESSING: 'processing',
  FILE: 'file',
  UNKNOWN: 'unknown'
};

// Error severity levels
export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

/**
 * Create standardized error object
 * @param {string} message - Error message
 * @param {string} type - Error type
 * @param {string} severity - Error severity
 * @param {Object} details - Additional error details
 * @returns {Object} - Standardized error object
 */
export const createError = (message, type = ERROR_TYPES.UNKNOWN, severity = ERROR_SEVERITY.MEDIUM, details = {}) => {
  return {
    message,
    type,
    severity,
    details,
    timestamp: new Date().toISOString(),
    id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  };
};

/**
 * Create validation error
 * @param {string} message - Error message
 * @param {Object} details - Additional details
 * @returns {Object} - Validation error object
 */
export const createValidationError = (message, details = {}) => {
  return createError(message, ERROR_TYPES.VALIDATION, ERROR_SEVERITY.MEDIUM, details);
};

/**
 * Create network error
 * @param {string} message - Error message
 * @param {Object} details - Additional details
 * @returns {Object} - Network error object
 */
export const createNetworkError = (message, details = {}) => {
  return createError(message, ERROR_TYPES.NETWORK, ERROR_SEVERITY.HIGH, details);
};

/**
 * Create API error
 * @param {string} message - Error message
 * @param {Object} details - Additional details
 * @returns {Object} - API error object
 */
export const createApiError = (message, details = {}) => {
  return createError(message, ERROR_TYPES.API, ERROR_SEVERITY.HIGH, details);
};

/**
 * Create processing error
 * @param {string} message - Error message
 * @param {Object} details - Additional details
 * @returns {Object} - Processing error object
 */
export const createProcessingError = (message, details = {}) => {
  return createError(message, ERROR_TYPES.PROCESSING, ERROR_SEVERITY.HIGH, details);
};

/**
 * Create file error
 * @param {string} message - Error message
 * @param {Object} details - Additional details
 * @returns {Object} - File error object
 */
export const createFileError = (message, details = {}) => {
  return createError(message, ERROR_TYPES.FILE, ERROR_SEVERITY.MEDIUM, details);
};

/**
 * Get user-friendly error message
 * @param {Object} error - Error object
 * @returns {string} - User-friendly message
 */
export const getUserFriendlyErrorMessage = (error) => {
  if (!error) {
    return 'An unknown error occurred';
  }

  // If it's already a user-friendly message, return it
  if (typeof error === 'string') {
    return error;
  }

  // If it's an error object with message, return it
  if (error.message) {
    return error.message;
  }

  // If it's an error object with details, try to extract message
  if (error.details && error.details.message) {
    return error.details.message;
  }

  // Fallback to generic message
  return 'An error occurred while processing your request';
};

/**
 * Get error icon based on type
 * @param {string} type - Error type
 * @returns {string} - Icon name or emoji
 */
export const getErrorIcon = (type) => {
  const iconMap = {
    [ERROR_TYPES.VALIDATION]: '⚠️',
    [ERROR_TYPES.NETWORK]: '🌐',
    [ERROR_TYPES.API]: '🔌',
    [ERROR_TYPES.PROCESSING]: '⚙️',
    [ERROR_TYPES.FILE]: '📁',
    [ERROR_TYPES.UNKNOWN]: '❌'
  };

  return iconMap[type] || '❌';
};

/**
 * Get error color based on severity
 * @param {string} severity - Error severity
 * @returns {string} - CSS color class or value
 */
export const getErrorColor = (severity) => {
  const colorMap = {
    [ERROR_SEVERITY.LOW]: '#f59e0b',      // yellow
    [ERROR_SEVERITY.MEDIUM]: '#f97316',   // orange
    [ERROR_SEVERITY.HIGH]: '#ef4444',     // red
    [ERROR_SEVERITY.CRITICAL]: '#dc2626'  // dark red
  };

  return colorMap[severity] || '#ef4444';
};

/**
 * Check if error is retryable
 * @param {Object} error - Error object
 * @returns {boolean} - True if error can be retried
 */
export const isRetryableError = (error) => {
  if (!error || !error.type) {
    return false;
  }

  // Network and API errors are usually retryable
  return error.type === ERROR_TYPES.NETWORK || error.type === ERROR_TYPES.API;
};

/**
 * Get retry delay based on error type
 * @param {Object} error - Error object
 * @param {number} attempt - Current attempt number
 * @returns {number} - Delay in milliseconds
 */
export const getRetryDelay = (error, attempt = 1) => {
  if (!isRetryableError(error)) {
    return 0;
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
  const baseDelay = 1000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
  
  return delay;
};

/**
 * Log error for debugging
 * @param {Object} error - Error object
 * @param {string} context - Context where error occurred
 */
export const logError = (error, context = 'Unknown') => {
  const errorInfo = {
    context,
    error: error.message || error,
    type: error.type || ERROR_TYPES.UNKNOWN,
    severity: error.severity || ERROR_SEVERITY.MEDIUM,
    timestamp: new Date().toISOString(),
    details: error.details || {}
  };

  console.error(`[${context}] Error:`, errorInfo);
};
