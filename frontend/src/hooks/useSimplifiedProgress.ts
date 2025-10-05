/**
 * Simplified Progress Hook
 * Non-breaking: maintains same interface as useApiProcessor but with simplified state management
 */

import { useState, useCallback } from 'react';
import { simpleSessionService } from '../services/simpleSessionService';
import type { UnifiedSession, UnifiedMessage } from '../types/index';

export interface SimplifiedProgressState {
  isProcessing: boolean;
  currentStep: string;
  progress: number;
  totalSteps: number;
  isComplete: boolean;
}

export interface ProgressData {
  currentStepDescription: string;
  allSteps: string[];
  currentStepIndex: number;
  isComplete: boolean;
}

export const useSimplifiedProgress = () => {
  const [progressState, setProgressState] = useState<SimplifiedProgressState>({
    isProcessing: false,
    currentStep: '',
    progress: 0,
    totalSteps: 0,
    isComplete: false
  });

  const updateProgress = useCallback((data: ProgressData) => {
    const currentStepIndex = data.currentStepIndex || 0;
    const totalSteps = (data.allSteps || []).length;
    const progress = data.isComplete ? 100 : Math.round((currentStepIndex / (totalSteps || 1)) * 100);

    setProgressState({
      isProcessing: !data.isComplete,
      currentStep: data.currentStepDescription || '',
      progress,
      totalSteps,
      isComplete: data.isComplete || false
    });

    // Update message in session (simplified)
    const currentSession = simpleSessionService.getCurrentSession() as UnifiedSession | null;
    if (currentSession?.messages?.length) {
      const processingMessageIndex = [...currentSession.messages].reverse().findIndex(m => m.isProcessing);

      if (processingMessageIndex !== -1) {
        const messageToUpdate = currentSession.messages[currentSession.messages.length - 1 - processingMessageIndex];
        
        // Simplified progress data structure
        const simplifiedProgressData = {
          currentStepDescription: data.currentStepDescription || '',
          allSteps: data.allSteps || [],
          currentStepIndex: data.currentStepIndex || 0,
          isComplete: data.isComplete || false,
        };

        simpleSessionService.updateMessageInCurrentSession(messageToUpdate.id, { 
          progressData: simplifiedProgressData 
        });
      }
    }
  }, []);

  const startProcessing = useCallback((aiMessageId?: string) => {
    setProgressState(prev => ({ ...prev, isProcessing: true, isComplete: false }));
    
    // Create processing message
    const processingMessage: UnifiedMessage = {
      id: aiMessageId || `ai-${Date.now()}`,
      role: 'assistant',
      content: '',
      isProcessing: true,
      progressData: { 
        currentStepDescription: 'Starting...',
        allSteps: [], 
        currentStepIndex: 0, 
        isComplete: false 
      },
      timestamp: new Date().toISOString()
    };

    simpleSessionService.addMessage(processingMessage);
  }, []);

  const stopProcessing = useCallback(() => {
    setProgressState(prev => ({ ...prev, isProcessing: false, isComplete: true }));
  }, []);

  const resetProgress = useCallback(() => {
    setProgressState({
      isProcessing: false,
      currentStep: '',
      progress: 0,
      totalSteps: 0,
      isComplete: false
    });
  }, []);

  return {
    progressState,
    updateProgress,
    startProcessing,
    stopProcessing,
    resetProgress
  };
};
