import { useState, useEffect, useCallback, useMemo } from 'react';
import { FirestoreService } from '../services/firestoreService';

export function useFirestoreChat(userId) {
  const [chatSessions, setChatSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isClient, setIsClient] = useState(false);

  // Ensure we're on the client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Load chat sessions from Firestore
  const loadChatSessions = useCallback(async () => {
    // Don't load sessions if userId is not provided
    if (!userId) {
      console.log('useFirestoreChat: No userId provided, skipping session load');
      setChatSessions([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const sessions = await FirestoreService.getChatSessions(userId);
      setChatSessions(sessions);
      
      // Set current session to the most recent one if none is selected
      if (sessions.length > 0 && !currentSessionId) {
        setCurrentSessionId(sessions[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat sessions');
      console.error('Error loading chat sessions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId, currentSessionId]);

  // Create a new chat session
  const createNewChat = useCallback(async () => {
    if (!isClient) {
      throw new Error('Cannot create chat session during SSR');
    }
    
    try {
      setError(null);
      
      const sessionData = {
        title: 'New Chat',
        messages: [],
        userId
      };

      const newSessionId = await FirestoreService.createChatSession(sessionData);
      
      // Add the new session to the local state
      const newSession = {
        id: newSessionId,
        title: sessionData.title,
        messages: sessionData.messages,
        timestamp: new Date(),
        userId
      };

      setChatSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newSessionId);
      
      return newSessionId;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create new chat';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [userId, isClient]);

  // Switch to a different chat session
  const switchToSession = useCallback((sessionId) => {
    setCurrentSessionId(sessionId);
  }, []);

  // Update session title
  const updateSessionTitle = useCallback(async (sessionId, title) => {
    try {
      setError(null);
      await FirestoreService.updateChatSession(sessionId, { title });
      
      // Update local state
      setChatSessions(prev => 
        prev.map(session => 
          session.id === sessionId 
            ? { ...session, title }
            : session
        )
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update session title';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  // Delete a chat session
  const deleteSession = useCallback(async (sessionId) => {
    try {
      setError(null);
      await FirestoreService.deleteChatSession(sessionId);
      
      // Remove from local state
      setChatSessions(prev => prev.filter(session => session.id !== sessionId));
      
      // If we deleted the current session, switch to another one
      if (currentSessionId === sessionId) {
        const remainingSessions = chatSessions.filter(session => session.id !== sessionId);
        if (remainingSessions.length > 0) {
          setCurrentSessionId(remainingSessions[0].id);
        } else {
          setCurrentSessionId(null);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete session';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [currentSessionId, chatSessions]);

  // Add a message to the current session
  const addMessageToCurrentSession = useCallback(async (message) => {
    if (!isClient) {
      throw new Error('Cannot add message during SSR');
    }
    
    if (!currentSessionId) {
      throw new Error('No active chat session');
    }

    try {
      setError(null);
      await FirestoreService.addMessageToSession(currentSessionId, message);
      
      // Update local state
      const newMessage = {
        ...message,
        timestamp: new Date()
      };

      setChatSessions(prev => 
        prev.map(session => 
          session.id === currentSessionId
            ? { ...session, messages: [...session.messages, newMessage] }
            : session
        )
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add message';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [currentSessionId, isClient]);

  // Clear all chat sessions
  const clearAllSessions = useCallback(async () => {
    try {
      setError(null);
      await FirestoreService.clearAllSessions(userId);
      setChatSessions([]);
      setCurrentSessionId(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to clear sessions';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, [userId]);

  // Refresh sessions from Firestore
  const refreshSessions = useCallback(async () => {
    await loadChatSessions();
  }, [loadChatSessions]);

  // Get current session data
  const currentSession = useMemo(() => {
    return chatSessions.find(session => session.id === currentSessionId) || null;
  }, [chatSessions, currentSessionId]);

  // Load sessions on mount and when userId changes
  useEffect(() => {
    if (isClient) {
      loadChatSessions();
    }
  }, [loadChatSessions, isClient]);

  // Initialize with a default session if none exist
  useEffect(() => {
    if (isClient && !isLoading && chatSessions.length === 0 && !currentSessionId) {
      console.log('🆕 No existing sessions, creating default session...');
      createNewChat().catch(err => {
        console.error('Failed to create default session:', err);
        setError(`Failed to initialize chat: ${err.message}`);
      });
    }
  }, [isClient, isLoading, chatSessions.length, currentSessionId, createNewChat]);

  return {
    chatSessions,
    currentSessionId,
    currentSession,
    isLoading,
    error,
    createNewChat,
    switchToSession,
    updateSessionTitle,
    deleteSession,
    addMessageToCurrentSession,
    clearAllSessions,
    refreshSessions
  };
}
