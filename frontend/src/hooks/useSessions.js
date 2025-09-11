/**
 * useSessions - Hook for accessing session list and loading state
 */

import { useSessionContext } from '../contexts/SessionContext';

export const useSessions = () => {
  const { sessions, isLoading, error, refreshSessions } = useSessionContext();
  
  return { 
    sessions, 
    isLoading, 
    error, 
    refreshSessions 
  };
};
