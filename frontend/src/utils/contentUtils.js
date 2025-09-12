/**
 * Content Utilities
 * Handles safe content rendering for React components
 */

/**
 * Ensures content is always a string, handling various input types
 * @param {any} content - The content to convert to string
 * @returns {string} - Safe string content for rendering
 */
export const ensureStringContent = (content) => {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';
  if (typeof content === 'object' && content.content) {
    // Handle case where content is an object with a content property
    return String(content.content);
  }
  return String(content);
};

/**
 * Safely truncates content to specified length
 * @param {any} content - The content to truncate
 * @param {number} maxLength - Maximum length before truncation
 * @param {string} suffix - Suffix to add when truncated (default: '...')
 * @returns {string} - Truncated string content
 */
export const safeTruncate = (content, maxLength = 150, suffix = '...') => {
  const contentStr = ensureStringContent(content);
  return contentStr.length > maxLength 
    ? contentStr.substring(0, maxLength) + suffix 
    : contentStr;
};

/**
 * Safely extracts substring from content
 * @param {any} content - The content to extract from
 * @param {number} start - Start index
 * @param {number} end - End index
 * @returns {string} - Safe substring
 */
export const safeSubstring = (content, start = 0, end) => {
  const contentStr = ensureStringContent(content);
  return contentStr.substring(start, end);
};

/**
 * Checks if content is safe to render (not an object)
 * @param {any} content - The content to check
 * @returns {boolean} - True if safe to render
 */
export const isSafeToRender = (content) => {
  return typeof content === 'string' || 
         content === null || 
         content === undefined ||
         (typeof content === 'object' && content.content);
};
