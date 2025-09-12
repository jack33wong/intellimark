/**
 * Custom hook for chat functionality
 * Handles message sending, receiving, and state management
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ensureStringContent } from '../utils/contentUtils';

export const useChat = () => {
  const { getAuthToken } = useAuth();
  
  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Refs
  const chatContainerRef = useRef(null);
  
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

  // Auto-scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  // Auto-scroll when new messages are added
  useEffect(() => {
    if (chatMessages.length > 0) {
      scrollToBottom();
    }
  }, [chatMessages.length, scrollToBottom]);

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

    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: ensureStringContent(message),
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => deduplicateMessages([...prev, userMessage]));
    setIsProcessing(true);

    try {
      const authToken = await getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: message.trim(),
          imageData: imageData,
          model: model,
          sessionId: sessionId,
          mode: mode,
          favorite: false,
          rating: 0
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Session ID and title will be handled by useSession hook
        
        // Add AI response to chat
        const aiResponse = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'assistant',
          content: ensureStringContent(data.response),
          rawContent: ensureStringContent(data.response),
          timestamp: new Date().toISOString(),
          apiUsed: data.apiUsed,
          showRaw: false
        };
        
        setChatMessages(prev => deduplicateMessages([...prev, aiResponse]));
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
        id: msg.id || `msg-${index}`,
        role: msg.role || 'user',
        content: ensureStringContent(msg.content),
        rawContent: ensureStringContent(msg.rawContent || msg.content),
        timestamp: msg.timestamp || new Date().toISOString(),
        type: msg.type,
        imageData: msg.imageData,
        fileName: msg.fileName,
        detectedQuestion: msg.detectedQuestion,
        metadata: msg.metadata,
        showRaw: false
      }));
      
      setChatMessages(formattedMessages);
    }
  }, []);

  // Clear chat
  const clearChat = useCallback(() => {
    setChatMessages([]);
    setChatInput('');
  }, []);

  return {
    // State
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    isProcessing,
    
    // Actions
    sendMessage,
    loadMessages,
    clearChat,
    
    // Refs
    chatContainerRef,
    scrollToBottom
  };
};
