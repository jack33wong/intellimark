import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';

export const useSessionManager = () => {
  const { getAuthToken } = useAuth();
  
  const [sessionState, setSessionState] = useState({
    currentSession: null,
    chatMessages: [],
    sessionTitle: '',
    isFavorite: false,
    rating: 0,
  });

  useEffect(() => {
    simpleSessionService.setAuthContext({ getAuthToken });

    const syncWithService = (serviceState) => {
      const { currentSession } = serviceState;
      setSessionState({
        currentSession,
        chatMessages: currentSession?.messages || [],
        sessionTitle: currentSession?.title || '',
        isFavorite: currentSession?.favorite || false,
        rating: currentSession?.rating || 0,
      });
    };

    const unsubscribe = simpleSessionService.subscribe(syncWithService);
    syncWithService({ currentSession: simpleSessionService.getCurrentSession() });

    return unsubscribe;
  }, [getAuthToken]);

  const addMessage = useCallback(async (message) => {
    await simpleSessionService.addMessage(message);
  }, []);

  const clearSession = useCallback(() => {
    simpleSessionService.clearSession();
  }, []);

  const loadSession = useCallback((session) => {
    simpleSessionService.setCurrentSession(session);
  }, []);

  // 👇 FIX: The onFavoriteToggle function now correctly calls updateSessionState,
  // which dispatches the global event that the sidebar listens for.
  const onFavoriteToggle = useCallback(async () => {
    const { currentSession, isFavorite } = sessionState;
    if (currentSession) {
      const newFavoriteStatus = !isFavorite;
      const updatedSession = { ...currentSession, favorite: newFavoriteStatus, updatedAt: new Date().toISOString() };
      
      // Optimistic UI update for the main chat AND the sidebar.
      simpleSessionService.updateSessionState(updatedSession);
      
      try {
        await simpleSessionService.updateSession(currentSession.id, { favorite: newFavoriteStatus });
      } catch (err) {
        console.error('❌ Failed to update favorite status:', err);
        // Optional: Add logic to revert the optimistic update on error
      }
    }
  }, [sessionState.currentSession, sessionState.isFavorite]);

  const onRatingChange = useCallback(async (newRating) => {
    const { currentSession } = sessionState;
    if (currentSession) {
      const updatedSession = { ...currentSession, rating: newRating, updatedAt: new Date().toISOString() };
      
      // Also dispatch an event for rating changes
      simpleSessionService.updateSessionState(updatedSession);
      
      try {
        await simpleSessionService.updateSession(currentSession.id, { rating: newRating });
      } catch (err) {
        console.error('❌ Failed to update rating:', err);
      }
    }
  }, [sessionState.currentSession]);

  return {
    ...sessionState,
    addMessage,
    clearSession,
    loadSession,
    onFavoriteToggle,
    onRatingChange,
  };
};

