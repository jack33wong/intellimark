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
 * - markhomeworkpageconsolidated.js:36 (main component - 20+ props)
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
    
    // Progress tracking
    loadingProgress: 0,
    loadingStep: 0,
    loadingTotalSteps: null, // Start with null, will be set by backend
    loadingMessage: 'Processing your homework...',
    showProgressDetails: false,
    
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
  const syncWithService = useCallback((serviceState) => {
    const { currentSession } = serviceState;
    const sessionMessages = currentSession?.messages || [];
    const sessionTitle = currentSession?.title || '';
    const isFavorite = currentSession?.favorite || false;
    const rating = currentSession?.rating || 0;

    setState(prev => ({
      ...prev,
      currentSession,
      chatMessages: sessionMessages,
      sessionTitle,
      isFavorite,
      rating,
      // If there's a current session, switch to chat mode
      pageMode: currentSession ? 'chat' : prev.pageMode
    }));
  }, []);

  useEffect(() => {
    // Subscribe to service state changes
    const unsubscribe = simpleSessionService.subscribe(syncWithService);

    return unsubscribe;
  }, [syncWithService]);

  // Actions - simplified
  const startProcessing = () => {
    setState(prev => ({ ...prev, isProcessing: true }));
    // Clear progress when starting new processing
    resetProgress();
  };

  const stopProcessing = () => {
    setState(prev => ({ 
      ...prev, 
      isProcessing: false,
      loadingProgress: 0,
      loadingStep: 0,
      loadingMessage: 'Processing your homework...'
    }));
  };

  const reset = () => {
    setState(prev => ({
      ...prev,
      isProcessing: false,
      isAIThinking: false,
      error: null,
      loadingProgress: 0,
      loadingStep: 0,
      loadingMessage: 'Processing your homework...'
    }));
  };

  // Progress tracking functions - simplified data structure
  const updateProgress = useCallback((data) => {
    setState(prev => ({
      ...prev,
      loadingMessage: data.currentStepDescription,
      progressData: data,
      stepList: data.allSteps,
      completedSteps: data.completedSteps,
      // Derive other values from the data
      loadingStep: data.completedSteps.length + (data.isComplete ? 0 : 1),
      loadingTotalSteps: data.allSteps.length,
      loadingProgress: data.isComplete ? 100 : Math.round((data.completedSteps.length / data.allSteps.length) * 100)
    }));
    
    // Update the processing message in the session with progress data
    const currentSession = simpleSessionService.getCurrentSession();
    if (currentSession && currentSession.messages) {
      const lastMessage = currentSession.messages[currentSession.messages.length - 1];
      if (lastMessage && lastMessage.isProcessing) {
        const updatedMessage = {
          ...lastMessage,
          progressData: data
          // Don't update content - it should remain empty until AI response comes back
        };
        
        // Update the message in the session
        const updatedMessages = [...currentSession.messages];
        updatedMessages[updatedMessages.length - 1] = updatedMessage;
        
        const updatedSession = {
          ...currentSession,
          messages: updatedMessages,
          updatedAt: new Date().toISOString()
        };
        
        simpleSessionService.updateSessionState(updatedSession);
      }
    }
  }, []);

  const resetProgress = useCallback(() => {
    setState(prev => ({
      ...prev,
      loadingProgress: 0,
      loadingStep: 0,
      loadingTotalSteps: null, // Reset to null
      loadingMessage: 'Processing your homework...'
    }));
  }, []);

  // Session management - simplified
  const addMessage = useCallback(async (message) => {
    await simpleSessionService.addMessage(message);
    // No manual state sync needed - service is single source of truth
  }, []);

  // AI thinking state control
  const startAIThinking = useCallback(() => {
    setState(prev => ({ ...prev, isAIThinking: true }));
    
    // Create a processing assistant message
    const processingMessage = {
      id: `processing-${Date.now()}`,
      role: 'assistant',
      content: '',
      isProcessing: true,
      progressData: {
        isComplete: false,
        currentStepDescription: 'Processing...',
        allSteps: [],
        completedSteps: [],
        currentStepId: null
      },
      timestamp: new Date().toISOString()
    };
    
    // Add the processing message to the session
    simpleSessionService.addMessage(processingMessage);
  }, []);

  const stopAIThinking = useCallback(() => {
    setState(prev => ({ ...prev, isAIThinking: false }));
  }, []);

  const setPageMode = useCallback((mode) => {
    setState(prev => ({ ...prev, pageMode: mode }));
  }, []);

  const handleError = useCallback((error) => {
    setState(prev => ({
      ...prev,
      isProcessing: false,
      error: error.message || 'Unknown error'
    }));
  }, []);

  // Session management - simplified
  const clearSession = useCallback(() => {
    simpleSessionService.clearSession();
  }, []);
  
    const processImageAPI = async (imageData, model, mode, customText = null) => {
      try {
        // Progress is already reset in startProcessing()
        
        // Check if SSE is enabled (can be disabled for debugging or if SSE has issues)
        const sseEnabled = localStorage.getItem('sseEnabled') !== 'false'; // Default to true
        
        if (sseEnabled) {
          // Use SSE method for progress tracking - fail fast if it fails
          const result = await simpleSessionService.processImageWithProgress(
            imageData, 
            model, 
            mode, 
            customText, 
            updateProgress
          );
          
          return result;
        } else {
          // Use regular endpoint directly (SSE disabled)
          const result = await simpleSessionService.processImage(
            imageData, 
            model, 
            mode, 
            customText
          );
          
          return result;
        }
      } catch (error) {
        // Reset progress on error
        resetProgress();
        throw error;
      }
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

  // Progress details toggle
  const setShowProgressDetails = useCallback((show) => {
    setState(prev => ({ ...prev, showProgressDetails: show }));
  }, []);

  // Send text message handler
  const onSendMessage = useCallback(async (text) => {
    if (!text || !text.trim()) return;
    
    try {
      // Start AI thinking state
      startAIThinking();
      
      // Add user message immediately to show in UI
      const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date().toISOString(),
        type: 'text'
      };
      
      // Clear the input after sending
      setChatInput('');
      
      // Add message immediately for instant UI feedback (both authenticated and unauthenticated)
      // This ensures immediate display while backend handles persistence in background
      await addMessage(userMessage);
      
      // Call the backend API to get AI response
      const authToken = await getAuthToken();
      const headers = {
        'Content-Type': 'application/json'
      };
      
      // Only add Authorization header if we have a valid token
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      // Debug logging removed for production
      
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: text.trim(),
          model: 'auto', // Use default model (now maps to gemini-2.0-flash-lite)
          sessionId: state.currentSession?.id || null
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Handle consistent response format from both APIs
        if (data.unifiedSession) {
          // Backend returned complete session data - convert it to proper format
          const convertedSession = simpleSessionService.convertToUnifiedSession(data.unifiedSession);
          
          // For follow-up messages, append new messages instead of replacing entire session
          if (state.currentSession && state.currentSession.id === convertedSession.id) {
            // This is a follow-up message - append only new messages
            const existingMessages = state.currentSession.messages || [];
            const newMessages = convertedSession.messages || [];
            
            // Find messages that are new (not in existing session)
            const newMessagesToAdd = newMessages.filter(newMsg => 
              !existingMessages.some(existingMsg => existingMsg.id === newMsg.id)
            );
            
            // Append new messages to existing session
            for (const message of newMessagesToAdd) {
              await addMessage(message);
            }
            
            // Update the session in the service to ensure persistence
            simpleSessionService.setCurrentSession(convertedSession);
          } else {
            // This is a new session - replace completely
            simpleSessionService.setCurrentSession(convertedSession);
          }
        } else if (data.newMessages) {
          // Backend returned only new messages (for anonymous users)
          // Append new messages to existing session instead of replacing
          if (state.currentSession) {
            // Filter out user message since it was already added locally
            const aiMessages = data.newMessages.filter(msg => msg.role === 'assistant');
            
            // Append only AI messages using addMessage to preserve existing messages
            for (const aiMessage of aiMessages) {
              await addMessage(aiMessage);
            }
          } else {
            // No existing session, create new one with the messages
            const sessionId = data.sessionId;
            const sessionTitle = data.sessionTitle || 'Chat Session';
            
            const anonymousSession = {
              id: sessionId,
              title: sessionTitle,
              messages: data.newMessages,
              userId: 'anonymous',
              messageType: 'Chat',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              favorite: false,
              rating: 0
            };
            
            simpleSessionService.setCurrentSession(anonymousSession);
          }
        }
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }
    } catch (error) {
      console.error('❌ Error sending text message:', error);
      handleError(error);
    } finally {
      // Stop AI thinking state
      stopAIThinking();
    }
  }, [getAuthToken, state.currentSession, addMessage, setChatInput, handleError, startAIThinking, stopAIThinking]);

  // Key press handler for Enter key
  const onKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      
      // For Enter key, we can only send text messages
      // Image + text combination should be handled by the send button click
      if (state.chatInput && state.chatInput.trim()) {
        onSendMessage(state.chatInput);
      }
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
    setShowProgressDetails,
    
    // Session management
    clearSession,
    addMessage,
    processImageAPI,
    loadSession
  };
};
