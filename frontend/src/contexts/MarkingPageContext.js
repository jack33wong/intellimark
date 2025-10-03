import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';
import { useScrollManager } from '../hooks/useScrollManager';

const MarkingPageContext = createContext();

const initialState = {
  pageMode: 'upload',
  selectedModel: 'auto',
  showInfoDropdown: false,
  hoveredRating: 0,
};

function markingPageReducer(state, action) {
  switch (action.type) {
    case 'SET_PAGE_MODE':
      return { ...state, pageMode: action.payload };
    case 'SET_SELECTED_MODEL':
      return { ...state, selectedModel: action.payload };
    case 'TOGGLE_INFO_DROPDOWN':
      return { ...state, showInfoDropdown: !state.showInfoDropdown };
    case 'SET_HOVERED_RATING':
      return { ...state, hoveredRating: action.payload };
    default:
      throw new Error(`Unhandled action type: ${action.type}`);
  }
}

export const MarkingPageProvider = ({ children, selectedMarkingResult, onPageModeChange }) => {
  const { user, getAuthToken } = useAuth();
  const { selectedFile, processImage, clearFile, handleFileSelect } = useImageUpload();
  
  const {
    currentSession, chatMessages, sessionTitle, isFavorite, rating,
    addMessage, clearSession, loadSession, onFavoriteToggle, onRatingChange
  } = useSessionManager();

  const apiProcessor = useApiProcessor();
  const { isProcessing, isAIThinking, error, ...progressProps } = apiProcessor;
  const { startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, handleError } = apiProcessor;
  
  const [state, dispatch] = useReducer(markingPageReducer, initialState);
  const { pageMode, selectedModel, showInfoDropdown, hoveredRating } = state;

  const {
    chatContainerRef,
    showScrollButton,
    hasNewResponse,
    scrollToBottom,
    scrollToNewResponse,
    scrollToMessage,
  } = useScrollManager(chatMessages, isAIThinking);

  // This effect connects the service to the API state controls from our hook.
  useEffect(() => {
    if (simpleSessionService.setApiControls) {
      simpleSessionService.setApiControls({ stopAIThinking, stopProcessing, handleError });
    }
  }, [stopAIThinking, stopProcessing, handleError]);

  useEffect(() => {
    if (onPageModeChange) {
      onPageModeChange(pageMode === 'chat');
    }
  }, [pageMode, onPageModeChange]);

  const onSendMessage = useCallback(async (text) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    try {
      // Use content-based ID for stability across re-renders
      // Use simple hash to match backend approach
      const contentHash = trimmedText.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0).toString(36).substring(0, 8);
      await addMessage({
        id: `user-${contentHash}`,
        role: 'user',
        content: trimmedText,
        timestamp: new Date().toISOString(),
        type: 'text'
      });
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      
      const textProgressData = {
        isComplete: false,
        currentStepDescription: 'Processing question...',
        allSteps: ['Processing question...', 'Generating response...'],
        completedSteps: [],
      };
      
      // Generate a predictable AI message ID that backend can use
      // Use contentHash + timestamp to ensure uniqueness while maintaining stability
      const aiMessageId = `ai-${contentHash}-${Date.now()}`;
      startAIThinking(textProgressData, aiMessageId);

      const authToken = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          message: trimmedText, 
          model: 'auto', 
          sessionId: currentSession?.id || null,
          aiMessageId: aiMessageId // Pass the AI message ID to backend
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      if (data.success) {
        if (data.unifiedSession) {
          // Authenticated users get full session data
          simpleSessionService.updateSessionState(data.unifiedSession);
        } else if (data.newMessages) {
          // Unauthenticated users get new messages to append
          // Create a temporary session with the new messages
          const tempSession = {
            id: data.sessionId || `temp-${Date.now()}`,
            title: data.sessionTitle || 'Chat Session',
            messages: data.newMessages,
            sessionMetadata: {}
          };
          simpleSessionService.updateSessionState(tempSession);
        } else {
          throw new Error(data.error || 'No session data received');
        }
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }
    } catch (err) {
      handleError(err);
      // Stop state only if the initial fetch fails. The service handles success.
      stopAIThinking();
    }
  }, [getAuthToken, currentSession, addMessage, startAIThinking, stopAIThinking, handleError]);
  
  useEffect(() => {
    if (selectedMarkingResult) {
      loadSession(selectedMarkingResult);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
    } else {
      clearSession();
      dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
    }
  }, [selectedMarkingResult, loadSession, clearSession]);

  useEffect(() => {
    if (selectedMarkingResult && currentSession?.id === selectedMarkingResult.id) {
      const timeoutId = setTimeout(() => {
          const lastUserMessage = [...(currentSession.messages || [])].reverse().find(m => m.role === 'user');
          if (lastUserMessage) {
              scrollToMessage(lastUserMessage.id);
          } else {
              scrollToBottom();
          }
      }, 150);
      return () => clearTimeout(timeoutId);
    }
  }, [currentSession, selectedMarkingResult, scrollToMessage, scrollToBottom]);

  const handleImageAnalysis = useCallback(async (file = null, customText = null) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return;
    try {
      startProcessing();
      const imageData = await processImage(targetFile);
      const optimisticMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: customText || 'I have a question about this image.',
        timestamp: new Date().toISOString(),
        imageData: imageData,
        fileName: targetFile.name,
      };
      await addMessage(optimisticMessage);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      // Generate unique AI message ID for image processing
      const imageContentHash = imageData.split('').reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0).toString(36).substring(0, 8);
      const imageAiMessageId = `ai-${imageContentHash}-${Date.now()}`;
      startAIThinking(null, imageAiMessageId);
      await processImageAPI(imageData, selectedModel, 'marking', customText || undefined, imageAiMessageId);
      clearFile();
    } catch (err) {
      console.error('Error in image analysis flow:', err);
      handleError(err);
      // Also stop states on initial error. The service handles success.
      stopAIThinking();
      stopProcessing();
    }
  }, [selectedFile, selectedModel, processImage, addMessage, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, clearFile, handleError]);
  
  const getImageSrc = useCallback((message) => {
    if (message?.imageData) return message.imageData;
    if (message?.imageLink) return message.imageLink;
    return null;
  }, []);
  
  const handleModelChange = useCallback((model) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model }), []);
  const onToggleInfoDropdown = useCallback(() => dispatch({ type: 'TOGGLE_INFO_DROPDOWN' }), []);
  const setHoveredRating = useCallback((rating) => dispatch({ type: 'SET_HOVERED_RATING', payload: rating }), []);
  
  const value = useMemo(() => ({
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating,
    handleFileSelect, clearFile, handleModelChange, onModelChange: handleModelChange,
    handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating, onFavoriteToggle, onRatingChange,
    setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    onSendMessage,
    chatContainerRef,
    scrollToBottom, 
    showScrollButton, 
    hasNewResponse, 
    scrollToNewResponse,
    onFollowUpImage: handleImageAnalysis,
    getImageSrc,
    ...progressProps
  }), [
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating, handleFileSelect, clearFile,
    handleModelChange, handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating,
    onFavoriteToggle, onRatingChange, setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    onSendMessage, chatContainerRef, scrollToBottom, showScrollButton, hasNewResponse, scrollToNewResponse, progressProps, getImageSrc
  ]);

  return (
    <MarkingPageContext.Provider value={value}>
      {children}
    </MarkingPageContext.Provider>
  );
};

export const useMarkingPage = () => {
  const context = useContext(MarkingPageContext);
  if (context === undefined) {
    throw new Error('useMarkingPage must be used within a MarkingPageProvider');
  }
  return context;
};

