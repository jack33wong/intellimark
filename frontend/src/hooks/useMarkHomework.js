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

  // Get session data directly from service (no subscription needed)
  const sessionData = simpleSessionService.state;
  const currentSession = sessionData.currentSession;
  const chatMessages = currentSession?.messages || [];
  const sessionTitle = currentSession?.title || '';
  const isFavorite = currentSession?.favorite || false;
  const rating = currentSession?.rating || 0;

  // Actions - simplified
  const startProcessing = useCallback(() => {
    setUiState(prev => ({ ...prev, isProcessing: true }));
  }, []);

  const stopProcessing = useCallback(() => {
    setUiState(prev => ({ ...prev, isProcessing: false }));
  }, []);

  const reset = useCallback(() => {
    setUiState(prev => ({
      ...prev,
      isProcessing: false,
      isAIThinking: false,
      error: null
    }));
  }, []);

  // AI thinking state control
  const startAIThinking = useCallback(() => {
    setUiState(prev => ({ ...prev, isAIThinking: true }));
  }, []);

  const stopAIThinking = useCallback(() => {
    setUiState(prev => ({ ...prev, isAIThinking: false }));
  }, []);

  const setPageMode = useCallback((mode) => {
    setUiState(prev => ({ ...prev, pageMode: mode }));
  }, []);

  const handleError = useCallback((error) => {
    setUiState(prev => ({
      ...prev,
      isProcessing: false,
      error: error.message || 'Unknown error'
    }));
  }, []);

  // Session management - simplified
  const clearSession = useCallback(() => {
    simpleSessionService.clearSession();
  }, []);

  const addMessage = useCallback((message) => {
    simpleSessionService.addMessage(message);
  }, []);

  const processImageAPI = useCallback(async (imageData, model, mode) => {
    return await simpleSessionService.processImage(imageData, model, mode);
  }, []);

  const loadSession = useCallback((session) => {
    // Set the session in the service (no local state update needed)
    simpleSessionService.setCurrentSession(session);
    // Switch to chat mode when loading a session
    setPageMode('chat');
  }, [setPageMode]);

  return {
    // UI State
    ...uiState,
    
    // Session data from service
    currentSession,
    chatMessages,
    sessionTitle,
    isFavorite,
    rating,
    
    // Computed properties - simplified
    isIdle: !uiState.isProcessing && !uiState.isAIThinking,
    isProcessing: uiState.isProcessing,
    isError: !!uiState.error,
    isAIThinking: uiState.isAIThinking,
    
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
