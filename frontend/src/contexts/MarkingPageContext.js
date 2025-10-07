import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';
import { useScrollManager } from '../hooks/useScrollManager';
import { createAIMessageId } from '../utils/messageUtils.js';

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
    addMessage, clearSession, loadSession, onFavoriteToggle, onRatingChange, onTitleUpdate
  } = useSessionManager();

  const apiProcessor = useApiProcessor();
  const { isProcessing, isAIThinking, error, ...progressProps } = apiProcessor;
  const { startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, handleError } = apiProcessor;
  
  const [state, dispatch] = useReducer(markingPageReducer, initialState);
  const { pageMode, selectedModel, showInfoDropdown, hoveredRating } = state;
  
  // Ref to prevent duplicate text message requests
  const textRequestInProgress = useRef(false);

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
    
    // Prevent duplicate calls for the same text
    if (textRequestInProgress.current) {
      return;
    }
    
    try {
      textRequestInProgress.current = true;
      startProcessing();
      // ============================================================================
      // CRITICAL: UNIQUE MESSAGE ID GENERATION FOR TEXT MODE
      // ============================================================================
      // 
      // IMPORTANT: This timestamp-based ID generation is ESSENTIAL and must NOT be changed!
      // 
      // Why this design is critical:
      // 1. PREVENTS DUPLICATE MESSAGE IDS: Users can send identical text multiple times
      //    (e.g., "2 + 2" and "2+2") and each must get a unique ID
      // 2. REACT KEY UNIQUENESS: React requires unique keys for list items to prevent
      //    rendering issues and performance problems
      // 3. CONSISTENT WITH IMAGE MODE: Image mode uses the same pattern for reliability
      // 4. BACKEND COMPATIBILITY: Backend expects unique IDs for each message
      // 
      // DO NOT CHANGE TO CONTENT-BASED HASHING:
      // - Content-based hashing causes duplicate IDs for identical content
      // - Same content + same timestamp = same ID = React key conflicts
      // - This was the root cause of the "duplicate children" React warnings
      // 
      // This simple approach guarantees uniqueness:
      // - Each message gets a unique timestamp
      // - No content dependency = no collision risk
      // - Works for identical content sent multiple times
      // ============================================================================
      await addMessage({
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmedText,
        timestamp: new Date().toISOString(),
        type: 'text'
      });
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      
      const textProgressData = {
        isComplete: false,
        currentStepDescription: 'AI is thinking...',
        allSteps: ['AI is thinking...'],
        currentStepIndex: 0,
      };
      
      // Generate a predictable AI message ID that backend can use
      const aiMessageId = createAIMessageId(trimmedText);
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
        } else if (data.aiMessage) {
          // For unauthenticated users, append only the AI message (user message already in frontend)
          await addMessage(data.aiMessage);
          
          // Update session title and ID in current session (for session header display only)
          // Don't update sidebar for unauthenticated users
          if (data.sessionTitle && data.sessionId) {
            // Get the most current session after addMessage
            const currentSessionAfterUpdate = simpleSessionService.getCurrentSession();
            if (currentSessionAfterUpdate) {
              // Extract processing stats from AI message for task details
              const processingStats = data.aiMessage?.processingStats || {};
              const sessionStats = {
                ...currentSessionAfterUpdate.sessionStats,
                lastModelUsed: processingStats.modelUsed || 'N/A',
                totalProcessingTimeMs: processingStats.processingTimeMs || 0,
                lastApiUsed: processingStats.apiUsed || 'N/A',
                totalLlmTokens: processingStats.llmTokens || 0,
                totalMathpixCalls: processingStats.mathpixCalls || 0,
                totalTokens: (processingStats.llmTokens || 0) + (processingStats.mathpixCalls || 0),
                averageConfidence: processingStats.confidence || 0,
                imageSize: processingStats.imageSize || 0,
                totalAnnotations: processingStats.annotations || 0
              };
              
              // For unauthenticated users: Only update title if it's the first AI response
              // Keep the original title from the first AI response, don't overwrite on follow-ups
              const shouldUpdateTitle = !currentSessionAfterUpdate.title || 
                                       currentSessionAfterUpdate.title === 'Processing...' ||
                                       currentSessionAfterUpdate.title === 'Chat Session';
              
              const updatedSession = { 
                ...currentSessionAfterUpdate, 
                title: shouldUpdateTitle ? data.sessionTitle : currentSessionAfterUpdate.title,
                id: data.sessionId, // Use backend's permanent session ID (no fallback to temp ID)
                sessionStats: sessionStats,
                updatedAt: new Date().toISOString() // Add last updated time
              };
              simpleSessionService.updateCurrentSessionOnly(updatedSession);
            }
          }
        } else {
          throw new Error(data.error || 'No session data received');
        }
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }
      
      // Reset the request flag and processing state on success
      textRequestInProgress.current = false;
      stopProcessing();
    } catch (err) {
      handleError(err);
      // Stop state only if the initial fetch fails. The service handles success.
      stopAIThinking();
      stopProcessing();
      // Reset the request flag on error
      textRequestInProgress.current = false;
    }
  }, [getAuthToken, currentSession, addMessage, startAIThinking, stopAIThinking, stopProcessing, handleError]);
  
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
      const imageAiMessageId = createAIMessageId(imageData);
      
      const imageProgressData = {
        isComplete: false,
        currentStepDescription: 'Analyzing image...',
        allSteps: ['Analyzing image...'],
        currentStepIndex: 0,
      };
      
      startAIThinking(imageProgressData, imageAiMessageId);
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
    handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating, onFavoriteToggle, onRatingChange, onTitleUpdate,
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
    onFavoriteToggle, onRatingChange, onTitleUpdate, setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
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

