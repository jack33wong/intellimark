/**
 * Frontend Type Definitions
 * Matches backend types for type safety
 */

// Chat Context Types
export const ChatItem = {
  role: 'user' | 'assistant',
  content: 'string',
  timestamp: 'Date',
  imageData: 'string?',
  imageName: 'string?',
  apiUsed: 'string?'
};

export const ChatSession = {
  id: 'string',
  title: 'string',
  messages: 'ChatItem[]',
  timestamp: 'Date',
  userId: 'string?'
};

export const CreateChatSessionData = {
  title: 'string',
  messages: 'ChatItem[]',
  userId: 'string?'
};

// AI Model Types
export const ModelType = {
  'gemini-2.5-pro': 'string',
  'chatgpt-5': 'string',
  'chatgpt-4o': 'string'
};

// Chat Message Types
export const ChatMessage = {
  id: 'string',
  role: 'user' | 'assistant',
  content: 'string',
  timestamp: 'Date',
  model: 'ModelType?',
  imageData: 'string?'
};

// API Response Types
export const ChatResponse = {
  success: 'boolean',
  sessionId: 'string?',
  message: 'string?',
  context: 'object?',
  error: 'string?'
};

export const SessionResponse = {
  success: 'boolean',
  sessions: 'ChatSession[]?',
  session: 'ChatSession?',
  error: 'string?'
};
