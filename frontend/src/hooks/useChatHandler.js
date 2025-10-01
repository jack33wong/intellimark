import { useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';

// This hook now accepts chatInput and setChatInput from the parent context.
export const useChatHandler = (currentSession, chatInput, setChatInput, addMessage, stopAIThinking, startAIThinking, updateProgress, handleError) => {
  const { getAuthToken } = useAuth();
  const isSendingMessage = useRef(false);

  const onSendMessage = useCallback(async (text) => {
    const trimmedText = text.trim();
    if (!trimmedText || isSendingMessage.current) return;
    
    isSendingMessage.current = true;
    
    try {
      // Use the stable setChatInput function from the context to clear the input.
      setChatInput('');

      const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        timestamp: new Date().toISOString(),
        type: 'text'
      };
      
      await addMessage(userMessage);
      
      startAIThinking();
      
      const authToken = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: trimmedText,
          model: 'auto',
          sessionId: currentSession?.id || null
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.unifiedSession) {
        simpleSessionService.setCurrentSession(data.unifiedSession);
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }
    } catch (error) {
      console.error('❌ Error sending text message:', error);
      handleError(error);
    } finally {
      stopAIThinking();
      isSendingMessage.current = false;
    }
  }, [getAuthToken, currentSession, addMessage, startAIThinking, stopAIThinking, handleError, setChatInput]);

  const onKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Use the chatInput value passed in from the context.
      if (chatInput && chatInput.trim()) {
        onSendMessage(chatInput);
      }
    }
  }, [onSendMessage, chatInput]);

  // The hook no longer returns chatInput or setChatInput.
  return {
    onSendMessage,
    onKeyPress,
  };
};

