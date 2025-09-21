/**
 * Consolidated Mark Homework Hook
 * 
 * Single source of truth for all mark homework functionality
 * Replaces multiple hooks with one clean interface
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';


export const useMarkHomework = () => {
  const { getAuthToken } = useAuth();
  
  // UI state only - session data comes from service
  const [uiState, setUiState] = useState({
    // Processing state - simplified
    isProcessing: false,
    isAIThinking: false,
    
    // UI state
    pageMode: 'upload', // 'upload' | 'chat'
    
    // Error state
    error: null
  });

  // Initialize session service
  useEffect(() => {
    simpleSessionService.setAuthContext({ getAuthToken });
  }, [getAuthToken]);

  // Simple local state for session data - no subscription to prevent infinite re-renders
  const [sessionData, setSessionData] = useState({
    currentSession: null,
    chatMessages: [],
    sessionTitle: '',
    isFavorite: false,
    rating: 0
  });

  // Actions - simplified
  const startProcessing = () => {
    setUiState(prev => ({ ...prev, isProcessing: true }));
  };

  const stopProcessing = () => {
    setUiState(prev => ({ ...prev, isProcessing: false }));
  };

  const reset = () => {
    setUiState(prev => ({
      ...prev,
      isProcessing: false,
      isAIThinking: false,
      error: null
    }));
  };

  // AI thinking state control
  const startAIThinking = () => {
    setUiState(prev => ({ ...prev, isAIThinking: true }));
  };

  const stopAIThinking = () => {
    setUiState(prev => ({ ...prev, isAIThinking: false }));
  };

  const setPageMode = (mode) => {
    setUiState(prev => ({ ...prev, pageMode: mode }));
  };

  const handleError = (error) => {
    setUiState(prev => ({
      ...prev,
      isProcessing: false,
      error: error.message || 'Unknown error'
    }));
  };

  // Session management - simplified
  const clearSession = () => {
    simpleSessionService.clearSession();
    setSessionData({
      currentSession: null,
      chatMessages: [],
      sessionTitle: '',
      isFavorite: false,
      rating: 0
    });
  };
  
  const addMessage = async (message) => {
    await simpleSessionService.addMessage(message);
    
    // Update local state after service has completed
    const { currentSession } = simpleSessionService.state;
    setSessionData(prev => ({
      ...prev,
      currentSession,
      chatMessages: currentSession?.messages || []
    }));
  };
  
  const processImageAPI = async (imageData, model, mode) => {
    const result = await simpleSessionService.processImage(imageData, model, mode);
    // Update local state
    const { currentSession } = simpleSessionService.state;
    setSessionData(prev => ({
      ...prev,
      currentSession,
      chatMessages: currentSession?.messages || []
    }));
    return result;
  };

  const loadSession = useCallback((session) => {
    // Set the session in the service
    simpleSessionService.setCurrentSession(session);
    // Update local state
    setSessionData({
      currentSession: session,
      chatMessages: session?.messages || [],
      sessionTitle: session?.title || '',
      isFavorite: session?.favorite || false,
      rating: session?.rating || 0
    });
    // Switch to chat mode when loading a session
    setPageMode('chat');
  }, [setPageMode]);

  return {
    // UI State
    ...uiState,
    
    // Session data from service
    ...sessionData,
    
    // Computed properties - simplified
    isIdle: !uiState.isProcessing && !uiState.isAIThinking,
    isError: !!uiState.error,
    
    // Actions - simplified
    startProcessing,
    stopProcessing,
    reset,
    setPageMode,
    handleError,
    startAIThinking,
    stopAIThinking,
    
    // Session management
    clearSession,
    addMessage,
    processImageAPI,
    loadSession
  };
};
