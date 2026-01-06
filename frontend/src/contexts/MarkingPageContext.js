import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { simpleSessionService } from '../services/markingApiService';
import apiClient from '../services/apiClient';
import { useScrollManager } from '../hooks/useScrollManager';
import { createAIMessageId } from '../utils/messageUtils.js';
import { STORAGE_KEYS, AI_MODELS } from '../utils/constants.js';
import { getSessionImages } from '../utils/imageCollectionUtils';
import { useCredits } from '../hooks/useCredits';
import InsufficientCreditsModal from '../components/common/InsufficientCreditsModal';

const MarkingPageContext = createContext();

// Helper function to get saved model from localStorage with validation
const getSavedModel = () => {
  try {
    const savedModel = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL);
    // Validate that saved model is one of the allowed models
    const validModels = [
      AI_MODELS.GEMINI_2_0_FLASH,
      AI_MODELS.GEMINI_2_5_FLASH,
      AI_MODELS.GEMINI_2_5_PRO,
      AI_MODELS.GEMINI_3_FLASH_PREVIEW,
      AI_MODELS.OPENAI_GPT_4O
    ];
    if (savedModel && validModels.includes(savedModel)) {
      return savedModel;
    }
  } catch (error) {
    // localStorage might not be available (e.g., private browsing)
    console.warn('Failed to read selected model from localStorage:', error);
  }
  return AI_MODELS.GEMINI_2_0_FLASH; // Default to Gemini 2.0 Flash (cheapest, latest)
};

const initialState = {
  pageMode: 'upload',
  selectedModel: getSavedModel(),
  showInfoDropdown: false,
  hoveredRating: 0,
  splitModeImages: null,
  activeImageIndex: 0,
  activeQuestionId: null,
  visibleTableIds: new Set(),
  isQuestionTableVisible: true,
  isContextFilterActive: false,
  isGlobalSplit: true,
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
    case 'ENTER_SPLIT_MODE':

      return {
        ...state,
        splitModeImages: action.payload.images,
        activeImageIndex: action.payload.index || 0,
        isGlobalSplit: action.payload.isGlobal ?? true
      };
    case 'PREPARE_SPLIT_TRANSITION':
      return { ...state, splitModeImages: [], activeImageIndex: 0 };
    case 'EXIT_SPLIT_MODE':

      return { ...state, splitModeImages: null, activeImageIndex: 0 };
    case 'SET_ACTIVE_IMAGE_INDEX':
      if (state.activeImageIndex === action.payload) return state;
      return { ...state, activeImageIndex: action.payload };
    case 'SET_ACTIVE_QUESTION_ID':
      if (state.activeQuestionId === action.payload) return state;
      return { ...state, activeQuestionId: action.payload };
    case 'SET_TABLE_VISIBILITY':
      const newSet = new Set(state.visibleTableIds);
      if (action.payload.visible) {
        newSet.add(action.payload.id);
      } else {
        newSet.delete(action.payload.id);
      }
      return {
        ...state,
        visibleTableIds: newSet,
        isQuestionTableVisible: newSet.size > 0
      };
    case 'SET_CONTEXT_FILTER_ACTIVE':
      if (state.isContextFilterActive === action.payload) return state;
      return { ...state, isContextFilterActive: action.payload };
    default:
      throw new Error(`Unhandled action type: ${action.type}`);
  }
}

