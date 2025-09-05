// API Configuration
const API_CONFIG = {
  // Backend API base URL
  BASE_URL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001',
  
  // API endpoints
  ENDPOINTS: {
    CHAT: '/api/chat/',
    MARK_HOMEWORK: '/api/mark-homework',
    ADMIN: '/api/admin'
  },
  
  // Request timeout in milliseconds
  TIMEOUT: 30000,
  
  // Default headers
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
  }
};

// Debug logging
console.log('🔧 API_CONFIG loaded:', {
  BASE_URL: API_CONFIG.BASE_URL,
  MARK_HOMEWORK_ENDPOINT: API_CONFIG.ENDPOINTS.MARK_HOMEWORK,
  FULL_URL: API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK
});

export default API_CONFIG;
