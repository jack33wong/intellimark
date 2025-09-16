/**
 * Custom hook for chat functionality
 * Handles message sending, receiving, and state management
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ensureStringContent } from '../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';
import { useAutoScroll } from './useAutoScroll';
import ApiClient from '../services/apiClient';
import { 
  appendFollowUpMessages, 
  replaceWithCompleteSession, 
  parseResponse,
  deduplicateMessages
} from '../utils/messageUtils';

export const useChat = () => {
  const { getAuthToken } = useAuth();
  
  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSessionData, setCurrentSessionData] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  // Auto-scroll functionality
  const { containerRef: chatContainerRef, scrollToBottom, handleImageLoad } = useAutoScroll(chatMessages);

  // Handle scroll button visibility
  const handleScrollChange = useCallback((isNearBottom) => {
    setShowScrollButton(!isNearBottom && chatMessages.length > 0);
  }, [chatMessages.length]);

  // Set up scroll event listener
  useEffect(() => {
    if (chatMessages.length > 0) {
      const container = chatContainerRef.current;
      if (container) {
        const isScrollable = container.scrollHeight > container.clientHeight;
        setShowScrollButton(isScrollable);
      }
    } else {
      setShowScrollButton(false);
    }

    // Add scroll event listener
    const container = chatContainerRef.current;
    if (container) {
      const scrollHandler = () => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom <= 10;
        handleScrollChange(isNearBottom);
      };
      
      container.addEventListener('scroll', scrollHandler);
      scrollHandler(); // Check initial state
      return () => container.removeEventListener('scroll', scrollHandler);
    }
  }, [handleScrollChange, chatContainerRef, chatMessages.length]);

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

    if (!message.trim() && !imageData) return;

    // Always add user message immediately for better UX
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
        // Parse response to determine type and handle accordingly
        const responseData = parseResponse(data);
        const isAuthenticated = !!authToken;
        
        switch (responseData.type) {
          case 'complete_session':
            // First time load or history click - replace all messages
            setChatMessages(replaceWithCompleteSession(responseData.messages, data.apiUsed));
            break;
            
          case 'follow_up':
            // Follow-up question - append new messages to existing
            if (isAuthenticated) {
              // For authenticated users, append all new messages
              setChatMessages(prev => appendFollowUpMessages(prev, responseData.messages));
            } else {
              // For anonymous users, filter out user message to avoid duplication
              const aiMessages = responseData.messages.filter(msg => msg.role === 'assistant');
              setChatMessages(prev => appendFollowUpMessages(prev, aiMessages));
            }
            break;
            
          case 'single_response':
            // Fallback to old format - append single AI response
            setChatMessages(prev => appendFollowUpMessages(prev, responseData.messages));
            break;
            
          default:
            console.warn('Unknown response type:', responseData.type);
            break;
        }
        
        // Notify sidebar to refresh when session is created or updated
        if (responseData.session?.id) {
          EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
            sessionId: responseData.session.id, 
            type: 'chat' 
          });
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
  }, [getAuthToken, scrollToBottom]);

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
    showScrollButton,
    
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
