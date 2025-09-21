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

  // Get session data directly from service - single source of truth
  const { currentSession } = simpleSessionService.state;
  const chatMessages = currentSession?.messages || [];
  const sessionTitle = currentSession?.title || '';
  const isFavorite = currentSession?.favorite || false;
  const rating = currentSession?.rating || 0;

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

  return {
    // UI State
    ...uiState,
    
    // Session data from service - single source of truth
    currentSession,
    chatMessages,
    sessionTitle,
    isFavorite,
    rating,
    
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
