import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { simpleSessionService } from '../services/markingApiService';
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
  const { startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, processMultiImageAPI, handleError } = apiProcessor;
  
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
        // Use the new standardized completion handler
        simpleSessionService.handleTextChatComplete(data, 'auto');
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }
      
      // Reset the request flag on success
      textRequestInProgress.current = false;
    } catch (err) {
      handleError(err);
      // Stop state only if the initial fetch fails. The service handles success.
      stopAIThinking();
      stopProcessing();
      // Reset the request flag on error
      textRequestInProgress.current = false;
    }
  }, [getAuthToken, currentSession, addMessage, startAIThinking, stopAIThinking, stopProcessing, handleError, startProcessing]);
  
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
      await processImageAPI(imageData, selectedModel, 'marking', customText || undefined, imageAiMessageId, targetFile.name);
      clearFile();
    } catch (err) {
      console.error('Error in image analysis flow:', err);
      handleError(err);
      // Also stop states on initial error. The service handles success.
      stopAIThinking();
      stopProcessing();
    }
  }, [selectedFile, selectedModel, processImage, addMessage, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, clearFile, handleError]);

  const handleMultiImageAnalysis = useCallback(async (files = [], customText = null) => {
    if (!files || files.length === 0) return;
    try {
      startProcessing();
      
      // Process files to get image data for display
      const processImage = async (file) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      };
      
      const imageDataArray = await Promise.all(files.map(processImage));
      
      // Create optimistic message for multi-image upload with actual image data
      const optimisticMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: customText || `I have uploaded ${files.length} image(s) for analysis.`,
        timestamp: new Date().toISOString(),
        imageData: imageDataArray[0], // Show first image as primary
        imageDataArray: imageDataArray, // Store all images
        fileName: files.length === 1 ? files[0].name : `${files.length} files`,
        isMultiImage: true,
        fileCount: files.length,
        originalFiles: files.map(f => ({ name: f.name, type: f.type }))
      };
      await addMessage(optimisticMessage);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      
      // Generate unique AI message ID for multi-image processing
      const multiImageAiMessageId = createAIMessageId(`multi-${Date.now()}`);
      
      const multiImageProgressData = {
        isComplete: false,
        currentStepDescription: `Processing ${files.length} image(s)...`,
        allSteps: [
          'Input Validation',
          'Standardization', 
          'Preprocessing',
          'OCR & Classification',
          'Segmentation',
          'Marking',
          'Output Generation'
        ],
        currentStepIndex: 0,
      };
      
      startAIThinking(multiImageProgressData, multiImageAiMessageId);
      await processMultiImageAPI(files, selectedModel, 'marking', customText || undefined, multiImageAiMessageId);
    } catch (err) {
      console.error('Error in multi-image analysis flow:', err);
      handleError(err);
      stopAIThinking();
      stopProcessing();
    }
  }, [selectedModel, addMessage, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processMultiImageAPI, handleError]);
  
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
    onSendMessage, addMessage,
    chatContainerRef,
    scrollToBottom, 
    showScrollButton, 
    hasNewResponse, 
    scrollToNewResponse,
    onFollowUpImage: handleImageAnalysis,
    onAnalyzeMultiImage: handleMultiImageAnalysis,
    onFollowUpMultiImage: handleMultiImageAnalysis,
    getImageSrc,
    startAIThinking,
    ...progressProps
  }), [
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating, handleFileSelect, clearFile,
    handleModelChange, handleImageAnalysis, handleMultiImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating,
    onFavoriteToggle, onRatingChange, onTitleUpdate, setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    onSendMessage, addMessage, chatContainerRef, scrollToBottom, showScrollButton, hasNewResponse, scrollToNewResponse, progressProps, getImageSrc, startAIThinking
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

