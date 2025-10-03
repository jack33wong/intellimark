import { useState, useCallback } from 'react';
import { simpleSessionService } from '../services/simpleSessionService';
import { UnifiedMessage, UnifiedSession } from '../types';

// Define the shape of the API state
interface ApiState {
  isProcessing: boolean;
  isAIThinking: boolean;
  error: string | null;
  loadingProgress: number;
  loadingStep: number;
  loadingTotalSteps: number | null;
  loadingMessage: string;
  showProgressDetails: boolean;
  progressData: any; 
  stepList: any[];
  completedSteps: any[];
}

// Define the type for the progress data from the backend
interface ProgressData {
  currentStepDescription?: string;
  allSteps?: any[];
  completedSteps?: any[];
  isComplete?: boolean;
}

export const useApiProcessor = () => {
  const [apiState, setApiState] = useState<ApiState>({
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

  const startAIThinking = useCallback((progressData: any = null) => {
    setApiState(prev => ({ ...prev, isAIThinking: true }));
    const processingMessage: Partial<UnifiedMessage> = {
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

  const handleError = useCallback((error: Error) => {
    setApiState(prev => ({ ...prev, isProcessing: false, isAIThinking: false, error: error.message || 'An unknown error occurred' }));
  }, []);

  const updateProgress = useCallback((data: ProgressData) => {
    setApiState(prev => ({
      ...prev,
      loadingMessage: data.currentStepDescription || prev.loadingMessage,
      progressData: data,
      stepList: data.allSteps || [],
      completedSteps: data.completedSteps || [],
      loadingStep: (data.completedSteps || []).length + (data.isComplete ? 0 : 1),
      loadingTotalSteps: (data.allSteps || []).length,
      loadingProgress: data.isComplete ? 100 : Math.round(((data.completedSteps || []).length / ((data.allSteps || []).length || 1)) * 100)
    }));

    const currentSession = simpleSessionService.getCurrentSession() as UnifiedSession | null;
    if (currentSession?.messages?.length) {
      const processingMessageIndex = [...currentSession.messages].reverse().findIndex(m => m.isProcessing);
      
      if (processingMessageIndex !== -1) {
        const indexToUpdate = currentSession.messages.length - 1 - processingMessageIndex;
        const updatedMessages = [...currentSession.messages];
        const messageToUpdate = updatedMessages[indexToUpdate];
        
        const updatedMessage: UnifiedMessage = {
          ...messageToUpdate,
          progressData: {
            currentStepDescription: data.currentStepDescription || '',
            completedSteps: data.completedSteps || [],
            allSteps: data.allSteps || [],
            isComplete: data.isComplete || false,
          }
        };

        updatedMessages[indexToUpdate] = updatedMessage;
        
        const updatedSession = {
          ...currentSession,
          messages: updatedMessages,
        };
        
        simpleSessionService.setCurrentSession(updatedSession);
      }
    }
  }, []);

  const processImageAPI = useCallback(async (imageData: string, model: string, mode: string, customText?: string) => {
    try {
      // 👇 FIX: Use a type assertion `as any` for the callback as well to resolve the type mismatch.
      const result = await simpleSessionService.processImageWithProgress(
        imageData, model, mode, customText as any, updateProgress as any
      );
      return result;
    } catch (error) {
      handleError(error as Error);
      throw error;
    }
  }, [updateProgress, handleError]);

  const setShowProgressDetails = useCallback((show: boolean) => {
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

