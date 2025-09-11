/**
 * useSessionActions - Hook for session actions (create, update, delete, switch)
 */

import { useSessionContext } from '../contexts/SessionContext';
import { useCallback } from 'react';

export const useSessionActions = () => {
  const { 
    currentSession, 
    setCurrentSessionId, 
    createTask, 
    updateTask, 
    deleteTask,
    switchToSession,
    sessionManager
  } = useSessionContext();

  const selectSession = useCallback((sessionId) => {
    setCurrentSessionId(sessionId);
  }, [setCurrentSessionId]);

  const selectSessionWithFullData = useCallback(async (sessionId) => {
    try {
      // Load full session data with images
      await sessionManager.loadSingleTask(sessionId);
      // Set as current session
      setCurrentSessionId(sessionId);
    } catch (error) {
      console.error('Failed to load session with full data:', error);
      // Fallback to basic selection
      setCurrentSessionId(sessionId);
    }
  }, [sessionManager, setCurrentSessionId]);

  return {
    currentSession,
    selectSession,
    selectSessionWithFullData,
    createTask,
    updateTask,
    deleteTask,
    switchToSession,
  };
};
