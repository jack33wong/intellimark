import { useState, useCallback } from 'react';
import { simpleSessionService } from '../services/simpleSessionService';

export const useApiProcessor = () => {
  const [apiState, setApiState] = useState({
    isProcessing: false,
    isAIThinking: false,
    error: null,
    loadingProgress: 0,
    loadingStep: 0,
    loadingTotalSteps: null,
    loadingMessage: 'Processing...',
    showProgressDetails: false,
    progressData: null,
    stepList: [],
    completedSteps: [],
  });

  const startProcessing = useCallback(() => {
    setApiState(prev => ({ ...prev, isProcessing: true, error: null, loadingProgress: 0, loadingMessage: 'Processing...' }));
  }, []);

  const stopProcessing = useCallback(() => {
    setApiState(prev => ({ ...prev, isProcessing: false }));
  }, []);

  const startAIThinking = useCallback((progressData = null) => {
    setApiState(prev => ({ ...prev, isAIThinking: true }));
    const processingMessage = {
      id: `processing-${Date.now()}`,
      role: 'assistant',
      content: '',
      isProcessing: true,
      progressData: progressData || { allSteps: [] },
      timestamp: new Date().toISOString()
    };
    simpleSessionService.addMessage(processingMessage);
  }, []);

  const stopAIThinking = useCallback(() => {
    setApiState(prev => ({ ...prev, isAIThinking: false }));
  }, []);

  const handleError = useCallback((error) => {
    setApiState(prev => ({ ...prev, isProcessing: false, isAIThinking: false, error: error.message || 'An unknown error occurred' }));
  }, []);

  // 👇 FIX: The updateProgress function now also updates the session message in real-time.
  const updateProgress = useCallback((data) => {
    // 1. Update the hook's own state for the top-level progress bar/dropdown
    setApiState(prev => ({
      ...prev,
      loadingMessage: data.currentStepDescription || prev.loadingMessage,
      progressData: data,
      stepList: data.allSteps || [],
      completedSteps: data.completedSteps || [],
      loadingStep: (data.completedSteps || []).length + (data.isComplete ? 0 : 1),
      loadingTotalSteps: (data.allSteps || []).length,
      loadingProgress: data.isComplete ? 100 : Math.round(((data.completedSteps || []).length / (data.allSteps || []).length) * 100)
    }));

    // 2. Update the "isProcessing" message object itself for the ChatMessage component
    const currentSession = simpleSessionService.getCurrentSession();
    if (currentSession && currentSession.messages && currentSession.messages.length > 0) {
      const processingMessageIndex = currentSession.messages.map(m => m.isProcessing).lastIndexOf(true);

      if (processingMessageIndex !== -1) {
        const updatedMessages = [...currentSession.messages];
        const messageToUpdate = updatedMessages[processingMessageIndex];
        
        const updatedMessage = {
          ...messageToUpdate,
          progressData: data
        };

        updatedMessages[processingMessageIndex] = updatedMessage;
        
        const updatedSession = {
          ...currentSession,
          messages: updatedMessages,
        };
        
        // This notifies all subscribed components (like our context) of the change
        simpleSessionService.setCurrentSession(updatedSession);
      }
    }
  }, []);

  const processImageAPI = useCallback(async (imageData, model, mode, customText = null) => {
    try {
      const result = await simpleSessionService.processImageWithProgress(
        imageData, model, mode, customText, updateProgress
      );
      return result;
    } catch (error) {
      handleError(error);
      throw error;
    }
  }, [updateProgress, handleError]);

  const setShowProgressDetails = useCallback((show) => {
    setApiState(prev => ({ ...prev, showProgressDetails: show }));
  }, []);

  return {
    ...apiState,
    startProcessing,
    stopProcessing,
    startAIThinking,
    stopAIThinking,
    handleError,
    updateProgress,
    processImageAPI,
    setShowProgressDetails,
  };
};

