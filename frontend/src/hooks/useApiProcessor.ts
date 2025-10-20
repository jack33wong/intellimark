import { useState, useCallback } from 'react';
import { simpleSessionService } from '../services/markingApiService';
import type { UnifiedMessage, UnifiedSession } from '../types';

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
  currentStepIndex: number;
}

// Define the type for the progress data from the backend
interface ProgressData {
  currentStepDescription?: string;
  allSteps?: any[];
  currentStepIndex?: number;
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
    currentStepIndex: 0,
  });

  const startProcessing = useCallback(() => {
    setApiState(prev => ({ ...prev, isProcessing: true, error: null, loadingProgress: 0, loadingMessage: 'Processing...' }));
  }, []);

  const stopProcessing = useCallback(() => {
    setApiState(prev => ({ ...prev, isProcessing: false }));
  }, []);

  const startAIThinking = useCallback((progressData: any = null, aiMessageId?: string) => {
    setApiState(prev => ({ ...prev, isAIThinking: true }));
    
    // Use provided aiMessageId or generate one
    // This ensures React treats processing and final messages as the same component
    const processingMessage: Partial<UnifiedMessage> = {
      id: aiMessageId || `ai-${Date.now()}`,
      messageId: aiMessageId || `ai-${Date.now()}`,
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
    
    // Clean up any orphaned processing messages (defense in depth)
    const currentSession = simpleSessionService.getCurrentSession() as any;
    if (currentSession?.messages && Array.isArray(currentSession.messages)) {
      const filteredMessages = currentSession.messages.filter((msg: any) => 
        !(msg.role === 'assistant' && msg.isProcessing)
      );
      if (filteredMessages.length !== currentSession.messages.length) {
        simpleSessionService.updateCurrentSessionOnly({
          ...currentSession,
          messages: filteredMessages
        });
      }
    }
  }, []);

  const handleError = useCallback((error: Error) => {
    setApiState(prev => ({ ...prev, isProcessing: false, isAIThinking: false, error: error.message || 'An unknown error occurred' }));
  }, []);

  const updateProgress = useCallback((data: ProgressData) => {
    const currentStepIndex = data.currentStepIndex || 0;
    const totalSteps = (data.allSteps || []).length;

    setApiState(prev => ({
      ...prev,
      loadingMessage: data.currentStepDescription || prev.loadingMessage,
      progressData: data,
      stepList: data.allSteps || [],
      currentStepIndex: currentStepIndex,
      loadingStep: currentStepIndex + (data.isComplete ? 0 : 1),
      loadingTotalSteps: totalSteps,
      loadingProgress: data.isComplete ? 100 : Math.round((currentStepIndex / (totalSteps || 1)) * 100)
    }));

    const currentSession = simpleSessionService.getCurrentSession() as UnifiedSession | null;
    if (currentSession?.messages?.length) {
      const processingMessageIndex = [...currentSession.messages].reverse().findIndex(m => m.isProcessing);

      if (processingMessageIndex !== -1) {
        const messageToUpdate = currentSession.messages[currentSession.messages.length - 1 - processingMessageIndex];

        const progressData = {
          currentStepDescription: data.currentStepDescription || '',
          allSteps: [...(data.allSteps || [])], // Create a new array to force React re-render
          currentStepIndex: data.currentStepIndex || 0,
          isComplete: data.isComplete || false,
        };

        // Use the simpler update method
        simpleSessionService.updateMessageInCurrentSession(messageToUpdate.id, { progressData });
      }
    }
  }, []);

  const processImageAPI = useCallback(async (imageData: string, model: string, mode: string, customText?: string, aiMessageId?: string, originalFileName?: string) => {
    try {
      // 👇 FIX: Use a type assertion `as any` for the callback as well to resolve the type mismatch.
      const result = await simpleSessionService.processImageWithProgress(
        imageData, model, mode, customText as any, updateProgress as any, aiMessageId as any, originalFileName as any
      );
      return result;
    } catch (error) {
      handleError(error as Error);
      throw error;
    }
  }, [updateProgress, handleError]);

  const processMultiImageAPI = useCallback(async (files: File[], model: string, mode: string, customText?: string, aiMessageId?: string) => {
    try {
      const result = await simpleSessionService.processMultiImageWithProgress(
        files, model, mode, customText as any, updateProgress as any, aiMessageId as any
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
    processMultiImageAPI,
    setShowProgressDetails,
  };
};

