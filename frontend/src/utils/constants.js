/**
 * Application constants
 */

// API Configuration
export const API_ENDPOINTS = {
  CHAT: '/api/chat/',
  MARKING: '/api/marking/',
  ADMIN: '/api/admin/',
  SUBSCRIPTION: '/api/subscription/',
  SESSION: (id) => `/api/chat/session/${id}`,
};

// Subscription Plans
export const SUBSCRIPTION_PLANS = {
  FREE: 'free',
  PRO: 'pro',
  ULTRA: 'ultra',
};

// Subscription Delays (in milliseconds)
export const SUBSCRIPTION_DELAYS = {
  FREE: 3000,
  PRO: 1000,
  ULTRA: 0,
};

// Page Modes
export const PAGE_MODES = {
  UPLOAD: 'upload',
  CHAT: 'chat',
};

// Message Types
export const MESSAGE_TYPES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  QUESTION_ORIGINAL: 'question_original',
  QUESTION_RESPONSE: 'question_response',
  MARKING_ANNOTATED: 'marking_annotated',
  MARKING_RESPONSE: 'marking_response',
};

// AI Models
export const AI_MODELS = {
  GEMINI_2_0_FLASH: 'gemini-2.0-flash',
  GEMINI_2_5_FLASH: 'gemini-2.5-flash',
  GEMINI_2_5_PRO: 'gemini-2.5-pro',
  GEMINI_3_FLASH_PREVIEW: 'gemini-3-flash-preview',
  OPENAI_GPT_4O: 'openai-gpt-4o',
};

// File Types
export const SUPPORTED_FILE_TYPES = {
  IMAGE: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
};

// UI Constants
export const UI_CONSTANTS = {
  DEBOUNCE_DELAY: 300,
  ANIMATION_DURATION: 200,
  TOAST_DURATION: 5000,
  SCROLL_TOLERANCE: 10,
};

// Local Storage Keys
export const STORAGE_KEYS = {
  THEME: 'aimarking-theme',
  LAST_SESSION: 'aimarking-last-session',
  USER_PREFERENCES: 'aimarking-user-preferences',
  SELECTED_MODEL: 'aimarking-selected-model',
};

// Error Messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your connection.',
  UPLOAD_ERROR: 'Failed to upload file. Please try again.',
  PROCESSING_ERROR: 'Failed to process image. Please try again.',
  AUTH_ERROR: 'Authentication failed. Please log in again.',
  GENERIC_ERROR: 'Something went wrong. Please try again.',
};

// Success Messages
export const SUCCESS_MESSAGES = {
  UPLOAD_SUCCESS: 'File uploaded successfully',
  PROCESSING_SUCCESS: 'Image processed successfully',
  SAVE_SUCCESS: 'Changes saved successfully',
  DELETE_SUCCESS: 'Item deleted successfully',
};
