/**
 * useSessionSync - Hook for session synchronization features
 */

import { useEffect } from 'react';
import { useSessionContext } from '../contexts/SessionContext';

export const useSessionSync = () => {
  const { currentSessionId, setCurrentSessionId, refreshSessions } = useSessionContext();

  // Sync current session ID with localStorage
  useEffect(() => {
    const savedSessionId = localStorage.getItem('currentSessionId');
    if (savedSessionId && savedSessionId !== currentSessionId) {
      setCurrentSessionId(savedSessionId);
    }
  }, [currentSessionId, setCurrentSessionId]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('currentSessionId', currentSessionId);
    } else {
      localStorage.removeItem('currentSessionId');
    }
  }, [currentSessionId]);

  return { 
    currentSessionId, 
    setCurrentSessionId, 
    refreshSessions 
  };
};
