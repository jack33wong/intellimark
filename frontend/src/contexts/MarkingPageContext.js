import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';

const MarkingPageContext = createContext();

// 1. All UI state, including chatInput, is now managed by the reducer for stability.
const initialState = {
  pageMode: 'upload',
  selectedModel: 'auto',
  showInfoDropdown: false,
  hoveredRating: 0,
  showScrollButton: false,
  hasNewResponse: false,
  newResponseMessageId: null,
  chatInput: '',
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
    case 'SET_SHOW_SCROLL_BUTTON':
      return { ...state, showScrollButton: action.payload };
    case 'SHOW_NEW_RESPONSE':
      return { ...state, hasNewResponse: true, newResponseMessageId: action.payload };
    case 'HIDE_NEW_RESPONSE':
      return { ...state, hasNewResponse: false, newResponseMessageId: null };
    case 'SET_CHAT_INPUT':
      return { ...state, chatInput: action.payload };
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
  const { pageMode, selectedModel, showInfoDropdown, hoveredRating, showScrollButton, hasNewResponse, newResponseMessageId, chatInput } = state;
  
  const setChatInput = useCallback((value) => dispatch({ type: 'SET_CHAT_INPUT', payload: value }), []);

  useEffect(() => {
    if (onPageModeChange) {
      onPageModeChange(pageMode === 'chat');
    }
  }, [pageMode, onPageModeChange]);

  // 2. The onSendMessage function is now complete and correct.
  const onSendMessage = useCallback(async (text) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;
    try {
      setChatInput(''); // Clear input immediately
      await addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        timestamp: new Date().toISOString(),
        type: 'text'
      });
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      startAIThinking();
      const authToken = await getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: trimmedText, model: 'auto', sessionId: currentSession?.id || null })
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success && data.unifiedSession) {
        simpleSessionService.updateSessionState(data.unifiedSession);
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }
    } catch (err) {
      console.error('Error sending text message:', err);
      handleError(err);
    } finally {
      stopAIThinking();
    }
  }, [getAuthToken, currentSession, addMessage, startAIThinking, stopAIThinking, handleError, setChatInput]);

  const chatContainerRef = useRef(null);
  const prevMessagesCountRef = useRef(chatMessages.length);
  const prevIsAIThinkingRef = useRef(isAIThinking);
  
  const scrollToBottom = useCallback(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);
  
  const scrollToMessage = useCallback((messageId) => {
    if (chatContainerRef.current && messageId) {
      const targetMessage = chatContainerRef.current.querySelector(`[data-message-id="${messageId}"]`);
      if (targetMessage) {
        targetMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }
    }
    scrollToBottom();
    return false;
  }, [scrollToBottom]);

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
  
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const isUp = container.scrollHeight - container.scrollTop - container.clientHeight > 200;
      dispatch({ type: 'SET_SHOW_SCROLL_BUTTON', payload: isUp });
      if (hasNewResponse && !isUp) {
        dispatch({ type: 'HIDE_NEW_RESPONSE' });
      }
    };
    container.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => container.removeEventListener('scroll', handleScroll);
  }, [chatContainerRef, hasNewResponse]);

  useEffect(() => {
    if (chatMessages.length > prevMessagesCountRef.current) {
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage && lastMessage.role === 'user') {
        scrollToBottom();
      }
    }
    prevMessagesCountRef.current = chatMessages.length;
  }, [chatMessages, scrollToBottom]);

  useEffect(() => {
    if (prevIsAIThinkingRef.current === true && isAIThinking === false) {
      const animationFrameId = requestAnimationFrame(() => {
        const container = chatContainerRef.current;
        if (!container) return;
        const lastMessage = chatMessages[chatMessages.length-1];
        if (!lastMessage) return;
        const isScrolledUp = container.scrollHeight - container.scrollTop - container.clientHeight > 200;
        if (isScrolledUp) {
          dispatch({ type: 'SHOW_NEW_RESPONSE', payload: lastMessage.id || lastMessage.timestamp });
        } else {
          scrollToBottom();
        }
      });
      return () => cancelAnimationFrame(animationFrameId);
    }
    prevIsAIThinkingRef.current = isAIThinking;
  }, [isAIThinking, chatMessages, scrollToBottom]);

  // 3. The handleImageAnalysis function is now complete and correct.
  const handleImageAnalysis = useCallback(async (file = null, customText = null) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return Promise.resolve();
    try {
      startProcessing();
      setChatInput(''); // Clear input immediately
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
      startAIThinking();
      await processImageAPI(imageData, selectedModel, 'marking', customText);
      clearFile();
    } catch (err) {
      console.error('Error in image analysis flow:', err);
      handleError(err);
    } finally {
      stopAIThinking();
      stopProcessing();
    }
  }, [selectedFile, selectedModel, processImage, addMessage, startProcessing, stopProcessing, startAIThinking, processImageAPI, clearFile, handleError, setChatInput]);
  
  const scrollToNewResponse = useCallback(() => {
    if (newResponseMessageId) {
      scrollToMessage(newResponseMessageId);
    }
    dispatch({ type: 'HIDE_NEW_RESPONSE' });
  }, [newResponseMessageId, scrollToMessage]);
  
  const getImageSrc = useCallback((message) => {
    if (message?.imageData) return message.imageData;
    if (message?.imageLink) return message.imageLink;
    return null;
  }, []);
  
  const handleModelChange = useCallback((model) => dispatch({ type: 'SET_SELECTED_MODEL', payload: model }), []);
  const onToggleInfoDropdown = useCallback(() => dispatch({ type: 'TOGGLE_INFO_DROPDOWN' }), []);
  const setHoveredRating = useCallback((rating) => dispatch({ type: 'SET_HOVERED_RATING', payload: rating }), []);
  
  // 4. The context value and its dependencies are now complete and correct.
  const value = useMemo(() => ({
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating,
    handleFileSelect, clearFile, handleModelChange, onModelChange: handleModelChange,
    handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating, onFavoriteToggle, onRatingChange,
    setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    chatInput, setChatInput, onSendMessage, onKeyPress: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.trim()) {
                onSendMessage(chatInput);
            }
        }
    },
    chatContainerRef,
    scrollToBottom, 
    showScrollButton, hasNewResponse, scrollToNewResponse,
    onFollowUpImage: handleImageAnalysis,
    getImageSrc,
    ...progressProps
  }), [
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating, handleFileSelect, clearFile,
    handleModelChange, handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating,
    onFavoriteToggle, onRatingChange, setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    chatInput, setChatInput, onSendMessage, chatContainerRef, scrollToBottom, showScrollButton,
    hasNewResponse, scrollToNewResponse, progressProps, getImageSrc
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

