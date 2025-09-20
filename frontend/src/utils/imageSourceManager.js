/**
 * Image Source Manager
 * 
 * Common function to handle all image sources with fail-fast logic
 * Priority: imageData (memory) > imageLink (storage) > fail fast
 * 
 * Design Principles:
 * - Fail fast if no image source found
 * - No fallback or graceful degradation
 * - Simple and maintainable
 */

/**
 * Get the best available image source from a message
 * @param {Object} message - UnifiedMessage object
 * @returns {string} - Image source URL or base64 data
 * @throws {Error} - If no image source found (fail fast)
 */
export const getImageSrc = (message) => {
  // FAIL FAST: message must be defined
  if (!message) {
    console.error('❌ FAIL FAST: message is undefined in getImageSrc!');
    throw new Error('message is required but was undefined');
  }

  // Priority 1: imageData (memory) - fastest, immediate display
  if (message.imageData) {
    return message.imageData;
  }

  // Priority 2: imageLink (storage) - for authenticated users
  if (message.imageLink) {
    return message.imageLink;
  }

  // FAIL FAST: No image source found
  console.error('❌ FAIL FAST: No image source found in message!');
  console.error('❌ Message structure:', JSON.stringify(message, null, 2));
  throw new Error('No image source found in message. Expected imageData or imageLink.');
};

/**
 * Check if a message has an image
 * @param {Object} message - UnifiedMessage object
 * @returns {boolean} - True if message has image
 */
export const hasImage = (message) => {
  if (!message) return false;
  return !!(message.imageData || message.imageLink);
};

/**
 * Get image source type for debugging
 * @param {Object} message - UnifiedMessage object
 * @returns {string} - 'memory', 'storage', or 'none'
 */
export const getImageSourceType = (message) => {
  if (!message) return 'none';
  if (message.imageData) return 'memory';
  if (message.imageLink) return 'storage';
  return 'none';
};

