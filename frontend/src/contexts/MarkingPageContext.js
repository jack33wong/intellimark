import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { simpleSessionService } from '../services/markingApiService';
import apiClient from '../services/apiClient';
import { useScrollManager } from '../hooks/useScrollManager';
import { createAIMessageId } from '../utils/messageUtils.js';
import { STORAGE_KEYS } from '../utils/constants.js';
import { getSessionImages } from '../utils/imageCollectionUtils';
import { useCredits } from '../hooks/useCredits';
import InsufficientCreditsModal from '../components/common/InsufficientCreditsModal';
import { useModels } from './ModelContext';
import GuestLimitModal from '../components/modals/GuestLimitModal';
import { trackFunnelEvent } from '../utils/funnelTracker';

// --- INDEXEDDB AUTH STASH HELPERS ---
const STASH_DB_NAME = 'IntelliMarkStashDB';
const STASH_STORE = 'pendingUploads';

const initStashDB = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(STASH_DB_NAME, 1);
  request.onupgradeneeded = (e) => e.target.result.createObjectStore(STASH_STORE);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const stashUploadData = async (data) => {
  const db = await initStashDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STASH_STORE, 'readwrite');
    tx.objectStore(STASH_STORE).put(data, 'authStash');
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
};

const retrieveAndClearStash = async () => {
  const db = await initStashDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STASH_STORE, 'readwrite');
    const store = tx.objectStore(STASH_STORE);
    const request = store.get('authStash');
    request.onsuccess = () => {
      store.delete('authStash'); // Clear immediately so it only fires once
      resolve(request.result);
    };
    request.onerror = reject;
  });
};

const MarkingPageContext = createContext();

const getSavedModel = () => {
  try {
    return localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL) || 'fast';
  } catch (error) {
    return 'fast';
  }
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

// Helper to normalize Guest Limit errors across Fetch SSE streams and Axios 403 responses
const extractGuestLimitError = (err) => {
  const data = err?.response?.data || err || {};
  const isGuestLimit = Boolean(
    err?.details === 'guest_limit_reached' ||
    err?.guest_limit_reached ||
    data?.details === 'guest_limit_reached' ||
    data?.guest_limit_reached ||
    data?.limit_reached ||
    (err?.response?.status === 403 && (data?.error || '').toLowerCase().includes('limit'))
  );

  return {
    isGuestLimit,
    usageCount: data.usageCount ?? err?.usageCount ?? 0,
    usageLimit: data.usageLimit ?? err?.usageLimit ?? 0,
    resetAt: data.resetAt ?? err?.resetAt ?? null,
  };
};

// Helper to check if a session has at least one completed AI response
const hasCompletedAITurn = (session) => {
  if (!session || !Array.isArray(session.messages)) return false;
  return session.messages.some(m => m.role === 'assistant' && !m.isProcessing);
};

