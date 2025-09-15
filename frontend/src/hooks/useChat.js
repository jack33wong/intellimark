/**
 * Custom hook for chat functionality
 * Handles message sending, receiving, and state management
 */

import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ensureStringContent } from '../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';
import { useAutoScroll } from './useAutoScroll';
import ApiClient from '../services/apiClient';

export const useChat = () => {
  const { getAuthToken } = useAuth();
  
  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSessionData, setCurrentSessionData] = useState(null);
  
  // Auto-scroll functionality
  const { containerRef: chatContainerRef, scrollToBottom, handleImageLoad } = useAutoScroll(chatMessages);
  
  // Helper function to deduplicate messages by ID
  const deduplicateMessages = useCallback((messages) => {
    const seen = new Set();
    return messages.filter(message => {
      if (seen.has(message.id)) {
        return false;
      }
      seen.add(message.id);
      return true;
    });
  }, []);

  // Send message to chat API
  const sendMessage = useCallback(async (message, options = {}) => {
    const {
      imageData = null,
      model = 'chatgpt-4o',
      sessionId = null,
      mode = undefined,
      onSuccess = () => {},
      onError = () => {}
    } = options;

    if (!message.trim()) return;

    // Add user message immediately for better UX (optimistic update)
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: ensureStringContent(message),
      timestamp: new Date().toISOString(),
      imageData: imageData // Include image data if present
    };

    setChatMessages(prev => deduplicateMessages([...prev, userMessage]));
    setIsProcessing(true);

    try {
      const authToken = await getAuthToken();
      
      const data = await ApiClient.post('/api/messages/chat', {
        message: message.trim(),
        imageData: imageData,
        model: model,
        sessionId: sessionId,
        mode: mode,
        favorite: false,
        rating: 0
      }, authToken);

      if (data.success) {
        // Session ID and title will be handled by useSession hook
        
        // Handle unified session response
        const sessionMessages = data.session?.unifiedMessages || data.session?.messages || [];
        if (data.session && sessionMessages.length > 0) {
          // Convert unified messages to chat format
          const formattedMessages = sessionMessages.map(msg => ({
            id: msg.messageId || msg.id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            role: msg.role,
            content: ensureStringContent(msg.content),
            timestamp: msg.timestamp,
            type: msg.type,
            detectedQuestion: msg.detectedQuestion,
            metadata: msg.metadata,
            apiUsed: msg.metadata?.apiUsed || data.apiUsed,
            imageLink: msg.imageLink // Include image link for display
          }));
          
          // Replace all messages with the complete session data from backend
          // The backend returns the full session with all messages (old + new)
          setChatMessages(deduplicateMessages(formattedMessages));
          
          // Notify sidebar to refresh when session is created or updated
          if (data.session?.id) {
            EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
              sessionId: data.session.id, 
              type: 'chat' 
            });
          }
        } else {
          // Fallback to old response format
          const aiResponse = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            role: 'assistant',
            content: ensureStringContent(data.response),
            timestamp: new Date().toISOString(),
            apiUsed: data.apiUsed
          };
          
          setChatMessages(prev => deduplicateMessages([...prev, aiResponse]));
        }
        
        scrollToBottom();
        onSuccess(data);
      } else {
        throw new Error(data.error || 'Failed to send message');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      onError(error);
    } finally {
      setIsProcessing(false);
    }
  }, [getAuthToken, deduplicateMessages, scrollToBottom]);

  // Load messages from session data
  const loadMessages = useCallback((sessionData) => {
    if (sessionData && sessionData.messages) {
      const formattedMessages = sessionData.messages.map((msg, index) => ({
        id: msg.id || msg.messageId || `msg-${index}`, // Handle both id and messageId
        messageId: msg.messageId, // Preserve backend messageId
        role: msg.role || 'user',
        content: ensureStringContent(msg.content),
        timestamp: msg.timestamp || new Date().toISOString(),
        type: msg.type,
        imageData: msg.imageData, // Legacy support
        imageLink: msg.imageLink, // NEW: Firebase Storage URL
        fileName: msg.fileName,
        detectedQuestion: msg.detectedQuestion,
        metadata: msg.metadata,
        apiUsed: msg.apiUsed || msg.metadata?.apiUsed
      }));
      
      setChatMessages(formattedMessages);
      setCurrentSessionData(sessionData); // Store the full session data
    }
  }, []); // No dependencies needed - function only uses its parameters

  // Clear chat
  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatInput('');
    setCurrentSessionData(null);
  }, []);

  return {
    // State
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    isProcessing,
    currentSessionData,
    
    // Actions
    sendMessage,
    loadMessages,
    clearChat,
    
    // Refs and scroll functions
    chatContainerRef,
    scrollToBottom,
    handleImageLoad
  };
};
