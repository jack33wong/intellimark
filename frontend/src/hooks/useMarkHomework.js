/**
 * Consolidated Mark Homework Hook
 * 
 * Single source of truth for all mark homework functionality
 * Replaces multiple hooks with one clean interface
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';

// Processing states - simplified
export const PROCESSING_STATE = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  ERROR: 'error'
};

export const useMarkHomework = () => {
  const { getAuthToken } = useAuth();
  
  // Single state object
  const [state, setState] = useState({
    // Processing state
    processingState: PROCESSING_STATE.IDLE,
    isAIThinking: false,
    
    // Session data
    currentSession: null,
    chatMessages: [],
    sessionTitle: '',
    isFavorite: false,
    rating: 0,
    
    // UI state
    pageMode: 'upload', // 'upload' | 'chat'
    
    // Error state
    error: null
  });

  // Computed properties - simplified
  const isIdle = state.processingState === PROCESSING_STATE.IDLE;
  const isProcessing = state.processingState === PROCESSING_STATE.PROCESSING;
  const isError = state.processingState === PROCESSING_STATE.ERROR;
  const isAIThinking = state.isAIThinking;
  

  // Initialize session service
  useEffect(() => {
    simpleSessionService.setAuthContext({ getAuthToken });
    
    // Subscribe to session changes
    const unsubscribe = simpleSessionService.subscribe((sessionState) => {
      setState(prev => ({
        ...prev,
        currentSession: sessionState.currentSession,
        chatMessages: sessionState.currentSession?.messages || [],
        sessionTitle: sessionState.currentSession?.title || '',
        isFavorite: sessionState.currentSession?.favorite || false,
        rating: sessionState.currentSession?.rating || 0,
        error: sessionState.error
      }));
    });
    
    return unsubscribe;
  }, [getAuthToken]);

  // State transitions - simplified
  const setProcessingState = useCallback((newState) => {
    setState(prev => ({
      ...prev,
      processingState: newState
    }));
  }, []);

  // Actions - simplified
  const startProcessing = useCallback(() => {
    setProcessingState(PROCESSING_STATE.PROCESSING);
  }, [setProcessingState]);


  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      processingState: PROCESSING_STATE.IDLE,
      isAIThinking: false,
      error: null
    }));
  }, []);

  // AI thinking state control
  const startAIThinking = useCallback(() => {
    setState(prev => ({ ...prev, isAIThinking: true }));
  }, []);

  const stopAIThinking = useCallback(() => {
    setState(prev => ({ ...prev, isAIThinking: false }));
  }, []);

  const setPageMode = useCallback((mode) => {
    setState(prev => ({ ...prev, pageMode: mode }));
  }, []);

  const handleError = useCallback((error) => {
    setProcessingState(PROCESSING_STATE.ERROR);
    setState(prev => ({
      ...prev,
      error: error.message || 'Unknown error'
    }));
  }, [setProcessingState]);

  // Session management
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
    // Set the session in the service
    simpleSessionService.setCurrentSession(session);
    
    // Update local state
    setState(prev => ({
      ...prev,
      currentSession: session,
      chatMessages: session?.messages || [],
      sessionTitle: session?.title || '',
      isFavorite: session?.favorite || false,
      rating: session?.rating || 0,
      pageMode: 'chat' // Switch to chat mode when loading a session
    }));
  }, []);

  return {
    // State
    ...state,
    
    // Computed properties - simplified
    isIdle,
    isProcessing,
    isError,
    isAIThinking,
    
    // Actions - simplified
    startProcessing,
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