export const MarkingPageProvider = ({
  children,
  selectedMarkingResult,
  isHistoryLoading = false,
  onPageModeChange,
  onProcessingChange,
  setSidebarOpen,
  autoSplit = false,
  initialImageIndex = 0
}) => {
  const { user, loading: authLoading, getAuthToken } = useAuth();
  const pendingUploadRef = useRef(null);
  const { selectedFile, processImage, clearFile, handleFileSelect } = useImageUpload();

  const {
    currentSession, chatMessages, sessionTitle, isFavorite, rating,
    addMessage, clearSession, loadSession, onFavoriteToggle, onRatingChange, onTitleUpdate
  } = useSessionManager();

  const { credits, isNegative, refreshCredits } = useCredits();
  const [showCreditsModal, setShowCreditsModal] = React.useState(false);
  const [showGuestLimitModal, setShowGuestLimitModal] = React.useState(false);
  const [guestLimitInfo, setGuestLimitInfo] = React.useState({ usageCount: 0, usageLimit: 0, resetAt: null });
  const [isModelAnswerMode, setIsModelAnswerMode] = React.useState(false);
  const [isMarkingSchemeMode, setIsMarkingSchemeMode] = React.useState(false);
  const [initialInput, setInitialInput] = React.useState('');
  const [showModelAnswerConfirmation, setShowModelAnswerConfirmation] = React.useState(false);
  const [pendingModelAnswerPaper, setPendingModelAnswerPaper] = React.useState(null);

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

  const { models, defaultModel: dynamicDefaultModel, isLoading: isModelsLoading } = useModels();

  const [state, dispatch] = useReducer(markingPageReducer, undefined, () => ({
    ...initialState,
    selectedModel: getSavedModel(),
    visibleTableIds: new Set(),
  }));
  const { pageMode, selectedModel, showInfoDropdown, hoveredRating, splitModeImages, activeImageIndex, activeQuestionId, isQuestionTableVisible, isContextFilterActive, isGlobalSplit } = state;

  // Validate saved model once dynamic models are loaded
  useEffect(() => {
    if (!isModelsLoading && models.length > 0) {
      const savedModel = localStorage.getItem(STORAGE_KEYS.SELECTED_MODEL);
      if (!savedModel || !models.find(m => m.id === savedModel)) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_MODEL, dynamicDefaultModel);
        dispatch({ type: 'SET_SELECTED_MODEL', payload: dynamicDefaultModel });
      }
    }
  }, [isModelsLoading, models, dynamicDefaultModel]);

  const lastSyncedSessionId = useRef(null);
  const lastSyncedModeSessionId = useRef(null);
  const userClosedSplitSessionIdRef = useRef(null);

  // Load session when selectedMarkingResult prop changes (e.g., from Sidebar history click)
  useEffect(() => {
    if (selectedMarkingResult) {
      userClosedSplitSessionIdRef.current = null;
      const images = getSessionImages(selectedMarkingResult);
      if (images && images.length > 0) {
        const isMobile = window.innerWidth <= 768;
        // Match MainLayout logic: check messages if session mode is undefined
        const isQuestionMode = selectedMarkingResult.mode === 'Question' || 
                               selectedMarkingResult.mode === 'Question Mode' ||
                               (selectedMarkingResult.messages || []).some(m => m.type === 'question_response');
        
        // Only auto-split on desktop if NOT in Question Mode
        if (!isMobile && !isQuestionMode) {
          dispatch({
            type: 'ENTER_SPLIT_MODE',
            payload: { images: images, index: 0, isGlobal: true }
          });
        } else {
          dispatch({ type: 'EXIT_SPLIT_MODE' });
        }
        // Sync the ref now so the second useEffect knows we've already handled THIS session
        lastSyncedSessionId.current = selectedMarkingResult.id;
      } else {
        dispatch({ type: 'EXIT_SPLIT_MODE' });
        lastSyncedSessionId.current = null;
      }

      loadSession(selectedMarkingResult);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
    } else {
      clearSession();
      dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      dispatch({ type: 'EXIT_SPLIT_MODE' });
      lastSyncedSessionId.current = null;
    }
  }, [selectedMarkingResult, loadSession, clearSession]);

  // Sync specialized mode flags based on session usageMode or chat content (to hide ribbon in history)
  // ONLY run on initial session load to avoid overwriting manual toggles
  useEffect(() => {

    if (!currentSession) {
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
      lastSyncedModeSessionId.current = null;
      return;
    }

    // Only sync if this is a fresh session load (independent of split mode ref)
    if (currentSession.id === lastSyncedModeSessionId.current) {
      return;
    }

    // 1. PRIORITY: Explicit usageMode from session level
    const usageMode = currentSession.usageMode?.toLowerCase();

    if (usageMode === 'model-answer') {
      setIsModelAnswerMode(true);
      setIsMarkingSchemeMode(false);
      lastSyncedModeSessionId.current = currentSession.id;
      return;
    } else if (usageMode === 'marking-scheme' || usageMode === 'markingscheme') {
      setIsMarkingSchemeMode(true);
      setIsModelAnswerMode(false);
      lastSyncedModeSessionId.current = currentSession.id;
      return;
    } else if (usageMode === 'marking') {
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
      lastSyncedModeSessionId.current = currentSession.id;
      return;
    }

    // 2. FALLBACK: Content signatures if usageMode is missing (legacy sessions)
    // Only proceed if we have messages to look at - otherwise wait for full session load
    if (chatMessages && chatMessages.length > 0) {
      // GUARD: If any message is still processing (AI spinner), content is not ready yet.
      // Don't run content-signature check until all messages are settled - prevents premature mode reset.
      const isAIProcessing = chatMessages.some(m => m.isProcessing);
      if (isAIProcessing) {
        return; // Do NOT mark as synced - allow re-run when content arrives
      }


      // Is it a regular marking session? (Ribbon should stay)
      // IMPORTANT: Exclude sessions that were generated by model-answer flow (session-model-* prefix)
      const isModelAnswerSession = currentSession.id?.startsWith('session-model-');
      const hasMarkingContext = !isModelAnswerSession && (
        currentSession.markingContext ||
        (currentSession.messageType === 'Marking') ||
        chatMessages.some(m => (m.markingContext || m.isMarkingResult))
      );

      if (hasMarkingContext) {
        if (selectedMarkingResult) {
          setIsModelAnswerMode(false);
          setIsMarkingSchemeMode(false);
        }
        lastSyncedModeSessionId.current = currentSession.id;
        return;
      }

      const hasModelAnswer = chatMessages.some(m =>
        m.content && (
          m.content.includes('class="model_answer"') ||
          m.content.includes('class="model_question"') ||
          m.content.includes('class="model-answer-block"')
        )
      );

      const hasMarkingScheme = chatMessages.some(m =>
        m.content && (
          m.content.includes('class="step-title"') ||
          m.content.includes('class="step-explanation"')
        )
      );


      if (hasModelAnswer || isModelAnswerSession) {
        setIsModelAnswerMode(true);
        setIsMarkingSchemeMode(false);
      } else if (hasMarkingScheme) {
        setIsMarkingSchemeMode(true);
        setIsModelAnswerMode(false);
      } else {
        // No specialized content found in messages either
        setIsModelAnswerMode(false);
        setIsMarkingSchemeMode(false);
      }

      // Mark this session as synced now that we've checked the messages
      lastSyncedModeSessionId.current = currentSession.id;
    } else {
    }
    // If no usageMode AND no messages yet, we DO NOT set the ref, 
    // allowing it to re-run when chatMessages arrive.
  }, [currentSession, chatMessages, selectedMarkingResult]);

  // Auto-sync split mode images when session changes (persistent split mode)
  useEffect(() => {
    if (!currentSession) {
      lastSyncedSessionId.current = null;
      return;
    }

    const newImages = getSessionImages(currentSession);
    const sessionChanged = currentSession.id !== lastSyncedSessionId.current;

    // SAFETY: If we are in the middle of a history transition, don't revert to old session data
    if (sessionChanged && selectedMarkingResult && currentSession.id !== selectedMarkingResult.id) {
      return;
    }

    const isMobile = window.innerWidth <= 768;
    
    const currentMode = (currentSession.mode || '').toLowerCase();
    const isQuestionMode = currentMode === 'question' || 
                           currentMode === 'question mode' ||
                           (currentSession.messages || []).some(m => m.type === 'question_response');
    
    // 🌟 SIMPLIFIED FIX: Detect any active processing
    const isActivelyProcessing = isProcessing || isAIThinking;

    const isUserClosed = userClosedSplitSessionIdRef.current === currentSession.id;

    // We ONLY auto-open if we are NOT on mobile, NOT in Question Mode, NOT currently processing, and NOT manually closed by the user
    const shouldAutoOpen = !isMobile && !isQuestionMode && !isActivelyProcessing && !isUserClosed && newImages && newImages.length > 0;

    if (sessionChanged) {
      const wasTempSession = lastSyncedSessionId.current?.startsWith('temp-');
      if (!wasTempSession) {
        userClosedSplitSessionIdRef.current = null;
      } else if (userClosedSplitSessionIdRef.current === lastSyncedSessionId.current || userClosedSplitSessionIdRef.current === 'active') {
        // Carry over the user's manual close decision from temp- ID to the permanent ID
        userClosedSplitSessionIdRef.current = currentSession.id;
      }
      const isUserClosedNew = userClosedSplitSessionIdRef.current === currentSession.id;
      const shouldAutoOpenNewSession = !isMobile && !isQuestionMode && !isActivelyProcessing && !isUserClosedNew && newImages && newImages.length > 0;
      if (shouldAutoOpenNewSession) {
        dispatch({
          type: 'ENTER_SPLIT_MODE',
          payload: { images: newImages, index: 0, isGlobal: true }
        });
      } else if (splitModeImages && (!newImages || newImages.length === 0 || isQuestionMode || isActivelyProcessing || isUserClosedNew)) {
        dispatch({ type: 'EXIT_SPLIT_MODE' });
      }
      
      if (!isActivelyProcessing) {
        lastSyncedSessionId.current = currentSession.id;
      }
      return;
    }

    if (newImages && newImages.length > 0) {
      if ((!splitModeImages || splitModeImages.length === 0) && shouldAutoOpen) {
        dispatch({
          type: 'ENTER_SPLIT_MODE',
          payload: { images: newImages, index: 0, isGlobal: true }
        });
        lastSyncedSessionId.current = currentSession.id;
        return;
      }

      // 2. If we shouldn't auto-open but the panel is globally forced open, close it.
      // (We check isGlobalSplit to ensure we don't close a modal the user manually clicked open)
      if (splitModeImages && splitModeImages.length > 0 && !shouldAutoOpen && isGlobalSplit) {
         dispatch({ type: 'EXIT_SPLIT_MODE' });
         return;
      }

      // 3. Sync image sets if already open and valid
      if (splitModeImages && splitModeImages.length > 0 && isGlobalSplit && !isQuestionMode && !isActivelyProcessing) {
        const hasAnnotatedNew = newImages.some(img => img.filename?.startsWith('annotated-'));
        const hasAnnotatedPrev = splitModeImages.some(img => img.filename?.startsWith('annotated-'));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.id, splitModeImages?.[0]?.id, splitModeImages?.length, isGlobalSplit, currentSession, isProcessing, isAIThinking]);

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
        const validIndex = initialImageIndex >= 0 && initialImageIndex < images.length ? initialImageIndex : 0;
        const isMobile = window.innerWidth <= 768;
        
        const currentMode = (currentSession.mode || '').toLowerCase();
        const isQuestionMode = currentMode === 'question' || 
                               currentMode === 'question mode' ||
                               (currentSession.messages || []).some(m => m.type === 'question_response');
        
        const isActivelyProcessing = isProcessing || isAIThinking;

        // DO NOT auto-split on mobile, in Question Mode, during active processing, or if manually closed by user
        if (!isMobile && !isQuestionMode && !isActivelyProcessing && userClosedSplitSessionIdRef.current !== currentSession.id) {
          dispatch({
            type: 'ENTER_SPLIT_MODE',
            payload: { images, index: validIndex, isGlobal: true }
          });
        }

        dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      }
    }
  }, [autoSplit, selectedMarkingResult, currentSession, initialImageIndex, isProcessing, isAIThinking]);

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
        dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: explicitQuestionId });
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

      // Determine usageMode for prompt weighting
      let usageMode = isModelAnswerMode ? 'model-answer' : isMarkingSchemeMode ? 'marking-scheme' : 'chat';

      const response = await apiClient.post('/api/messages/chat', {
        message: trimmedText,
        messageId: userMessageId, // Pass the local user message ID to backend
        model: selectedModel || 'fast',
        sessionId: currentSession?.id || null,
        markingContext: guestMarkingContext, // Send context for guest users
        aiMessageId: aiMessageId, // Pass the AI message ID to backend
        contextQuestionId: effectiveQuestionId, // Pass the active or overridden context
        mode: usageMode // Pass current mode to backend
      });

      const data = response.data;

      if (data.success) {
        // Use the new standardized completion handler
        simpleSessionService.handleTextChatComplete(data, selectedModel || 'fast');
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }

      // Reset the request flag on success
      textRequestInProgress.current = false;
      return true;
    } catch (err) {
      const guestCheck = extractGuestLimitError(err);
      if (guestCheck.isGuestLimit) {
        stopAIThinking();
        stopProcessing();
        setGuestLimitInfo({
          usageCount: guestCheck.usageCount,
          usageLimit: guestCheck.usageLimit,
          resetAt: guestCheck.resetAt
        });
        setShowGuestLimitModal(true);
        textRequestInProgress.current = false;

        // If this session has no completed AI responses, clean up the dead chat view
        const liveSession = simpleSessionService.getCurrentSession();
        if (!hasCompletedAITurn(liveSession)) {
          clearSession();
          dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
        }
        return false;
      } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
        setShowCreditsModal(true);
      }
      handleError(err);
      stopAIThinking();
      stopProcessing();
      textRequestInProgress.current = false;
      return false;
    }
  }, [
    user, isNegative, getAuthToken, currentSession, selectedModel,
    activeQuestionId, isModelAnswerMode, isMarkingSchemeMode,
    addMessage, clearSession, startAIThinking, stopAIThinking, stopProcessing, handleError, startProcessing
  ]);

  const onGenerateModelAnswer = useCallback(async (input) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    if (!user) {
      pendingUploadRef.current = { type: 'model_answer', paper: trimmedInput };
      setGuestLimitInfo({ usageCount: 0, usageLimit: 0, resetAt: null });
      setShowGuestLimitModal(true);
      trackFunnelEvent('guest_limit_modal_shown', {
        trigger: 'feature_client_gate',
        usageCount: 0,
        paper: trimmedInput
      }, null);
      return false;
    }

    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

    try {
      startProcessing();

      const userMessageId = `user-${Date.now()}`;
      await addMessage({
        id: userMessageId,
        role: 'user',
        content: `Generate model answers for: ${trimmedInput}`,
        timestamp: new Date().toISOString(),
        type: 'text'
      });
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });

      // Generate AI message ID
      const aiMessageId = createAIMessageId(`model-${trimmedInput}-${Date.now()}`);

      const progressData = {
        isComplete: false,
        currentStepDescription: 'Finding exam paper...',
        allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is writing model answers...'],
        currentStepIndex: 0,
      };

      startAIThinking(progressData, aiMessageId, []);

      // IMMEDIATELY hide the ribbon - we know this is model-answer before SSE completes.
      // The session object won't have usageMode set yet (backend does that), so set eagerly.
      setIsModelAnswerMode(true);
      setIsMarkingSchemeMode(false);
      // Mark session as synced so the useEffect doesn't overwrite this on next fire
      lastSyncedModeSessionId.current = currentSession?.id || 'pending-model-answer';

      // Call the new SSE endpoint
      apiProcessor.processStreamRequest(
        '/api/model-answer',
        {
          paper: trimmedInput,
          model: selectedModel || 'fast',
          sessionId: currentSession?.id || null,
          aiMessageId: aiMessageId
        },
        // Step mapping
        {
          'retrieving_paper': 0,
          'retrieving_schemes': 1,
          'generating': 2
        }
      ).catch(err => {
        const guestCheck = extractGuestLimitError(err);
        if (guestCheck.isGuestLimit) {
          pendingUploadRef.current = { type: 'model_answer', paper: trimmedInput };
          setGuestLimitInfo({
            usageCount: guestCheck.usageCount,
            usageLimit: guestCheck.usageLimit,
            resetAt: guestCheck.resetAt
          });
          setShowGuestLimitModal(true);

          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
        } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
          setShowCreditsModal(true);
        } else {
          handleError(err);
          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
        }
        stopAIThinking();
        stopProcessing();
      });

      return true;
    } catch (err) {
      handleError(err);
      stopAIThinking();
      stopProcessing();
      return false;
    }
  }, [user, isNegative, selectedModel, currentSession, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, handleError, apiProcessor]);

  const onExplainMarkingScheme = useCallback(async (input) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    if (!user) {
      pendingUploadRef.current = { type: 'marking_scheme', paper: trimmedInput };
      setGuestLimitInfo({ usageCount: 0, usageLimit: 0, resetAt: null });
      setShowGuestLimitModal(true);
      trackFunnelEvent('guest_limit_modal_shown', {
        trigger: 'feature_client_gate',
        usageCount: 0,
        paper: trimmedInput
      }, null);
      return false;
    }

    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

    try {
      startProcessing();

      const userMessageId = `user-${Date.now()}`;
      await addMessage({
        id: userMessageId,
        role: 'user',
        content: `Explain marking scheme for: ${trimmedInput}`,
        timestamp: new Date().toISOString(),
        type: 'text'
      });
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });

      // Generate AI message ID
      const aiMessageId = createAIMessageId(`marking-scheme-${trimmedInput}-${Date.now()}`);

      const progressData = {
        isComplete: false,
        currentStepDescription: 'Finding exam paper...',
        allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is explaining marking scheme...'],
        currentStepIndex: 0,
      };

      startAIThinking(progressData, aiMessageId, []);

      // IMMEDIATELY hide the ribbon - we know this is marking-scheme before SSE completes.
      setIsMarkingSchemeMode(true);
      setIsModelAnswerMode(false);
      // Mark session as synced so the useEffect doesn't overwrite this on next fire
      lastSyncedModeSessionId.current = currentSession?.id || 'pending-marking-scheme';

      // Call the new SSE endpoint
      apiProcessor.processStreamRequest(
        '/api/marking-scheme',
        {
          paper: trimmedInput,
          model: selectedModel || 'fast',
          sessionId: currentSession?.id || null,
          aiMessageId: aiMessageId
        },
        // Step mapping
        {
          'retrieving_paper': 0,
          'retrieving_schemes': 1,
          'generating': 2
        }
      ).catch(err => {
        const guestCheck = extractGuestLimitError(err);
        if (guestCheck.isGuestLimit) {
          pendingUploadRef.current = { type: 'marking_scheme', paper: trimmedInput };
          setGuestLimitInfo({
            usageCount: guestCheck.usageCount,
            usageLimit: guestCheck.usageLimit,
            resetAt: guestCheck.resetAt
          });
          setShowGuestLimitModal(true);

          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
        } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
          setShowCreditsModal(true);
        } else {
          handleError(err);
          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
        }
        stopAIThinking();
        stopProcessing();
      });

      return true;
    } catch (err) {
      handleError(err);
      stopAIThinking();
      stopProcessing();
      return false;
    }
  }, [user, isNegative, selectedModel, currentSession, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, handleError, apiProcessor]);

  // Ref to track the last handled session ID to prevent redundant scrolls on every message update
  const lastHandledSessionIdRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Handle deep-links and URL parameters
   */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const mode = params.get('mode');
    const paper = params.get('paper') || params.get('code');

    if ((mode === 'model' || mode === 'model-answer') && paper) {
      setIsModelAnswerMode(true);
      setIsMarkingSchemeMode(false); // Reset other mode
      setInitialInput(paper);
      setPendingModelAnswerPaper(paper);
      setShowModelAnswerConfirmation(true);

      // [FIX] Clear URL parameters using Router to prevent re-triggering
      navigate(location.pathname, { replace: true });
    } else if ((mode === 'markingscheme' || mode === 'marking-scheme') && paper) {
      setIsMarkingSchemeMode(true);
      setIsModelAnswerMode(false); // Reset other mode
      setInitialInput(paper);
      // For marking scheme, we can trigger directly or via confirmation
      // Reusing the same confirmation modal logic for simplicity in UX
      setPendingModelAnswerPaper(paper);
      setShowModelAnswerConfirmation(true);

      // [FIX] Clear URL parameters using Router to prevent re-triggering
      navigate(location.pathname, { replace: true });
    } else if (mode === 'mark' && paper) {
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
      setInitialInput(paper);

      // [FIX] Clear URL parameters using Router to prevent re-triggering
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

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
          // Revert: Simply scroll to bottom to show the latest result, as students expect.
          scrollToBottom();
        } else {
          scrollToBottom();
        }
      }, 150);
      return () => clearTimeout(timeoutId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.id, selectedMarkingResult, scrollToMessage, scrollToBottom]);

  const handleImageAnalysis = useCallback(async (file = null, customText = null) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return;

    trackFunnelEvent('upload_initiated', {
      mode: 'single',
      fileCount: 1,
      fileTypes: [targetFile.type || targetFile.name?.split('.').pop() || 'unknown'],
      totalBytes: targetFile.size || 0
    }, user?.uid);

    // --- INSTANT GUEST GATE (0ms response, avoids uploading large files before auth) ---
    if (!user) {
      pendingUploadRef.current = { type: 'single', file: targetFile, customText };
      setGuestLimitInfo({ usageCount: 0, usageLimit: 0, resetAt: null });
      setShowGuestLimitModal(true);
      trackFunnelEvent('guest_limit_modal_shown', {
        trigger: 'upload_client_gate',
        usageCount: 0,
        fileCount: 1
      }, null);
      clearFile();
      return false;
    }

    // --- CREDIT ENFORCEMENT ---
    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

    try {
      userClosedSplitSessionIdRef.current = null;
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
          const guestCheck = extractGuestLimitError(err);
          if (guestCheck.isGuestLimit) {
            stopAIThinking();
            stopProcessing();
            setGuestLimitInfo({
              usageCount: guestCheck.usageCount,
              usageLimit: guestCheck.usageLimit,
              resetAt: guestCheck.resetAt
            });
            pendingUploadRef.current = { type: 'single', file: targetFile, customText };
            setShowGuestLimitModal(true);
            trackFunnelEvent('guest_limit_modal_shown', {
              trigger: 'upload',
              usageCount: guestCheck.usageCount,
              fileCount: 1
            }, null);
            return;
          } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
            setShowCreditsModal(true);
          }

          trackFunnelEvent('upload_failed_client_seen', {
            errorMessage: err?.response?.data?.error || err?.message || 'Unknown upload error'
          }, user?.uid);
          handleError(err);
          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
          stopAIThinking();
          stopProcessing();
        });

      clearFile();
      return true;
    } catch (err) {
      const guestCheck = extractGuestLimitError(err);
      if (guestCheck.isGuestLimit) {
        stopAIThinking();
        stopProcessing();
        setGuestLimitInfo({ 
          usageCount: guestCheck.usageCount, 
          usageLimit: guestCheck.usageLimit, 
          resetAt: guestCheck.resetAt 
        });
        
        // NEW: Save the intended upload to memory
        pendingUploadRef.current = { type: 'single', file: targetFile, customText };
        
        setShowGuestLimitModal(true);
        trackFunnelEvent('guest_limit_modal_shown', {
          trigger: 'upload',
          usageCount: guestCheck.usageCount,
          fileCount: 1
        }, null);
        // REMOVED clearSession() and SET_PAGE_MODE
        return false;
      } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
        setShowCreditsModal(true);
      }
      trackFunnelEvent('upload_failed_client_seen', {
        errorMessage: err?.response?.data?.error || err?.message || 'Unknown upload error'
      }, user?.uid);
      handleError(err);
      const liveSession = simpleSessionService.getCurrentSession();
      if (!hasCompletedAITurn(liveSession)) {
        clearSession();
        dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      }
      stopAIThinking();
      stopProcessing();
      return false;
    }
  }, [user, isNegative, selectedFile, selectedModel, activeQuestionId, processImage, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, clearFile, handleError]);

  const handleMultiImageAnalysis = useCallback(async (files = [], customText = null) => {
    if (!files || files.length === 0) return;

    trackFunnelEvent('upload_initiated', {
      mode: 'multi',
      fileCount: files.length,
      fileTypes: files.map(f => f?.type || f?.name?.split('.').pop() || 'unknown'),
      totalBytes: files.reduce((sum, f) => sum + (f?.size || 0), 0)
    }, user?.uid);

    // --- INSTANT GUEST GATE (0ms response, avoids uploading large PDFs/images before auth) ---
    if (!user) {
      pendingUploadRef.current = { type: 'multi', files, customText };
      setGuestLimitInfo({ usageCount: 0, usageLimit: 0, resetAt: null });
      setShowGuestLimitModal(true);
      trackFunnelEvent('guest_limit_modal_shown', {
        trigger: 'upload_client_gate',
        usageCount: 0,
        fileCount: files.length
      }, null);
      return false;
    }

    // --- CREDIT ENFORCEMENT ---
    if (user && isNegative) {
      setShowCreditsModal(true);
      return false;
    }

    try {
      userClosedSplitSessionIdRef.current = null;
      startProcessing();

      // Separate PDFs and Images so mixed uploads display properly
      const isPdfFile = (file) => file?.type === 'application/pdf' || (file?.name || '').toLowerCase().endsWith('.pdf');
      const pdfFiles = files.filter(isPdfFile);
      const imageFiles = files.filter(file => !isPdfFile(file));
      const hasPDFs = pdfFiles.length > 0;
      const hasImages = imageFiles.length > 0;

      let pdfContexts = [];
      let imageDataArray = [];

      if (hasPDFs) {
        // Convert each PDF file to a Blob URL for immediate display (avoids data URL length limits)
        const convertPdfToBlobUrl = async (file) => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              try {
                const base64DataUrl = e.target.result;
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

        pdfContexts = await Promise.all(pdfFiles.map(async (file) => {
          const { blobUrl } = await convertPdfToBlobUrl(file);
          return {
            originalFileName: file.name,
            fileSize: file.size, // Use bytes (number) to match imageDataArray structure
            url: blobUrl
          };
        }));
      }

      if (hasImages) {
        const readImageAsDataUrl = (file) => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        };

        imageDataArray = await Promise.all(imageFiles.map(readImageAsDataUrl));
      }

      const optimisticMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: customText || `I have uploaded ${files.length} file(s) for analysis.`,
        timestamp: new Date().toISOString(),
        ...(hasPDFs && {
          originalFileType: 'pdf',
          pdfContexts: pdfContexts,
        }),
        ...(hasImages && {
          imageData: imageDataArray[0], // Show first image as primary
          imageDataArray: imageDataArray,
          fileName: imageFiles.length === 1 ? imageFiles[0].name : imageFiles.map(f => f.name).join(', '),
        }),
        isMultiImage: hasImages,
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

      const thinkingImages = [
        ...(optimisticMessage.pdfContexts || []),
        ...(optimisticMessage.imageDataArray || [])
      ];
      startAIThinking(multiImageProgressData, multiImageAiMessageId, thinkingImages);

      // Execute API call in background so UI resets immediately
      processMultiImageAPI(files, selectedModel, 'marking', customText || undefined, multiImageAiMessageId)
        .catch(err => {
          const guestCheck = extractGuestLimitError(err);
          if (guestCheck.isGuestLimit) {
            stopAIThinking();
            stopProcessing();
            setGuestLimitInfo({
              usageCount: guestCheck.usageCount,
              usageLimit: guestCheck.usageLimit,
              resetAt: guestCheck.resetAt
            });
            pendingUploadRef.current = { type: 'multi', files, customText };
            setShowGuestLimitModal(true);
            trackFunnelEvent('guest_limit_modal_shown', {
              trigger: 'upload',
              usageCount: guestCheck.usageCount,
              fileCount: files?.length || 1
            }, null);
            return;
          } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
            setShowCreditsModal(true);
          }

          trackFunnelEvent('upload_failed_client_seen', {
            errorMessage: err?.response?.data?.error || err?.message || 'Unknown upload error'
          }, user?.uid);
          handleError(err);
          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
          stopAIThinking();
          stopProcessing();
        });

      return true;
    } catch (err) {
      const guestCheck = extractGuestLimitError(err);
      if (guestCheck.isGuestLimit) {
        stopAIThinking();
        stopProcessing();
        setGuestLimitInfo({ 
          usageCount: guestCheck.usageCount, 
          usageLimit: guestCheck.usageLimit, 
          resetAt: guestCheck.resetAt 
        });
        
        // NEW: Save the intended upload to memory
        pendingUploadRef.current = { type: 'multi', files, customText };
        
        setShowGuestLimitModal(true);
        trackFunnelEvent('guest_limit_modal_shown', {
          trigger: 'upload',
          usageCount: guestCheck.usageCount,
          fileCount: files?.length || 1
        }, null);
        // REMOVED clearSession() and SET_PAGE_MODE
        return false;
      } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
        setShowCreditsModal(true);
      }
      trackFunnelEvent('upload_failed_client_seen', {
        errorMessage: err?.response?.data?.error || err?.message || 'Unknown upload error'
      }, user?.uid);
      handleError(err);
      const liveSession = simpleSessionService.getCurrentSession();
      if (!hasCompletedAITurn(liveSession)) {
        clearSession();
        dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      }
      stopAIThinking();
      stopProcessing();
      return false;
    }
  }, [user, isNegative, selectedModel, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processMultiImageAPI, handleError]);

  // Handle files passed from Landing Pages (SEO Phase 2)
  const handoverProcessedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (location.state?.pendingFiles && location.state.pendingFiles.length > 0 && !handoverProcessedRef.current) {
      handoverProcessedRef.current = true;
      const files = location.state.pendingFiles;

      // Small delay to ensure everything is initialized
      setTimeout(() => {
        handleMultiImageAnalysis(files);
        // Clear location state
        window.history.replaceState({}, document.title);
      }, 100);
    }
  }, [authLoading, location.state, handleMultiImageAnalysis]);

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
    userClosedSplitSessionIdRef.current = null;
    dispatch({ type: 'ENTER_SPLIT_MODE', payload: { images, index, isGlobal } });
  }, []);

  const exitSplitMode = useCallback(() => {
    userClosedSplitSessionIdRef.current = currentSession?.id || 'active';
    dispatch({ type: 'EXIT_SPLIT_MODE' });
  }, [currentSession?.id]);

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
    onGenerateModelAnswer,
    onExplainMarkingScheme,
    isModelAnswerMode, setIsModelAnswerMode,
    isMarkingSchemeMode, setIsMarkingSchemeMode,
    initialInput, setInitialInput,
    showModelAnswerConfirmation, setShowModelAnswerConfirmation,
    pendingModelAnswerPaper, setPendingModelAnswerPaper,
    chatContainerRef,
    isHistoryLoading,
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
    showCreditsModal,
    credits,
    refreshCredits,
    setSidebarOpen,
    guestLimitInfo,
    lastHandledSessionIdRef, // Expose ref if needed
    ...progressProps
  }), [
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating,
    handleFileSelect, clearFile, handleModelChange, handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating,
    onGenerateModelAnswer, onExplainMarkingScheme, isModelAnswerMode, setIsModelAnswerMode,
    isMarkingSchemeMode, setIsMarkingSchemeMode,
    initialInput, setInitialInput,
    showModelAnswerConfirmation, setShowModelAnswerConfirmation,
    pendingModelAnswerPaper, setPendingModelAnswerPaper,
    onFavoriteToggle, onRatingChange, onTitleUpdate, setHoveredRating, onToggleInfoDropdown, isProcessing, isAIThinking, error,
    onSendMessage, addMessage, chatContainerRef,
    isHistoryLoading,
    scrollToBottom, showScrollButton, hasNewResponse, scrollToNewResponse, scrollToMessage,
    handleMultiImageAnalysis, progressProps, getImageSrc, startAIThinking,
    splitModeImages, activeImageIndex, enterSplitMode, exitSplitMode, setActiveImageIndex,
    activeQuestionId, setActiveQuestionId, isQuestionTableVisible, setQuestionTableVisibility,
    isContextFilterActive, setContextFilterActive,
    state.visibleTableIds,
    isNegative,
    setShowCreditsModal,
    showCreditsModal, credits, refreshCredits,
    setSidebarOpen,
    guestLimitInfo,
    lastHandledSessionIdRef
  ]);

  // Track if a user refreshes or closes the browser tab while an upload/marking is actively running
  useEffect(() => {
    if (!isProcessing && !isAIThinking) return;

    const startTime = Date.now();
    const handleBeforeUnload = () => {
      trackFunnelEvent('user_abandoned_during_processing', {
        elapsedSec: Number(((Date.now() - startTime) / 1000).toFixed(1)),
        loadingMessage: progressProps.loadingMessage || 'unknown',
        stepIndex: progressProps.currentStepIndex ?? -1,
        pageMode
      }, user?.uid);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isProcessing, isAIThinking, progressProps.loadingMessage, progressProps.currentStepIndex, pageMode, user?.uid]);

  // Keep latest handlers in a ref so post-login auto-resume only triggers once per login and always uses fresh closures
  const resumeHandlersRef = useRef({
    handleMultiImageAnalysis,
    handleImageAnalysis,
    onGenerateModelAnswer,
    onExplainMarkingScheme
  });

  useEffect(() => {
    resumeHandlersRef.current = {
      handleMultiImageAnalysis,
      handleImageAnalysis,
      onGenerateModelAnswer,
      onExplainMarkingScheme
    };
  }, [handleMultiImageAnalysis, handleImageAnalysis, onGenerateModelAnswer, onExplainMarkingScheme]);

  // --- Auto-Resume after login (Chrome, Desktop Safari, iOS Safari safe) ---
  useEffect(() => {
    if (user?.uid) {
      retrieveAndClearStash().then((stashedData) => {
        trackFunnelEvent('post_login_stash_check', {
          hasStashedData: Boolean(stashedData),
          stashType: stashedData?.type || null,
          fileCount: stashedData?.files?.length || (stashedData?.base64 ? 1 : 0),
          paper: stashedData?.paper || null
        }, user.uid);

        if (stashedData) {
          console.log("Recovered stashed data after login, auto-resuming...");

          // Helper to convert base64 back to File object (falls back if iOS leaves MIME blank)
          const base64ToFile = (base64, filename, mimeType) => {
            const parts = base64.split(',');
            const rawBase64 = parts.length > 1 ? parts[1] : parts[0];
            const detectedMime = mimeType || (parts[0].match(/:(.*?);/)?.[1]) || 'application/octet-stream';
            const bstr = atob(rawBase64);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) {
              u8arr[n] = bstr.charCodeAt(n);
            }
            return new File([u8arr], filename || 'upload', { type: detectedMime });
          };

          setTimeout(() => {
            if (stashedData.type === 'multi_base64' && Array.isArray(stashedData.files)) {
              const files = stashedData.files.map(f => base64ToFile(f.base64, f.name, f.type));
              resumeHandlersRef.current.handleMultiImageAnalysis(files, stashedData.customText);
            } else if (stashedData.type === 'single_base64' && stashedData.base64) {
              const file = base64ToFile(stashedData.base64, stashedData.fileName, stashedData.mimeType);
              resumeHandlersRef.current.handleImageAnalysis(file, stashedData.customText);
            } else if (stashedData.type === 'model_answer' && stashedData.paper) {
              resumeHandlersRef.current.onGenerateModelAnswer(stashedData.paper);
            } else if (stashedData.type === 'marking_scheme' && stashedData.paper) {
              resumeHandlersRef.current.onExplainMarkingScheme(stashedData.paper);
            }
          }, 500);
        }
      }).catch(console.error);
    }
  }, [user?.uid]);

  return (
    <MarkingPageContext.Provider value={value}>
      {children}
      <InsufficientCreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
        remainingCredits={credits?.remainingCredits ?? 0}
      />
      <GuestLimitModal
        isOpen={showGuestLimitModal}
        hasPendingUpload={Boolean(pendingUploadRef.current)}
        onClose={() => {
          trackFunnelEvent('guest_limit_modal_dismissed', {
            hadPendingUpload: Boolean(pendingUploadRef.current)
          }, null);
          pendingUploadRef.current = null;
          setShowGuestLimitModal(false);
          const liveSession = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSession)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          }
        }}
        onSignup={async (authMode = 'signup') => {
          const resolvedMode = authMode === 'login' ? 'login' : 'signup';
          trackFunnelEvent('guest_limit_signup_clicked', {
            authMode: resolvedMode,
            stashedPendingUpload: Boolean(pendingUploadRef.current),
            stashType: pendingUploadRef.current?.type || null,
            fileCount: pendingUploadRef.current?.files?.length || (pendingUploadRef.current?.file ? 1 : 0),
            paper: pendingUploadRef.current?.paper || null
          }, null);

          setShowGuestLimitModal(false);

          // Convert File(s) to Base64 strings (or stash paper code) and await IndexedDB transaction completion BEFORE redirect
          if (pendingUploadRef.current) {
            try {
              const uploadData = pendingUploadRef.current;
              const fileToBase64 = (file) => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });

              if (uploadData.type === 'single' && uploadData.file) {
                const base64 = await fileToBase64(uploadData.file);
                await stashUploadData({
                  type: 'single_base64',
                  fileName: uploadData.file.name,
                  mimeType: uploadData.file.type || (uploadData.file.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                  base64,
                  customText: uploadData.customText
                });
              } else if (uploadData.type === 'multi' && Array.isArray(uploadData.files)) {
                const base64Files = await Promise.all(uploadData.files.map(async (f) => ({
                  name: f.name,
                  type: f.type || (f.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                  base64: await fileToBase64(f)
                })));
                await stashUploadData({
                  type: 'multi_base64',
                  files: base64Files,
                  customText: uploadData.customText
                });
              } else if ((uploadData.type === 'model_answer' || uploadData.type === 'marking_scheme') && uploadData.paper) {
                await stashUploadData({
                  type: uploadData.type,
                  paper: uploadData.paper
                });
              }
            } catch (e) {
              console.error("Failed to stash files:", e);
            }
          }

          import('../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
            EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: resolvedMode });
          });
        }}
        usageCount={guestLimitInfo.usageCount}
        usageLimit={guestLimitInfo.usageLimit}
        resetAt={guestLimitInfo.resetAt}
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

