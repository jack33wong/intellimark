/**
 * useSessionManager Hook (TypeScript)
 * Manages all session-related state and interactions with the session service.
 */
import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';
import { UnifiedSession, UnifiedMessage } from '../types';

// Define the shape of the state managed by this hook
interface SessionState {
  currentSession: UnifiedSession | null;
  chatMessages: UnifiedMessage[];
  sessionTitle: string;
  isFavorite: boolean;
  rating: number;
}

// Define the shape of the state object from the service.
interface ServiceState {
    currentSession: UnifiedSession | null;
    sidebarSessions: UnifiedSession[];
}

export const useSessionManager = () => {
  const { getAuthToken } = useAuth();
  
  const [sessionState, setSessionState] = useState<SessionState>({
    currentSession: null,
    chatMessages: [],
    sessionTitle: '',
    isFavorite: false,
    rating: 0,
  });

  useEffect(() => {
    if (simpleSessionService.setAuthContext) {
      simpleSessionService.setAuthContext({ getAuthToken });
    }

    // 👇 FIX: Use `any` for the parameter from the JS service and cast it internally.
    // This correctly handles the type mismatch between the JS service and the TS hook.
    const syncWithService = (serviceState: any) => {
      const { currentSession } = serviceState as ServiceState;
      setSessionState({
        currentSession,
        chatMessages: currentSession?.messages || [],
        sessionTitle: currentSession?.title || '',
        isFavorite: currentSession?.favorite || false,
        rating: currentSession?.rating || 0,
      });
    };

    const unsubscribe = simpleSessionService.subscribe(syncWithService);
    
    // Perform the initial sync.
    syncWithService({ 
        currentSession: simpleSessionService.getCurrentSession(),
        sidebarSessions: [], // This is correct as the hook doesn't use sidebarSessions directly.
    });

    return () => {
      unsubscribe();
    };
  }, [getAuthToken]);

  const addMessage = useCallback(async (message: Partial<UnifiedMessage>) => {
    await simpleSessionService.addMessage(message);
  }, []);

  const clearSession = useCallback(() => {
    simpleSessionService.clearSession();
  }, []);

  const loadSession = useCallback((session: UnifiedSession) => {
    simpleSessionService.setCurrentSession(session);
  }, []);

  const onFavoriteToggle = useCallback(async () => {
    const { currentSession, isFavorite } = sessionState;
    if (currentSession) {
      const newFavoriteStatus = !isFavorite;
      const updatedSession = { ...currentSession, favorite: newFavoriteStatus, updatedAt: new Date().toISOString() };
      
      simpleSessionService.updateSessionState(updatedSession);
      
      try {
        await simpleSessionService.updateSession(currentSession.id, { favorite: newFavoriteStatus });
      } catch (err) {
        console.error('Failed to update favorite status:', err);
      }
    }
  }, [sessionState.currentSession, sessionState.isFavorite]);

  const onRatingChange = useCallback(async (newRating: number) => {
    const { currentSession } = sessionState;
    if (currentSession) {
      const updatedSession = { ...currentSession, rating: newRating, updatedAt: new Date().toISOString() };
      
      simpleSessionService.updateSessionState(updatedSession);
      
      try {
        await simpleSessionService.updateSession(currentSession.id, { rating: newRating });
      } catch (err) {
        console.error('Failed to update rating:', err);
      }
    }
  }, [sessionState.currentSession]);

  const onTitleUpdate = useCallback(async (newTitle: string) => {
    const { currentSession } = sessionState;
    if (currentSession && newTitle.trim() && newTitle !== currentSession.title) {
      const updatedSession = { ...currentSession, title: newTitle.trim(), updatedAt: new Date().toISOString() };
      
      simpleSessionService.updateSessionState(updatedSession);
      
      try {
        await simpleSessionService.updateSession(currentSession.id, { title: newTitle.trim() });
      } catch (err) {
        console.error('Failed to update title:', err);
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
    onTitleUpdate,
  };
};

