// API Configuration
const API_CONFIG = {
  // Backend API base URL
  BASE_URL: process.env.NODE_ENV === 'production' ? 'https://api-f4ov4wv3qq-uc.a.run.app' : (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001'),
  
  // API endpoints
  ENDPOINTS: {
    CHAT: '/api/chat/',
    MARKING: '/api/marking',
    ADMIN: '/api/admin'
  },
  
  // Request timeout in milliseconds
  TIMEOUT: 30000,
  
  // Default headers
  DEFAULT_HEADERS: {
    'Content-Type': 'application/json',
  }
};


export default API_CONFIG;