export const MarkingPageProvider = ({
  children,
  selectedMarkingResult,
  onPageModeChange,
  onProcessingChange,
  setSidebarOpen,
  autoSplit = false,
  initialImageIndex = 0
}) => {
  const { user, getAuthToken } = useAuth();
  const { selectedFile, processImage, clearFile, handleFileSelect } = useImageUpload();

  const {
    currentSession, chatMessages, sessionTitle, isFavorite, rating,
    addMessage, clearSession, loadSession, onFavoriteToggle, onRatingChange, onTitleUpdate
  } = useSessionManager();

  const { credits, isNegative, refreshCredits } = useCredits();
  const [showCreditsModal, setShowCreditsModal] = React.useState(false);

  const apiProcessor = useApiProcessor();
  const { isProcessing, isAIThinking, error } = apiProcessor;
  const { startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, processMultiImageAPI, handleError } = apiProcessor;

  const progressProps = useMemo(() => {
    const {
      loadingProgress, loadingStep, loadingTotalSteps, loadingMessage,
      showProgressDetails, progressData, stepList, currentStepIndex, updateProgress, setShowProgressDetails
    } = apiProcessor;
    return {
      loadingProgress, loadingStep, loadingTotalSteps, loadingMessage,
      showProgressDetails, progressData, stepList, currentStepIndex, updateProgress, setShowProgressDetails
    };
  }, [apiProcessor]);

  const [state, dispatch] = useReducer(markingPageReducer, initialState);
  const { pageMode, selectedModel, showInfoDropdown, hoveredRating, splitModeImages, activeImageIndex, activeQuestionId, isQuestionTableVisible, isContextFilterActive, isGlobalSplit } = state;

  const lastSyncedSessionId = useRef(null);

  // Load session when selectedMarkingResult prop changes (e.g., from Sidebar history click)
  useEffect(() => {
    if (selectedMarkingResult) {
      // If we are currently in split mode, keep it open but clear the images
      if (state.splitModeImages) {
        dispatch({ type: 'PREPARE_SPLIT_TRANSITION' });
      } else {
        dispatch({ type: 'EXIT_SPLIT_MODE' });
      }
      lastSyncedSessionId.current = null;

      loadSession(selectedMarkingResult);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
    } else {
      clearSession();
      dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      dispatch({ type: 'EXIT_SPLIT_MODE' });
    }
  }, [selectedMarkingResult, loadSession, clearSession]);

  // Auto-sync split mode images when session changes (persistent split mode)
  useEffect(() => {
    if (!currentSession) {
      lastSyncedSessionId.current = null;
      return;
    }

    if (splitModeImages) {
      const newImages = getSessionImages(currentSession);
      const sessionChanged = currentSession.id !== lastSyncedSessionId.current;

      if (sessionChanged) {
        if (newImages && newImages.length > 0) {
          dispatch({
            type: 'ENTER_SPLIT_MODE',
            payload: { images: newImages, index: 0, isGlobal: true }
          });
          lastSyncedSessionId.current = currentSession.id;
        } else {
          dispatch({ type: 'EXIT_SPLIT_MODE' });
          lastSyncedSessionId.current = currentSession.id;
        }
        return;
      }

      // If same session but we are in GLOBAL split mode, sync with any NEW images (e.g. from more marking)
      if (isGlobalSplit && newImages && newImages.length > 0) {
        const hasAnnotatedNew = newImages.some(img => img.filename?.startsWith('annotated-'));
        const hasAnnotatedPrev = splitModeImages.some(img => img.filename?.startsWith('annotated-'));

        // JUMP TO INDEX 0 IF:
        // 1. Image set changed AND
        // 2. We previously had NO annotated images but now we DO
        const shouldJumpToResults = hasAnnotatedNew && !hasAnnotatedPrev;

        if (newImages[0]?.id !== splitModeImages[0]?.id || newImages.length !== splitModeImages.length || shouldJumpToResults) {
          dispatch({
            type: 'ENTER_SPLIT_MODE',
            payload: {
              images: newImages,
              index: shouldJumpToResults ? 0 : (activeImageIndex || 0),
              isGlobal: true
            }
          });
        }
      }
    }
  }, [currentSession?.id, splitModeImages?.[0]?.id, splitModeImages?.length, isGlobalSplit, currentSession]);

  // Listen for model changes from Settings (or other tabs)
  useEffect(() => {
    const handleModelSync = (event) => {
      const newModel = event.detail;
      if (newModel && newModel !== selectedModel) {
        dispatch({ type: 'SET_SELECTED_MODEL', payload: newModel });
      }
    };

    window.addEventListener('modelChanged', handleModelSync);
    return () => {
      window.removeEventListener('modelChanged', handleModelSync);
    };
  }, [selectedModel]);

  // Auto-enter split mode if requested via prop
  useEffect(() => {
    if (autoSplit && currentSession && selectedMarkingResult && currentSession.id === selectedMarkingResult.id) {
      const images = getSessionImages(currentSession);
      if (images && images.length > 0) {

        // Ensure index is valid
        const validIndex = initialImageIndex >= 0 && initialImageIndex < images.length
          ? initialImageIndex
          : 0;

        dispatch({
          type: 'ENTER_SPLIT_MODE',
          payload: { images, index: validIndex, isGlobal: true }
        });

        // Also ensure page mode is chat so we see the results
        dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      }
    }
  }, [autoSplit, selectedMarkingResult, currentSession, initialImageIndex]);

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

  useEffect(() => {
    if (onProcessingChange) {
      onProcessingChange(isProcessing);
    }
  }, [isProcessing, onProcessingChange]);

  const onSendMessage = useCallback(async (text) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Prevent duplicate calls for the same text
    if (textRequestInProgress.current) {
      return;
    }

    // --- CREDIT ENFORCEMENT ---
    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

    const extractQuestionNumber = (text) => {
      const match = text.match(/(?:question|q)\s*(\d+)/i);
      return match ? match[1] : null;
    };

    try {
      textRequestInProgress.current = true;
      startProcessing();

      const explicitQuestionId = extractQuestionNumber(trimmedText);
      const effectiveQuestionId = explicitQuestionId || activeQuestionId;

      // If user explicitly mentioned a question, update the focus automatically
      if (explicitQuestionId && explicitQuestionId !== activeQuestionId) {
        setActiveQuestionId(explicitQuestionId);
      }

      const userMessageId = `user-${Date.now()}`;
      await addMessage({
        id: userMessageId,
        role: 'user',
        content: trimmedText,
        timestamp: new Date().toISOString(),
        type: 'text',
        contextQuestionId: effectiveQuestionId
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
      startAIThinking(textProgressData, aiMessageId, []); // For text messages, imageDataArray is empty

      // --- NEW: Context Chat Support for Guests ---
      // If the user is unauthenticated, the backend won't have the session context in DB.
      // We send the marking context from the latest AI message in the frontend state.
      let guestMarkingContext = null;
      if (!user && currentSession?.messages) {
        const lastMarkingMessage = [...currentSession.messages].reverse().find(msg => msg.markingContext);
        if (lastMarkingMessage) {
          guestMarkingContext = lastMarkingMessage.markingContext;
        }
      }

      const response = await apiClient.post('/api/messages/chat', {
        message: trimmedText,
        messageId: userMessageId, // Pass the local user message ID to backend
        model: selectedModel || 'gemini-2.0-flash',
        sessionId: currentSession?.id || null,
        markingContext: guestMarkingContext, // Send context for guest users
        aiMessageId: aiMessageId, // Pass the AI message ID to backend
        contextQuestionId: effectiveQuestionId // Pass the active or overridden context
      });

      const data = response.data;

      if (data.success) {
        // Use the new standardized completion handler
        simpleSessionService.handleTextChatComplete(data, selectedModel || 'gemini-2.0-flash');
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }

      // Reset the request flag on success
      textRequestInProgress.current = false;
      return true;
    } catch (err) {
      if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
        setShowCreditsModal(true);
      }
      handleError(err);
      // Stop state only if the initial fetch fails. The service handles success.
      stopAIThinking();
      stopProcessing();
      // Reset the request flag on error
      textRequestInProgress.current = false;
      return false;
    }
  }, [user, isNegative, getAuthToken, currentSession, selectedModel, addMessage, startAIThinking, stopAIThinking, stopProcessing, handleError, startProcessing]);

  useEffect(() => {
    if (selectedMarkingResult) {
      loadSession(selectedMarkingResult);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
    } else {
      clearSession();
      dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      dispatch({ type: 'EXIT_SPLIT_MODE' });
    }
  }, [selectedMarkingResult, loadSession, clearSession]);

  // Ref to track the last handled session ID to prevent redundant scrolls on every message update
  const lastHandledSessionIdRef = useRef(null);

  useEffect(() => {
    if (selectedMarkingResult && currentSession?.id === selectedMarkingResult.id) {
      // Only trigger this "restore position" logic when the session ID actually changes (initial load)
      // OR if it's the very first time we see this session.
      if (lastHandledSessionIdRef.current === currentSession.id) {
        return;
      }
      lastHandledSessionIdRef.current = currentSession.id;

      const timeoutId = setTimeout(() => {
        const lastUserMessage = [...(currentSession.messages || [])].reverse().find(m => m.role === 'user');
        if (lastUserMessage) {
          // Align with new UX: Scroll to TOP to show dynamic spacer if present
          scrollToMessage(lastUserMessage.id, { behavior: 'smooth', block: 'start' });
        } else {
          scrollToBottom();
        }
      }, 150);
      return () => clearTimeout(timeoutId);
    }
  }, [currentSession?.id, selectedMarkingResult, scrollToMessage, scrollToBottom]);

  const handleImageAnalysis = useCallback(async (file = null, customText = null) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return;

    // --- CREDIT ENFORCEMENT ---
    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

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
        contextQuestionId: activeQuestionId
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

      startAIThinking(imageProgressData, imageAiMessageId, [imageData]);

      // Execute API call in background so UI resets immediately
      processImageAPI(imageData, selectedModel, 'marking', customText || undefined, imageAiMessageId, targetFile.name)
        .catch(err => {
          console.error('Error in image analysis flow:', err);
          if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
            setShowCreditsModal(true);
          }
          handleError(err);
          stopAIThinking();
          stopProcessing();
        });

      clearFile();
      return true;
    } catch (err) {
      console.error('Error starting image analysis:', err);
      if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
        setShowCreditsModal(true);
      }
      handleError(err);
      stopAIThinking();
      stopProcessing();
      return false;
    }
  }, [user, isNegative, selectedFile, selectedModel, processImage, addMessage, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, clearFile, handleError]);

  const handleMultiImageAnalysis = useCallback(async (files = [], customText = null) => {
    if (!files || files.length === 0) return;

    // --- CREDIT ENFORCEMENT ---
    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

    try {
      startProcessing();

      // Check if any files are PDFs
      const hasPDFs = files.some(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));

      let optimisticMessage;

      if (hasPDFs) {
        // For PDFs, create message with PDF context instead of image data
        // Convert each PDF file to base64 and create blob URL for immediate display
        const convertPdfToBlobUrl = async (file) => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              try {
                const base64DataUrl = e.target.result;
                // Convert base64 data URL to Blob URL to avoid browser length limits
                const base64String = base64DataUrl.split(',')[1];
                const byteCharacters = atob(base64String);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'application/pdf' });
                const blobUrl = URL.createObjectURL(blob);
                resolve({ base64DataUrl, blobUrl });
              } catch (error) {
                reject(error);
              }
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        };

        const pdfContexts = await Promise.all(files.map(async (file) => {
          const { blobUrl } = await convertPdfToBlobUrl(file);

          return {
            originalFileName: file.name,
            fileSize: file.size, // Use bytes (number) to match imageDataArray structure
            url: blobUrl // Use simplified structure: url field only
          };
        }));

        optimisticMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: customText || `I have uploaded ${files.length} file(s) for analysis.`,
          timestamp: new Date().toISOString(),
          originalFileType: 'pdf',
          pdfContexts: pdfContexts,
          // NO fileName for PDFs - use pdfContexts instead
          isMultiImage: false, // Don't treat PDFs as multi-image
          fileCount: files.length,
          originalFiles: files.map(f => ({ name: f.name, type: f.type }))
        };
      } else {
        // For images, process as before
        const processImage = async (file) => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        };

        const imageDataArray = await Promise.all(files.map(processImage));

        optimisticMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: customText || `I have uploaded ${files.length} image(s) for analysis.`,
          timestamp: new Date().toISOString(),
          imageData: imageDataArray[0], // Show first image as primary
          imageDataArray: imageDataArray, // Store all images
          fileName: files.length === 1 ? files[0].name : files.map(f => f.name).join(', '),
          isMultiImage: true,
          fileCount: files.length,
          originalFiles: files.map(f => ({ name: f.name, type: f.type }))
        };
      }
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
          'Mapping',
          'Bucket Allocation',
          'Classification',
          'OCR',
          'Question Detection',
          'Marking',
          'Output Generation'
        ],
        currentStepIndex: 0,
      };

      const thinkingImages = hasPDFs ? optimisticMessage.pdfContexts : optimisticMessage.imageDataArray;
      startAIThinking(multiImageProgressData, multiImageAiMessageId, thinkingImages);

      // Execute API call in background so UI resets immediately
      processMultiImageAPI(files, selectedModel, 'marking', customText || undefined, multiImageAiMessageId)
        .catch(err => {
          console.error('Error in multi-image analysis flow:', err);
          if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
            setShowCreditsModal(true);
          }
          handleError(err);
          stopAIThinking();
          stopProcessing();
        });

      return true;
    } catch (err) {
      console.error('Error in multi-image analysis flow:', err);
      if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
        setShowCreditsModal(true);
      }
      handleError(err);
      stopAIThinking();
      stopProcessing();
      return false;
    }
  }, [user, isNegative, selectedModel, addMessage, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processMultiImageAPI, handleError]);

  const getImageSrc = useCallback((message) => {
    if (message?.imageData) return message.imageData;
    if (message?.imageLink) return message.imageLink;
    return null;
  }, []);

  const handleModelChange = useCallback((model) => {
    // Save to localStorage
    try {
      localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, model);
    } catch (error) {
      // localStorage might not be available (e.g., private browsing)
      console.warn('Failed to save selected model to localStorage:', error);
    }
    // Update state
    dispatch({ type: 'SET_SELECTED_MODEL', payload: model });
  }, []);
  const onToggleInfoDropdown = useCallback(() => dispatch({ type: 'TOGGLE_INFO_DROPDOWN' }), []);
  const setHoveredRating = useCallback((rating) => dispatch({ type: 'SET_HOVERED_RATING', payload: rating }), []);

  const enterSplitMode = useCallback((images, index = 0, isGlobal = true) => {
    dispatch({ type: 'ENTER_SPLIT_MODE', payload: { images, index, isGlobal } });
    // Auto-collapse sidebar to mini mode (72px) - DISABLED by user request
    // if (setSidebarOpen) {
    //   setSidebarOpen(false); // Collapsed = false in your Sidebar logic
    // }
  }, [setSidebarOpen]);

  const exitSplitMode = useCallback(() => {
    dispatch({ type: 'EXIT_SPLIT_MODE' });
  }, []);

  const setActiveImageIndex = useCallback((index) => {
    dispatch({ type: 'SET_ACTIVE_IMAGE_INDEX', payload: index });
  }, []);

  const setActiveQuestionId = useCallback((questionId) => {
    dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: questionId });
  }, []);

  const setQuestionTableVisibility = useCallback((id, isVisible) => {
    dispatch({ type: 'SET_TABLE_VISIBILITY', payload: { id, visible: isVisible } });
  }, []);

  const setContextFilterActive = useCallback((isActive) => {
    dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: isActive });
  }, []);

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
    scrollToMessage,
    onFollowUpImage: handleImageAnalysis,
    onAnalyzeMultiImage: handleMultiImageAnalysis,
    onFollowUpMultiImage: handleMultiImageAnalysis,
    getImageSrc,
    startAIThinking,
    splitModeImages, activeImageIndex, enterSplitMode, exitSplitMode, setActiveImageIndex,
    activeQuestionId, setActiveQuestionId,
    isQuestionTableVisible, setQuestionTableVisibility,
    isContextFilterActive, setContextFilterActive,
    visibleTableIds: state.visibleTableIds,
    isNegative,
    setShowCreditsModal,
    ...progressProps
  }), [
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating, handleFileSelect, clearFile,
    handleModelChange, handleImageAnalysis, handleMultiImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating,
    onFavoriteToggle, onRatingChange, onTitleUpdate, setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    onSendMessage, addMessage, chatContainerRef, scrollToBottom, showScrollButton, hasNewResponse, scrollToNewResponse, scrollToMessage, progressProps, getImageSrc, startAIThinking,
    splitModeImages, activeImageIndex, enterSplitMode, exitSplitMode, setActiveImageIndex,
    activeQuestionId, setActiveQuestionId, isQuestionTableVisible, setQuestionTableVisibility,
    isContextFilterActive, setContextFilterActive,
    state.visibleTableIds,
    isNegative,
    setShowCreditsModal
  ]);

  return (
    <MarkingPageContext.Provider value={value}>
      {children}
      <InsufficientCreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
        remainingCredits={credits?.remainingCredits ?? 0}
      />
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

