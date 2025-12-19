import axios from 'axios';
import API_CONFIG from '../config/api';
import { auth } from '../config/firebase';

/**
 * Global API Client (Axios)
 * 
 * Features:
 * 1. Automatic Just-in-Time Token Injection (Request Interceptor)
 * 2. Automatic Token Refresh & Retry (Response Interceptor)
 * 3. Base URL configuration from centralized api config
 */
const apiClient = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT || 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Request Interceptor:
 * Ensures every request has a fresh Firebase ID Token (JIT).
 */
apiClient.interceptors.request.use(async (config) => {
  const user = auth.currentUser;

  if (user) {
    try {
      // getIdToken(false) returns cached token if valid, or refreshes automatically.
      const token = await user.getIdToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('❌ [API_CLIENT] Failed to get fresh token:', error);
    }
  }

  return config;
}, (error) => {
  return Promise.reject(error);
});

/**
 * Response Interceptor:
 * Handles 401 Unauthorized by attempting a token refresh and retrying the request once.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 error and not already retrying
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const user = auth.currentUser;

      if (user) {
        console.warn('⚠️ [API_CLIENT] Token expired. Attempting refresh and retry...');
        try {
          // Force a token refresh from Firebase
          const newToken = await user.getIdToken(true);

          // Update the original request with the new token and retry
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        } catch (refreshError) {
          console.error('❌ [API_CLIENT] Token refresh failed:', refreshError);
          // Optional: redirect to login if refresh fails completely
          // window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
