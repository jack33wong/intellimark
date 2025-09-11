/**
 * SessionContext - React Context for centralized session management
 * Provides session data and actions to all components
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import sessionManager from '../services/sessionManager';
import { useAuth } from './AuthContext';

const SessionContext = createContext(null);

export const SessionProvider = ({ children }) => {
  const { user, getAuthToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Initialize SessionManager with auth token getter
  useEffect(() => {
    sessionManager.setAuthTokenGetter(getAuthToken);
  }, [getAuthToken]);

  // Load sessions when user changes
  const loadSessions = useCallback(async () => {
    if (user?.uid) {
      setIsLoading(true);
      setError(null);
      try {
        await sessionManager.loadTasksFromDatabase(user.uid);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
  }, [user?.uid]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Listen to SessionManager events
  useEffect(() => {
    const unsubscribeSessionsLoaded = sessionManager.on('sessionsLoaded', ({ sessions: loadedSessions }) => {
      setSessions(loadedSessions);
    });

    const unsubscribeSessionsLoadError = sessionManager.on('sessionsLoadError', ({ error: loadError }) => {
      setError(loadError.message);
    });

    const unsubscribeCurrentSessionChanged = sessionManager.on('currentSessionChanged', ({ sessionId }) => {
      setCurrentSessionId(sessionId);
    });

    const unsubscribeSessionsCleared = sessionManager.on('sessionsCleared', () => {
      setSessions([]);
      setCurrentSessionId(null);
    });

    return () => {
      unsubscribeSessionsLoaded();
      unsubscribeSessionsLoadError();
      unsubscribeCurrentSessionChanged();
      unsubscribeSessionsCleared();
    };
  }, []);

  // Get current session
  const currentSession = currentSessionId ? sessionManager.getSession(currentSessionId) : null;

  // Session actions
  const createTask = useCallback(async (sessionData) => {
    try {
      const newSession = await sessionManager.createTask(sessionData);
      return newSession;
    } catch (error) {
      console.error('Failed to create task:', error);
      throw error;
    }
  }, []);

  const updateTask = useCallback(async (sessionId, updates) => {
    try {
      await sessionManager.updateTask(sessionId, updates);
    } catch (error) {
      console.error('Failed to update task:', error);
      throw error;
    }
  }, []);

  const deleteTask = useCallback(async (sessionId) => {
    try {
      await sessionManager.deleteTask(sessionId);
    } catch (error) {
      console.error('Failed to delete task:', error);
      throw error;
    }
  }, []);

  const switchToSession = useCallback((sessionId) => {
    sessionManager.setCurrentSessionId(sessionId);
  }, []);

  const refreshSessions = useCallback(async () => {
    if (user?.uid) {
      await sessionManager.refreshSessions(user.uid);
    }
  }, [user?.uid]);

  const value = {
    sessions,
    currentSessionId,
    currentSession,
    isLoading,
    error,
    sessionManager,
    setCurrentSessionId: sessionManager.setCurrentSessionId.bind(sessionManager),
    createTask,
    updateTask,
    deleteTask,
    switchToSession,
    refreshSessions,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSessionContext = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSessionContext must be used within a SessionProvider');
  }
  return context;
};
