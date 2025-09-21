/**
 * useMarkHomework Hook
 * 
 * PURPOSE: Single source of truth for mark homework UI state and actions
 * REPLACES: Multiple hooks (useProcessing, useSession, useError, usePageMode)
 * 
 * WHY NOT SIMPLER:
 * - Manages complex state transitions (upload → chat → error → reset)
 * - Handles session persistence across page refreshes
 * - Provides consistent API for multiple components
 * - Coordinates with simpleSessionService for data persistence
 * 
 * USAGE PATTERNS:
 * - MarkHomeworkPageConsolidated.js:36 (main component - 20+ props)
 * - MainLayout.js:17 (layout component - 15+ props)
 * - Sidebar.js:45 (session management)
 * 
 * STATE MANAGEMENT:
 * - UI State: Local useState for component-specific state
 * - Session Data: Retrieved from simpleSessionService (single source of truth)
 * - Actions: Delegated to simpleSessionService for persistence
 * 
 * @returns {Object} Hook interface with state and actions
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';

export const useMarkHomework = () => {
  const { getAuthToken } = useAuth();
  
  // Consolidated state management - single source of truth
  const [state, setState] = useState({
    // UI state
    isProcessing: false,
    isAIThinking: false,
    pageMode: 'upload', // 'upload' | 'chat'
    error: null,
    
    // Chat input state
    chatInput: '',
    
    // Session data (will be synced with service)
    currentSession: null,
    chatMessages: [],
    sessionTitle: '',
    isFavorite: false,
    rating: 0
  });

  // Initialize session service
  useEffect(() => {
    simpleSessionService.setAuthContext({ getAuthToken });
  }, [getAuthToken]);

  // Sync with service state when it changes
  useEffect(() => {
    const syncWithService = (serviceState) => {
      const { currentSession } = serviceState;
      const chatMessages = currentSession?.messages || [];
      const sessionTitle = currentSession?.title || '';
      const isFavorite = currentSession?.favorite || false;
      const rating = currentSession?.rating || 0;

      setState(prev => ({
        ...prev,
        currentSession,
        chatMessages,
        sessionTitle,
        isFavorite,
        rating,
        // If there's a current session, switch to chat mode
        pageMode: currentSession ? 'chat' : prev.pageMode
      }));
    };

    // Subscribe to service state changes
    const unsubscribe = simpleSessionService.subscribe(syncWithService);

    return unsubscribe;
  }, [state.pageMode]);

  // Actions - simplified
  const startProcessing = () => {
    setState(prev => ({ ...prev, isProcessing: true }));
  };

  const stopProcessing = () => {
    setState(prev => ({ ...prev, isProcessing: false }));
  };

  const reset = () => {
    setState(prev => ({
      ...prev,
      isProcessing: false,
      isAIThinking: false,
      error: null
    }));
  };

  // AI thinking state control
  const startAIThinking = () => {
    setState(prev => ({ ...prev, isAIThinking: true }));
  };

  const stopAIThinking = () => {
    setState(prev => ({ ...prev, isAIThinking: false }));
  };

  const setPageMode = (mode) => {
    setState(prev => ({ ...prev, pageMode: mode }));
  };

  const handleError = (error) => {
    setState(prev => ({
      ...prev,
      isProcessing: false,
      error: error.message || 'Unknown error'
    }));
  };

  // Session management - simplified
  const clearSession = () => {
    simpleSessionService.clearSession();
  };
  
  const addMessage = async (message) => {
    await simpleSessionService.addMessage(message);
    // No manual state sync needed - service is single source of truth
  };
  
  const processImageAPI = async (imageData, model, mode) => {
    const result = await simpleSessionService.processImage(imageData, model, mode);
    // No manual state sync needed - service is single source of truth
    return result;
  };

  const loadSession = useCallback((session) => {
    // Set the session in the service
    simpleSessionService.setCurrentSession(session);
    // Switch to chat mode when loading a session
    setPageMode('chat');
  }, [setPageMode]);

  // Chat input management
  const setChatInput = useCallback((value) => {
    setState(prev => ({ ...prev, chatInput: value }));
  }, []);

  // Send text message handler
  const onSendMessage = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    
    try {
      const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date().toISOString(),
        type: 'text'
      };
      
      await addMessage(userMessage);
      
      // Clear the input after sending
      setChatInput('');
    } catch (error) {
      console.error('❌ Error sending text message:', error);
      handleError(error);
    }
  }, [addMessage, setChatInput, handleError]);

  // Key press handler for Enter key
  const onKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSendMessage(state.chatInput);
    }
  }, [onSendMessage, state.chatInput]);

  return {
    // Consolidated state - single source of truth
    ...state,
    
    // Computed properties - simplified
    isIdle: !state.isProcessing && !state.isAIThinking,
    isError: !!state.error,
    
    // Actions - simplified
    startProcessing,
    stopProcessing,
    reset,
    setPageMode,
    handleError,
    startAIThinking,
    stopAIThinking,
    
    // Chat input management
    setChatInput,
    onSendMessage,
    onKeyPress,
    
    // Session management
    clearSession,
    addMessage,
    processImageAPI,
    loadSession
  };
};
