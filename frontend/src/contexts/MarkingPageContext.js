import React, { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useImageUpload } from '../hooks/useImageUpload';
import { useSessionManager } from '../hooks/useSessionManager';
import { useApiProcessor } from '../hooks/useApiProcessor';
import { useAuth } from './AuthContext';
import { useMarkingJob } from './MarkingJobContext';
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
import { trackFunnelEvent, getNavigationType } from '../utils/funnelTracker';
import { getSessionModel } from '../utils/modelDisplay';
import { validateSupportedUploadFiles } from '../utils/fileUtils';

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

const MARKING_PIPELINE_STEPS = [
  'Input Validation',
  'Standardization',
  'Preprocessing',
  'OCR & Classification',
  'Question Detection',
  'Segmentation',
  'Marking',
  'Output Generation'
];

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
  initialImageIndex = 0,
  resetSignal = 0
}) => {
  const { user, loading: authLoading, getAuthToken } = useAuth();
  const { sessionId: routeSessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { registerJob, updateJobProgress, completeJob, failJob, startPollingJob, getJobForSession } = useMarkingJob();
  const pendingUploadRef = useRef(null);
  const { selectedFile, processImage, clearFile, handleFileSelect } = useImageUpload();

  const {
    currentSession, chatMessages, sessionTitle, isFavorite, rating,
    addMessage, clearSession, loadSession, onFavoriteToggle, onRatingChange, onTitleUpdate
  } = useSessionManager();

  const { credits, isNegative, refreshCredits, ensureCredits, loading: creditsLoading } = useCredits();
  const [showCreditsModal, setShowCreditsModal] = React.useState(false);

  useEffect(() => {
    if (showCreditsModal) {
      trackFunnelEvent('credits_modal_shown', {
        remainingCredits: credits?.remainingCredits ?? 0
      }, user?.uid);
    }
  }, [showCreditsModal, credits?.remainingCredits, user?.uid]);
  const [showGuestLimitModal, setShowGuestLimitModal] = React.useState(false);
  const [guestLimitInfo, setGuestLimitInfo] = React.useState({ usageCount: 0, usageLimit: 0, resetAt: null });
  const [isModelAnswerMode, setIsModelAnswerMode] = React.useState(false);
  const [isMarkingSchemeMode, setIsMarkingSchemeMode] = React.useState(false);
  const [initialInput, setInitialInput] = React.useState('');
  const [showModelAnswerConfirmation, setShowModelAnswerConfirmation] = React.useState(false);
  const [pendingModelAnswerPaper, setPendingModelAnswerPaper] = React.useState(null);
  const [pendingConfirmationMode, setPendingConfirmationMode] = React.useState(null);

  const checkNegativeCredits = useCallback(async () => {
    if (!user) return false;
    let activeCredits = credits;
    if (activeCredits === null || creditsLoading) {
      activeCredits = await ensureCredits();
    }
    const hasNegative = activeCredits ? activeCredits.remainingCredits <= 0 : isNegative;
    if (hasNegative) {
      setShowCreditsModal(true);
      return true;
    }
    return false;
  }, [user, credits, creditsLoading, ensureCredits, isNegative]);

  const apiProcessor = useApiProcessor();
  const { isProcessing, isAIThinking, error } = apiProcessor;
  const { startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, processMultiImageAPI, handleError } = apiProcessor;

  const activeViewedSessionId = routeSessionId || currentSession?.id || null;
  const activeRouteJob = getJobForSession(activeViewedSessionId);
  const isJobActiveForViewedSession = Boolean(activeRouteJob && activeRouteJob.status === 'processing');
  const isProcessorForCurrentSession = !apiProcessor.processingSessionId || apiProcessor.processingSessionId === activeViewedSessionId;
  const isCurrentSessionProcessing = Boolean((isProcessing && isProcessorForCurrentSession) || isJobActiveForViewedSession);
  const isCurrentSessionThinking = Boolean((isAIThinking && isProcessorForCurrentSession) || isJobActiveForViewedSession);

  const progressProps = useMemo(() => {
    const {
      loadingProgress, loadingStep, loadingTotalSteps, loadingMessage,
      showProgressDetails, progressData, stepList, currentStepIndex, updateProgress, setShowProgressDetails
    } = apiProcessor;
    const resolvedProgressData = isJobActiveForViewedSession
      ? (activeRouteJob?.progressData || progressData)
      : (isProcessorForCurrentSession ? progressData : null);
    const resolvedStepIndex = resolvedProgressData?.currentStepIndex ?? (isProcessorForCurrentSession ? currentStepIndex : 0);
    const resolvedStepList = resolvedProgressData?.allSteps ?? (isProcessorForCurrentSession ? stepList : []);
    const resolvedTotalSteps = resolvedStepList.length || (isProcessorForCurrentSession ? loadingTotalSteps : null);
    return {
      loadingProgress: resolvedProgressData?.isComplete
        ? 100
        : (resolvedTotalSteps ? Math.round((resolvedStepIndex / resolvedTotalSteps) * 100) : (isProcessorForCurrentSession ? loadingProgress : 0)),
      loadingStep: resolvedStepIndex + (resolvedProgressData?.isComplete ? 0 : 1),
      loadingTotalSteps: resolvedTotalSteps,
      loadingMessage: resolvedProgressData?.currentStepDescription || (isProcessorForCurrentSession ? loadingMessage : 'Processing...'),
      showProgressDetails,
      progressData: resolvedProgressData,
      stepList: resolvedStepList,
      currentStepIndex: resolvedStepIndex,
      updateProgress,
      setShowProgressDetails
    };
  }, [apiProcessor, isJobActiveForViewedSession, activeRouteJob?.progressData, isProcessorForCurrentSession]);

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
  const lastUploadedStudentFilesRef = useRef([]);
  const prevResetSignalRef = useRef(resetSignal);

  useEffect(() => {
    if (resetSignal !== prevResetSignalRef.current) {
      prevResetSignalRef.current = resetSignal;
      clearSession();
      const savedModel = getSavedModel();
      dispatch({ type: 'SET_SELECTED_MODEL', payload: savedModel });
      window.dispatchEvent(new CustomEvent('modelChanged', { detail: savedModel }));
      dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      dispatch({ type: 'EXIT_SPLIT_MODE' });
      dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: null });
      dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: false });
      lastSyncedSessionId.current = null;
      lastHandledSessionIdRef.current = null;
    }
  }, [resetSignal, clearSession]);

  // Load session when selectedMarkingResult prop changes (e.g., from Sidebar history click)
  useEffect(() => {
    if (selectedMarkingResult) {
      // Do not allow a stale selectedMarkingResult prop from a previously clicked sidebar item
      // to overwrite an active session when the URL route has already moved to another sessionId!
      if (routeSessionId && selectedMarkingResult.id && selectedMarkingResult.id !== routeSessionId) {
        return;
      }
      if (selectedMarkingResult.id !== lastSyncedSessionId.current) {
        dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: null });
        dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: false });
      }
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
      const sessionModel = getSessionModel(selectedMarkingResult);
      dispatch({ type: 'SET_SELECTED_MODEL', payload: sessionModel });
      window.dispatchEvent(new CustomEvent('modelChanged', { detail: sessionModel }));
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
    } else if (!routeSessionId) {
      clearSession();
      const savedModel = getSavedModel();
      dispatch({ type: 'SET_SELECTED_MODEL', payload: savedModel });
      window.dispatchEvent(new CustomEvent('modelChanged', { detail: savedModel }));
      dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
      dispatch({ type: 'EXIT_SPLIT_MODE' });
      dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: null });
      dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: false });
      lastSyncedSessionId.current = null;
    }
  }, [selectedMarkingResult, routeSessionId, loadSession, clearSession]);

  const getJobForSessionRef = useRef(getJobForSession);
  getJobForSessionRef.current = getJobForSession;
  const prevRouteSessionIdRef = useRef(routeSessionId);

  // URL hydration for /app/:sessionId (reload recovery & deep links)
  useEffect(() => {
    const prevRouteSessionId = prevRouteSessionIdRef.current;
    prevRouteSessionIdRef.current = routeSessionId;

    if (!routeSessionId || authLoading) return;

    const routeChanged = Boolean(prevRouteSessionId && prevRouteSessionId !== routeSessionId);
    const syncedChanged = Boolean(
      lastSyncedSessionId.current &&
      !lastSyncedSessionId.current.startsWith('temp-') &&
      routeSessionId !== lastSyncedSessionId.current
    );

    if (routeChanged || syncedChanged) {
      dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: null });
      dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: false });
    }

    const liveSession =
      simpleSessionService.getCachedSession?.(routeSessionId) ||
      simpleSessionService.getCurrentSession();
    const isInFlightClientSession =
      apiProcessor.processingSessionId === routeSessionId ||
      getJobForSessionRef.current(routeSessionId)?.status === 'processing';
    if (
      isInFlightClientSession ||
      (liveSession?.id === routeSessionId && Array.isArray(liveSession.messages) && liveSession.messages.length > 0)
    ) {
      if (liveSession?.id === routeSessionId && simpleSessionService.getCurrentSession()?.id !== routeSessionId) {
        loadSession(liveSession);
      }
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      const existingJob = getJobForSessionRef.current(routeSessionId);
      const hasInFlightLocalMsg = Boolean(liveSession?.messages?.some(m => m.role === 'assistant' && m.isProcessing));
      if (existingJob?.status === 'processing' && apiProcessor.processingSessionId !== routeSessionId && !hasInFlightLocalMsg) {
        startPollingJob(routeSessionId);
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await simpleSessionService.getSession(routeSessionId);
        if (cancelled) return;

        if (res?.status === 'processing') {
          registerJob({
            sessionId: routeSessionId,
            title: res.session?.title || 'Processing...',
            isRemark: Boolean(res.isRemark),
            progressData: res.progressData || {
              currentStepDescription: 'Processing...',
              allSteps: MARKING_PIPELINE_STEPS,
              currentStepIndex: 0,
              isComplete: false
            }
          });
          if (res.session) {
            loadSession(res.session);
            if (!routeSessionId.startsWith('temp-')) {
              simpleSessionService.updateSidebarSession(res.session);
            }
          } else {
            const initializedSession = simpleSessionService.initClientSession(routeSessionId, 'Processing...');
            if (initializedSession && !routeSessionId.startsWith('temp-')) {
              simpleSessionService.updateSidebarSession(initializedSession);
            }
            const currentAfterInit = simpleSessionService.getCurrentSession();
            const hasProcessingMsg = (currentAfterInit?.messages || []).some(m => m.isProcessing);
            if (!hasProcessingMsg) {
              await simpleSessionService.addMessage({
                id: `ai-resume-${routeSessionId}`,
                role: 'assistant',
                content: '',
                isProcessing: true,
                progressData: res.progressData || {
                  currentStepDescription: 'Processing...',
                  allSteps: MARKING_PIPELINE_STEPS,
                  currentStepIndex: 0,
                  isComplete: false
                },
                timestamp: new Date().toISOString()
              }, routeSessionId);
            }
          }
          dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
          startPollingJob(routeSessionId);
          return;
        }

        if (res?.status === 'failed') {
          failJob(routeSessionId, res.error || 'Marking failed');
          if (res.fallbackResult) {
            simpleSessionService.initClientSession(routeSessionId, res.fallbackResult.sessionTitle || 'Upload Issue');
            simpleSessionService.handleProcessComplete(
              res.fallbackResult,
              'fast',
              res.fallbackResult?.aiMessage?.id || null,
              routeSessionId
            );
            dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
          } else if (res.session) {
            loadSession(res.session);
            dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
          } else {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            handleError(new Error(res.error || 'Marking failed'));
          }
          return;
        }

        if (res?.status === 'completed' || res?.session || res?.fallbackResult) {
          completeJob(routeSessionId, res?.session?.title || res?.fallbackResult?.sessionTitle);
          refreshCredits();
          if (res.session) {
            loadSession(res.session);
            const sessionModel = getSessionModel(res.session);
            dispatch({ type: 'SET_SELECTED_MODEL', payload: sessionModel });
            window.dispatchEvent(new CustomEvent('modelChanged', { detail: sessionModel }));
            dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
          } else if (res.fallbackResult) {
            simpleSessionService.initClientSession(routeSessionId, res.fallbackResult.sessionTitle || 'Marking Session');
            simpleSessionService.handleProcessComplete(
              res.fallbackResult,
              res.fallbackResult?.processingStats?.modelUsed || 'fast',
              res.fallbackResult?.aiMessage?.id || null,
              routeSessionId
            );
            dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
          }
        }
      } catch (err) {
        if (cancelled) return;
        const status = err?.response?.status;
        const isStillInFlight =
          apiProcessor.processingSessionId === routeSessionId ||
          getJobForSessionRef.current(routeSessionId)?.status === 'processing';
        if ((status === 404 || status === 403) && !isStillInFlight) {
          clearSession();
          dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
          navigate('/app', { replace: true });
        } else if (!isStillInFlight) {
          console.error('Failed to hydrate session from URL:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeSessionId, authLoading, loadSession, clearSession, registerJob, completeJob, failJob, startPollingJob, apiProcessor.processingSessionId, handleError, navigate]);

  // Sync specialized mode flags based on session usageMode or chat content (to hide ribbon in history)
  // ONLY run on initial session load to avoid overwriting manual toggles
  useEffect(() => {

    if (!currentSession) {
      if (!pendingModelAnswerPaper && !showModelAnswerConfirmation) {
        setIsModelAnswerMode(false);
        setIsMarkingSchemeMode(false);
      }
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
      dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: null });
      dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: false });
      return;
    }

    const newImages = getSessionImages(currentSession);
    const sessionChanged = currentSession.id !== lastSyncedSessionId.current;

    // SAFETY: If we are in the middle of a history transition, don't revert to old session data
    const expectedSessionId = routeSessionId || selectedMarkingResult?.id;
    if (sessionChanged && expectedSessionId && currentSession.id !== expectedSessionId) {
      return;
    }

    const isMobile = window.innerWidth <= 768;
    
    const currentMode = (currentSession.mode || '').toLowerCase();
    const isQuestionMode = currentMode === 'question' || 
                           currentMode === 'question mode' ||
                           (currentSession.messages || []).some(m => m.type === 'question_response');
    
    // 🌟 SIMPLIFIED FIX: Detect any active processing
    const isActivelyProcessing = isCurrentSessionProcessing || isCurrentSessionThinking;

    const isUserClosed = userClosedSplitSessionIdRef.current === currentSession.id;

    // We ONLY auto-open if we are NOT on mobile, NOT in Question Mode, NOT currently processing, and NOT manually closed by the user
    const shouldAutoOpen = !isMobile && !isQuestionMode && !isActivelyProcessing && !isUserClosed && newImages && newImages.length > 0;

    if (sessionChanged) {
      const wasTempSession = lastSyncedSessionId.current?.startsWith('temp-');
      if (!wasTempSession) {
        userClosedSplitSessionIdRef.current = null;
        dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: null });
        dispatch({ type: 'SET_CONTEXT_FILTER_ACTIVE', payload: false });
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
      } else if (splitModeImages && (!newImages || newImages.length === 0 || isQuestionMode || isUserClosedNew)) {
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

      // 2. Only close an already-open global panel if genuine exit conditions are met.
      // (We check isGlobalSplit to ensure we don't close a modal the user manually clicked open)
      // CRITICAL: DO NOT close on mobile just because a follow-up action or session update occurred!
      // On mobile, splitModeImages is only populated when the user explicitly opens the ImageViewer overlay.
      const shouldCloseExisting = isQuestionMode || isUserClosed || !newImages || newImages.length === 0;
      if (splitModeImages && splitModeImages.length > 0 && shouldCloseExisting && isGlobalSplit) {
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
    chatContainerElement,
    showScrollButton,
    hasNewResponse,
    scrollToBottom,
    scrollToNewResponse,
    scrollToMessage,
    focusMessageWithStabilization,
    cancelStabilization,
  } = useScrollManager(chatMessages, isCurrentSessionThinking, currentSession?.id || null);

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
      onProcessingChange(isCurrentSessionProcessing);
    }
  }, [isCurrentSessionProcessing, onProcessingChange]);

  const onSendMessage = useCallback(async (text) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Prevent duplicate calls for the same text
    if (textRequestInProgress.current) {
      return;
    }

    // --- CREDIT ENFORCEMENT ---
    if (await checkNegativeCredits()) {
      if (typeof clearFile === 'function') clearFile();
      return false;
    }

    const extractQuestionNumber = (text) => {
      const match = text.match(/(?:question|q)\s*(\d+)/i);
      return match ? match[1] : null;
    };

    const liveSession = simpleSessionService.getCurrentSession() || currentSession;
    const targetSessionId = liveSession?.id || null;

    try {
      textRequestInProgress.current = true;
      startProcessing(targetSessionId);

      const explicitQuestionId = extractQuestionNumber(trimmedText);
      const sessionMessages = liveSession?.messages || chatMessages || [];
      const latestMarkingMsg = [...sessionMessages].reverse().find(m => m.markingContext);
      const gradedQuestionNumbers = Array.isArray(latestMarkingMsg?.markingContext?.questionResults)
        ? latestMarkingMsg.markingContext.questionResults.map(q => String(q?.number || '').trim()).filter(Boolean)
        : [];
      const hasGradedQuestionsInSession = gradedQuestionNumbers.length > 0;
      const isValidExplicitQuestion = Boolean(
        explicitQuestionId &&
        hasGradedQuestionsInSession &&
        gradedQuestionNumbers.includes(String(explicitQuestionId))
      );

      const effectiveQuestionId = isValidExplicitQuestion
        ? explicitQuestionId
        : (hasGradedQuestionsInSession ? activeQuestionId : null);

      // Only auto-focus activeQuestionId (and sync split-mode activeImageIndex) when the session actually has graded question results matching that question
      if (isValidExplicitQuestion) {
        if (explicitQuestionId !== activeQuestionId) {
          dispatch({ type: 'SET_ACTIVE_QUESTION_ID', payload: explicitQuestionId });
        }
        const matchedQResult = Array.isArray(latestMarkingMsg?.markingContext?.questionResults)
          ? latestMarkingMsg.markingContext.questionResults.find(q => String(q?.number || '').trim() === String(explicitQuestionId))
          : null;
        if (matchedQResult && typeof matchedQResult.pageIndex === 'number' && splitModeImages && splitModeImages.length > 0) {
          const targetPageIdx = matchedQResult.pageIndex;
          const viewerIdx = splitModeImages.findIndex(
            (img, idx) => (img?.pageIndex ?? idx) === targetPageIdx && (img?.messageRole === 'assistant' || img?.messageType === 'marking_annotated')
          );
          const resolvedViewerIdx = viewerIdx !== -1
            ? viewerIdx
            : (targetPageIdx >= 0 && targetPageIdx < splitModeImages.length ? targetPageIdx : -1);
          if (resolvedViewerIdx !== -1 && resolvedViewerIdx !== activeImageIndex) {
            dispatch({ type: 'SET_ACTIVE_IMAGE_INDEX', payload: resolvedViewerIdx });
          }
        }
      }

      const userMessageId = `user-${Date.now()}`;
      await addMessage({
        id: userMessageId,
        role: 'user',
        content: trimmedText,
        timestamp: new Date().toISOString(),
        type: 'text',
        contextQuestionId: effectiveQuestionId
      }, targetSessionId);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });

      const textProgressData = {
        isComplete: false,
        currentStepDescription: 'AI is thinking...',
        allSteps: ['AI is thinking...'],
        currentStepIndex: 0,
      };

      // Generate a predictable AI message ID that backend can use
      const aiMessageId = createAIMessageId(trimmedText);
      startAIThinking(textProgressData, aiMessageId, [], targetSessionId); // For text messages, imageDataArray is empty

      // --- NEW: Context Chat Support for Guests ---
      // If the user is unauthenticated, the backend won't have the session context in DB.
      // We send the marking context from the latest AI message in the frontend state.
      let guestMarkingContext = null;
      if (!user && liveSession?.messages) {
        const lastMarkingMessage = [...liveSession.messages].reverse().find(msg => msg.markingContext);
        if (lastMarkingMessage) {
          guestMarkingContext = lastMarkingMessage.markingContext;
        }
      }

      // Determine usageMode for prompt weighting
      let usageMode = isModelAnswerMode ? 'model-answer' : isMarkingSchemeMode ? 'marking-scheme' : 'chat';
      const followUpModel = getSessionModel(liveSession) || selectedModel || 'fast';

      const response = await apiClient.post('/api/messages/chat', {
        message: trimmedText,
        messageId: userMessageId, // Pass the local user message ID to backend
        model: followUpModel,
        sessionId: targetSessionId,
        markingContext: guestMarkingContext, // Send context for guest users
        aiMessageId: aiMessageId, // Pass the AI message ID to backend
        contextQuestionId: effectiveQuestionId, // Pass the active or overridden context
        mode: usageMode // Pass current mode to backend
      });

      const data = response.data;

      if (data.success) {
        // Use the new standardized completion handler
        simpleSessionService.handleTextChatComplete(data, followUpModel, targetSessionId);
      } else {
        throw new Error(data.error || 'Failed to get AI response');
      }

      // Reset the request flag on success
      textRequestInProgress.current = false;
      return true;
    } catch (err) {
      const guestCheck = extractGuestLimitError(err);
      if (guestCheck.isGuestLimit) {
        stopAIThinking(targetSessionId);
        stopProcessing(targetSessionId);
        setGuestLimitInfo({
          usageCount: guestCheck.usageCount,
          usageLimit: guestCheck.usageLimit,
          resetAt: guestCheck.resetAt
        });
        setShowGuestLimitModal(true);
        textRequestInProgress.current = false;

        // If this session has no completed AI responses, clean up the dead chat view
        const liveSessionAfter = simpleSessionService.getCurrentSession();
        if (!hasCompletedAITurn(liveSessionAfter)) {
          clearSession();
          dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
        }
        return false;
      } else if (err.credits_exhausted || err.response?.data?.credits_exhausted || err?.message?.includes('exhausted your credits')) {
        setShowCreditsModal(true);
        refreshCredits();
      }
      handleError(err);
      stopAIThinking(targetSessionId);
      stopProcessing(targetSessionId);
      textRequestInProgress.current = false;
      return false;
    }
  }, [
    user, isNegative, checkNegativeCredits, getAuthToken, currentSession, chatMessages, selectedModel,
    activeQuestionId, activeImageIndex, splitModeImages, isModelAnswerMode, isMarkingSchemeMode,
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

    if (await checkNegativeCredits()) {
      return false;
    }

    const liveSession = simpleSessionService.getCurrentSession() || currentSession;
    const existingStableSessionId = liveSession?.id && !liveSession.id.startsWith('temp-') ? liveSession.id : null;
    const clientSubmissionId = existingStableSessionId || `session-model-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const initializedSession = simpleSessionService.initClientSession(
        clientSubmissionId,
        existingStableSessionId ? liveSession.title : 'Processing...'
      );
      if (!existingStableSessionId && initializedSession && !clientSubmissionId.startsWith('temp-')) {
        simpleSessionService.updateSidebarSession(initializedSession);
      }
      if (!existingStableSessionId || routeSessionId !== clientSubmissionId) {
        navigate(`/app/${clientSubmissionId}`, { replace: true });
      }
      startProcessing(clientSubmissionId);

      const userMessageId = `user-${Date.now()}`;
      await addMessage({
        id: userMessageId,
        role: 'user',
        content: `Generate model answers for: ${trimmedInput}`,
        timestamp: new Date().toISOString(),
        type: 'text'
      }, clientSubmissionId);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });

      // Generate AI message ID
      const aiMessageId = createAIMessageId(`model-${trimmedInput}-${Date.now()}`);

      const progressData = {
        isComplete: false,
        currentStepDescription: 'Finding exam paper...',
        allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is writing model answers...'],
        currentStepIndex: 0,
      };

      registerJob({
        sessionId: clientSubmissionId,
        title: existingStableSessionId ? liveSession.title : 'Processing...',
        progressData
      });
      startAIThinking(progressData, aiMessageId, [], clientSubmissionId);

      // IMMEDIATELY hide the ribbon - we know this is model-answer before SSE completes.
      // The session object won't have usageMode set yet (backend does that), so set eagerly.
      setIsModelAnswerMode(true);
      setIsMarkingSchemeMode(false);
      // Mark session as synced so the useEffect doesn't overwrite this on next fire
      lastSyncedModeSessionId.current = clientSubmissionId;

      // Call the new SSE endpoint
      apiProcessor.processStreamRequest(
        '/api/model-answer',
        {
          paper: trimmedInput,
          model: selectedModel || 'fast',
          sessionId: clientSubmissionId,
          aiMessageId: aiMessageId
        },
        // Step mapping
        {
          'retrieving_paper': 0,
          'retrieving_schemes': 1,
          'generating': 2
        },
        (nextProgress) => updateJobProgress(clientSubmissionId, nextProgress)
      ).then((result) => {
        const liveAfter = simpleSessionService.getCurrentSession();
        const resolvedTitle =
          result?.sessionTitle ||
          result?.session?.title ||
          result?.unifiedSession?.title ||
          (liveAfter?.id === clientSubmissionId ? liveAfter?.title : undefined) ||
          `Model Answer: ${trimmedInput}`;
        completeJob(clientSubmissionId, resolvedTitle);
        refreshCredits();
      }).catch(err => {
        if (err?.isTransportDisconnect) {
          startPollingJob(clientSubmissionId);
          return;
        }
        failJob(clientSubmissionId, err?.message || 'Failed to generate model answers');

        const guestCheck = extractGuestLimitError(err);
        if (guestCheck.isGuestLimit) {
          pendingUploadRef.current = { type: 'model_answer', paper: trimmedInput };
          setGuestLimitInfo({
            usageCount: guestCheck.usageCount,
            usageLimit: guestCheck.usageLimit,
            resetAt: guestCheck.resetAt
          });
          setShowGuestLimitModal(true);

          const liveSessionAfter = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSessionAfter)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            navigate('/app', { replace: true });
          }
        } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
          setShowCreditsModal(true);
        } else {
          handleError(err);
          const liveSessionAfter = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSessionAfter)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            navigate('/app', { replace: true });
          }
        }
        stopAIThinking(clientSubmissionId);
        stopProcessing(clientSubmissionId);
      });

      return true;
    } catch (err) {
      failJob(clientSubmissionId, err?.message || 'Failed to generate model answers');
      handleError(err);
      stopAIThinking(clientSubmissionId);
      stopProcessing(clientSubmissionId);
      return false;
    }
  }, [user, isNegative, checkNegativeCredits, selectedModel, currentSession, routeSessionId, navigate, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, handleError, apiProcessor, registerJob, updateJobProgress, completeJob, failJob, startPollingJob, refreshCredits]);

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

    if (await checkNegativeCredits()) {
      return false;
    }

    const liveSession = simpleSessionService.getCurrentSession() || currentSession;
    const existingStableSessionId = liveSession?.id && !liveSession.id.startsWith('temp-') ? liveSession.id : null;
    const clientSubmissionId = existingStableSessionId || `session-marking-scheme-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    try {
      const initializedSession = simpleSessionService.initClientSession(
        clientSubmissionId,
        existingStableSessionId ? liveSession.title : 'Processing...'
      );
      if (!existingStableSessionId && initializedSession && !clientSubmissionId.startsWith('temp-')) {
        simpleSessionService.updateSidebarSession(initializedSession);
      }
      if (!existingStableSessionId || routeSessionId !== clientSubmissionId) {
        navigate(`/app/${clientSubmissionId}`, { replace: true });
      }
      startProcessing(clientSubmissionId);

      const userMessageId = `user-${Date.now()}`;
      await addMessage({
        id: userMessageId,
        role: 'user',
        content: `Explain marking scheme for: ${trimmedInput}`,
        timestamp: new Date().toISOString(),
        type: 'text'
      }, clientSubmissionId);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });

      // Generate AI message ID
      const aiMessageId = createAIMessageId(`marking-scheme-${trimmedInput}-${Date.now()}`);

      const progressData = {
        isComplete: false,
        currentStepDescription: 'Finding exam paper...',
        allSteps: ['Finding exam paper...', 'Loading marking schemes...', 'AI is explaining marking scheme...'],
        currentStepIndex: 0,
      };

      registerJob({
        sessionId: clientSubmissionId,
        title: existingStableSessionId ? liveSession.title : 'Processing...',
        progressData
      });
      startAIThinking(progressData, aiMessageId, [], clientSubmissionId);

      // IMMEDIATELY hide the ribbon - we know this is marking-scheme before SSE completes.
      setIsMarkingSchemeMode(true);
      setIsModelAnswerMode(false);
      // Mark session as synced so the useEffect doesn't overwrite this on next fire
      lastSyncedModeSessionId.current = clientSubmissionId;

      // Call the new SSE endpoint
      apiProcessor.processStreamRequest(
        '/api/marking-scheme',
        {
          paper: trimmedInput,
          model: selectedModel || 'fast',
          sessionId: clientSubmissionId,
          aiMessageId: aiMessageId
        },
        // Step mapping
        {
          'retrieving_paper': 0,
          'retrieving_schemes': 1,
          'generating': 2
        },
        (nextProgress) => updateJobProgress(clientSubmissionId, nextProgress)
      ).then((result) => {
        const liveAfter = simpleSessionService.getCurrentSession();
        const resolvedTitle =
          result?.sessionTitle ||
          result?.session?.title ||
          result?.unifiedSession?.title ||
          (liveAfter?.id === clientSubmissionId ? liveAfter?.title : undefined) ||
          `Marking Scheme: ${trimmedInput}`;
        completeJob(clientSubmissionId, resolvedTitle);
        refreshCredits();
      }).catch(err => {
        if (err?.isTransportDisconnect) {
          startPollingJob(clientSubmissionId);
          return;
        }
        failJob(clientSubmissionId, err?.message || 'Failed to retrieve marking scheme');

        const guestCheck = extractGuestLimitError(err);
        if (guestCheck.isGuestLimit) {
          pendingUploadRef.current = { type: 'marking_scheme', paper: trimmedInput };
          setGuestLimitInfo({
            usageCount: guestCheck.usageCount,
            usageLimit: guestCheck.usageLimit,
            resetAt: guestCheck.resetAt
          });
          setShowGuestLimitModal(true);

          const liveSessionAfter = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSessionAfter)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            navigate('/app', { replace: true });
          }
        } else if (err.credits_exhausted || err.response?.data?.credits_exhausted) {
          setShowCreditsModal(true);
        } else {
          handleError(err);
          const liveSessionAfter = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSessionAfter)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            navigate('/app', { replace: true });
          }
        }
        stopAIThinking(clientSubmissionId);
        stopProcessing(clientSubmissionId);
      });

      return true;
    } catch (err) {
      failJob(clientSubmissionId, err?.message || 'Failed to retrieve marking scheme');
      handleError(err);
      stopAIThinking(clientSubmissionId);
      stopProcessing(clientSubmissionId);
      return false;
    }
  }, [user, isNegative, checkNegativeCredits, selectedModel, currentSession, routeSessionId, navigate, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, handleError, apiProcessor, registerJob, updateJobProgress, completeJob, failJob, startPollingJob, refreshCredits]);

  // Ref to track the last handled session ID to prevent redundant scrolls on every message update
  const lastHandledSessionIdRef = useRef(null);

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
      setPendingConfirmationMode('model');
      setShowModelAnswerConfirmation(true);

      // [FIX] Clear URL parameters using Router to prevent re-triggering
      navigate(location.pathname, { replace: true });
    } else if ((mode === 'markingscheme' || mode === 'marking-scheme' || mode === 'mark') && paper) {
      setIsMarkingSchemeMode(true);
      setIsModelAnswerMode(false); // Reset other mode
      setInitialInput(paper);
      // For marking scheme, trigger via confirmation modal
      setPendingModelAnswerPaper(paper);
      setPendingConfirmationMode('markingscheme');
      setShowModelAnswerConfirmation(true);

      // [FIX] Clear URL parameters using Router to prevent re-triggering
      navigate(location.pathname, { replace: true });
    }
  }, [location.search, location.pathname, navigate]);

  useEffect(() => {
    const expectedSessionId = routeSessionId || selectedMarkingResult?.id;
    if (!expectedSessionId) {
      lastHandledSessionIdRef.current = null;
      return;
    }
    if (isHistoryLoading) {
      // User explicitly clicked a history item (possibly even the currently open session):
      // clear lastHandledSessionIdRef so we always re-focus the last assistant bubble once loaded.
      lastHandledSessionIdRef.current = null;
      return;
    }
    if (currentSession?.id !== expectedSessionId) {
      return;
    }
    if (lastHandledSessionIdRef.current === currentSession.id) {
      return;
    }

    const sessionMsgs = (currentSession.messages && currentSession.messages.length > 0)
      ? currentSession.messages
      : (chatMessages || []);
    if (sessionMsgs.length === 0) {
      return;
    }

    const isSessionActivelyProcessing = Boolean(
      isCurrentSessionProcessing ||
      isCurrentSessionThinking ||
      sessionMsgs.some(m => m.isProcessing)
    );

    const reversedMsgs = [...sessionMsgs].reverse();
    const processingAssistantMessage = reversedMsgs.find(m => m.role === 'assistant' && m.isProcessing);
    const lastAssistantMessage = reversedMsgs.find(m => m.role === 'assistant');
    const lastUserMessage = reversedMsgs.find(m => m.role === 'user');

    const targetMsg = isSessionActivelyProcessing
      ? (processingAssistantMessage || lastUserMessage)
      : (lastAssistantMessage || reversedMsgs[0]);

    if (!targetMsg) {
      return;
    }

    let cancelled = false;
    let rafId1 = null;
    let rafId2 = null;

    const attemptFocus = () => {
      if (cancelled) return false;
      const didScroll = isSessionActivelyProcessing
        ? scrollToMessage(targetMsg.id, { behavior: 'smooth', block: 'start' })
        : (typeof focusMessageWithStabilization === 'function'
            ? focusMessageWithStabilization(targetMsg.id, { behavior: 'auto', block: 'start', stabilizeMs: 1200 })
            : scrollToMessage(targetMsg.id, { behavior: 'auto', block: 'start' }));

      if (didScroll) {
        lastHandledSessionIdRef.current = currentSession.id;
        return true;
      }
      return false;
    };

    // Wait for React commit + layout paint (and split-view transition) before instant jump
    rafId1 = requestAnimationFrame(() => {
      if (attemptFocus()) return;
      rafId2 = requestAnimationFrame(() => {
        attemptFocus();
      });
    });

    return () => {
      cancelled = true;
      if (rafId1 !== null) cancelAnimationFrame(rafId1);
      if (rafId2 !== null) cancelAnimationFrame(rafId2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentSession?.id,
    chatMessages.length,
    chatContainerElement,
    isHistoryLoading,
    selectedMarkingResult,
    routeSessionId,
    focusMessageWithStabilization,
    scrollToMessage,
  ]);

  const handleImageAnalysis = useCallback(async (file = null, customText = null) => {
    const targetFile = file || selectedFile;
    if (!targetFile) return;
    lastUploadedStudentFilesRef.current = [targetFile];

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
    if (await checkNegativeCredits()) {
      if (typeof clearFile === 'function') clearFile();
      return false;
    }

    const liveSession = simpleSessionService.getCurrentSession();
    const existingStableSessionId = liveSession?.id && !liveSession.id.startsWith('temp-') ? liveSession.id : null;
    const clientSubmissionId = existingStableSessionId || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      userClosedSplitSessionIdRef.current = null;
      const initializedSession = simpleSessionService.initClientSession(
        clientSubmissionId,
        existingStableSessionId ? liveSession.title : 'Processing...'
      );
      if (!existingStableSessionId && initializedSession && !clientSubmissionId.startsWith('temp-')) {
        simpleSessionService.updateSidebarSession(initializedSession);
      }
      startProcessing(clientSubmissionId);
      if (!existingStableSessionId || routeSessionId !== clientSubmissionId) {
        navigate(`/app/${clientSubmissionId}`, { replace: true });
      }
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
      await addMessage(optimisticMessage, clientSubmissionId);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });
      // Generate unique AI message ID for image processing
      const imageAiMessageId = createAIMessageId(imageData);

      const imageProgressData = {
        isComplete: false,
        currentStepDescription: 'Analyzing image...',
        allSteps: MARKING_PIPELINE_STEPS,
        currentStepIndex: 0,
      };

      registerJob({
        sessionId: clientSubmissionId,
        title: existingStableSessionId ? liveSession.title : 'Processing...',
        progressData: imageProgressData
      });
      startAIThinking(imageProgressData, imageAiMessageId, [imageData], clientSubmissionId);

      // Execute API call in background so UI resets immediately
      processImageAPI(
        imageData,
        selectedModel,
        'marking',
        customText || undefined,
        imageAiMessageId,
        targetFile.name,
        { submissionId: clientSubmissionId },
        (progressData) => updateJobProgress(clientSubmissionId, progressData)
      )
        .then((result) => {
          const liveAfter = simpleSessionService.getCurrentSession();
          const resolvedTitle =
            result?.sessionTitle ||
            result?.session?.title ||
            result?.unifiedSession?.title ||
            (liveAfter?.id === clientSubmissionId ? liveAfter?.title : undefined);
          completeJob(clientSubmissionId, resolvedTitle);
          refreshCredits();
        })
        .catch(err => {
          if (err?.isTransportDisconnect) {
            startPollingJob(clientSubmissionId);
            return;
          }
          failJob(clientSubmissionId, err?.message || 'Marking failed');

          const guestCheck = extractGuestLimitError(err);
          if (guestCheck.isGuestLimit) {
            stopAIThinking(clientSubmissionId);
            stopProcessing(clientSubmissionId);
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
          } else if (err.credits_exhausted || err.response?.data?.credits_exhausted || err?.message?.includes('exhausted your credits')) {
            setShowCreditsModal(true);
            refreshCredits();
          }

          trackFunnelEvent('upload_failed_client_seen', {
            errorMessage: err?.response?.data?.error || err?.message || 'Unknown upload error'
          }, user?.uid);
          handleError(err);
          const liveSessionAfter = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSessionAfter)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            navigate('/app', { replace: true });
          }
          stopAIThinking(clientSubmissionId);
          stopProcessing(clientSubmissionId);
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
      } else if (err.credits_exhausted || err.response?.data?.credits_exhausted || err?.message?.includes('exhausted your credits')) {
        setShowCreditsModal(true);
        refreshCredits();
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
  }, [user, isNegative, checkNegativeCredits, selectedFile, selectedModel, activeQuestionId, routeSessionId, navigate, processImage, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processImageAPI, clearFile, handleError, registerJob, updateJobProgress, completeJob, failJob, startPollingJob, refreshCredits]);

  const handleMultiImageAnalysis = useCallback(async (files = [], customText = null, extraParams = null) => {
    if (!files || files.length === 0) return;
    const liveSessionBeforeMerge = simpleSessionService.getCurrentSession() || currentSession;
    const sessionMsgsBeforeMerge = liveSessionBeforeMerge?.messages || chatMessages || [];
    const hasCompletedMarkingBeforeMerge = sessionMsgsBeforeMerge.some(m => m?.role === 'assistant' && Boolean(m?.markingContext));
    const hasPendingUnmarkedPaper =
      !extraParams?.skipSessionMerge &&
      !extraParams?.isPaperGroupSubset &&
      !hasCompletedMarkingBeforeMerge &&
      sessionMsgsBeforeMerge.some(
        m => m?.role === 'assistant' && (m?.requiresMarkingScheme === true || m?.isPreCheckPause === true || m?.canStartMarkingFromPreCheck === true)
      );

    // If the student already uploaded an unmarked paper in this session (e.g. paused / awaiting mark scheme)
    // and now uploads the Mark Scheme via the bottom chat bar, automatically pair it with the stashed student paper!
    let effectiveFiles = Array.from(files);
    if (hasPendingUnmarkedPaper && lastUploadedStudentFilesRef.current && lastUploadedStudentFilesRef.current.length > 0) {
      const combined = [...lastUploadedStudentFilesRef.current, ...effectiveFiles];
      const seenKeys = new Set();
      effectiveFiles = combined.filter(f => {
        if (!f) return false;
        const key = `${(f.name || '').trim().toLowerCase()}::${f.size || 0}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
    }

    if (!extraParams?.isPaperGroupSubset) {
      lastUploadedStudentFilesRef.current = effectiveFiles;
    }
    files = effectiveFiles;

    trackFunnelEvent('upload_initiated', {
      mode: 'multi',
      fileCount: files.length,
      fileTypes: files.map(f => f?.type || f?.name?.split('.').pop() || 'unknown'),
      totalBytes: files.reduce((sum, f) => sum + (f?.size || 0), 0)
    }, user?.uid);

    // --- INSTANT GUEST GATE (0ms response, avoids uploading large PDFs/images before auth) ---
    if (!user) {
      pendingUploadRef.current = { type: 'multi', files, customText, extraParams };
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
    if (await checkNegativeCredits()) {
      if (typeof clearFile === 'function') clearFile();
      return false;
    }

    const liveSession = simpleSessionService.getCurrentSession();
    const existingStableSessionId = liveSession?.id && !liveSession.id.startsWith('temp-') ? liveSession.id : null;
    const clientSubmissionId = existingStableSessionId || `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      userClosedSplitSessionIdRef.current = null;
      const initializedSession = simpleSessionService.initClientSession(
        clientSubmissionId,
        existingStableSessionId ? liveSession.title : 'Processing...'
      );
      if (!existingStableSessionId && initializedSession && !clientSubmissionId.startsWith('temp-')) {
        simpleSessionService.updateSidebarSession(initializedSession);
      }
      startProcessing(clientSubmissionId);
      if (!existingStableSessionId || routeSessionId !== clientSubmissionId) {
        navigate(`/app/${clientSubmissionId}`, { replace: true });
      }

      // Separate PDFs and Images so mixed uploads display properly
      const isPdfFile = (file) => file?.type === 'application/pdf' || (file?.name || '').toLowerCase().endsWith('.pdf');
      const pdfFiles = files.filter(isPdfFile);
      const imageFiles = files.filter(file => !isPdfFile(file));
      const hasPDFs = pdfFiles.length > 0;
      const hasImages = imageFiles.length > 0;

      let pdfContexts = [];
      let imageDataArray = [];

      if (hasPDFs) {
        // Create direct Blob URLs for immediate display (0-copy, avoids Base64 memory bloat and data URL length limits)
        pdfContexts = pdfFiles.map((file) => ({
          originalFileName: file.name,
          fileSize: file.size, // Use bytes (number) to match imageDataArray structure
          url: URL.createObjectURL(file)
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
      await addMessage(optimisticMessage, clientSubmissionId);
      dispatch({ type: 'SET_PAGE_MODE', payload: 'chat' });

      // Generate unique AI message ID for multi-image processing
      const multiImageAiMessageId = createAIMessageId(`multi-${Date.now()}`);

      const multiImageProgressData = {
        isComplete: false,
        currentStepDescription: `Processing ${files.length} image(s)...`,
        allSteps: MARKING_PIPELINE_STEPS,
        currentStepIndex: 0,
      };

      const thinkingImages = [
        ...(optimisticMessage.pdfContexts || []),
        ...(optimisticMessage.imageDataArray || [])
      ];
      registerJob({
        sessionId: clientSubmissionId,
        title: existingStableSessionId ? liveSession.title : 'Processing...',
        progressData: multiImageProgressData
      });
      startAIThinking(multiImageProgressData, multiImageAiMessageId, thinkingImages, clientSubmissionId);

      // Execute API call in background so UI resets immediately
      processMultiImageAPI(
        files,
        selectedModel,
        'marking',
        customText || undefined,
        multiImageAiMessageId,
        { ...(extraParams || {}), submissionId: clientSubmissionId },
        (progressData) => updateJobProgress(clientSubmissionId, progressData)
      )
        .then((result) => {
          const liveAfter = simpleSessionService.getCurrentSession();
          const resolvedTitle =
            result?.sessionTitle ||
            result?.session?.title ||
            result?.unifiedSession?.title ||
            (liveAfter?.id === clientSubmissionId ? liveAfter?.title : undefined);
          completeJob(clientSubmissionId, resolvedTitle);
          refreshCredits();
        })
        .catch(err => {
          if (err?.isTransportDisconnect) {
            startPollingJob(clientSubmissionId);
            return;
          }
          failJob(clientSubmissionId, err?.message || 'Marking failed');

          const guestCheck = extractGuestLimitError(err);
          if (guestCheck.isGuestLimit) {
            stopAIThinking(clientSubmissionId);
            stopProcessing(clientSubmissionId);
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
          } else if (err.credits_exhausted || err.response?.data?.credits_exhausted || err?.message?.includes('exhausted your credits')) {
            setShowCreditsModal(true);
            refreshCredits();
          }

          trackFunnelEvent('upload_failed_client_seen', {
            errorMessage: err?.response?.data?.error || err?.message || 'Unknown upload error'
          }, user?.uid);
          handleError(err);
          const liveSessionAfter = simpleSessionService.getCurrentSession();
          if (!hasCompletedAITurn(liveSessionAfter)) {
            clearSession();
            dispatch({ type: 'SET_PAGE_MODE', payload: 'upload' });
            navigate('/app', { replace: true });
          }
          stopAIThinking(clientSubmissionId);
          stopProcessing(clientSubmissionId);
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
      } else if (err.credits_exhausted || err.response?.data?.credits_exhausted || err?.message?.includes('exhausted your credits')) {
        setShowCreditsModal(true);
        refreshCredits();
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
  }, [user, isNegative, checkNegativeCredits, currentSession, chatMessages, selectedModel, routeSessionId, navigate, addMessage, clearSession, startProcessing, stopProcessing, startAIThinking, stopAIThinking, processMultiImageAPI, clearFile, handleError, registerJob, updateJobProgress, completeJob, failJob, startPollingJob, refreshCredits]);

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

  const remarkWithOfficialPaper = useCallback(async ({ sessionId, paperTitle, questionNumber }) => {
    const liveSession = simpleSessionService.getCurrentSession() || currentSession;
    const targetSessionId = sessionId || liveSession?.id;
    if (!targetSessionId || !paperTitle) return false;

    const allMsgs = liveSession?.messages || chatMessages || [];
    const existingAssistantMsg = [...allMsgs]
      .reverse()
      .find(m => m.role === 'assistant' && (m.performanceSummary || m.studentScore || m.requiresMarkingScheme));
    const snapshotMsg = existingAssistantMsg ? JSON.parse(JSON.stringify(existingAssistantMsg)) : null;
    const targetAiMessageId = existingAssistantMsg?.id || createAIMessageId(`remark-${Date.now()}`);

    const userMsg = allMsgs.find(m => m.role === 'user');
    const skeletonImages = (userMsg?.imageDataArray && userMsg.imageDataArray.length > 0)
      ? userMsg.imageDataArray
      : (existingAssistantMsg?.imageDataArray || []);

    try {
      startProcessing(targetSessionId);
      const progressData = {
        isComplete: false,
        currentStepDescription: `Re-marking with official scheme (${paperTitle})...`,
        allSteps: [
          'Loading cached student work...',
          'Fetching official mark scheme...',
          'Re-marking with official rubric...',
          'Updating grade boundaries & annotations...'
        ],
        currentStepIndex: 0,
      };

      registerJob({
        sessionId: targetSessionId,
        title: liveSession?.title || 'Processing...',
        isRemark: true,
        progressData
      });

      if (existingAssistantMsg) {
        simpleSessionService.updateMessageInCurrentSession(targetAiMessageId, {
          isProcessing: true,
          progressData,
          imageDataArray: skeletonImages,
          remarkError: null
        }, targetSessionId);
      } else {
        startAIThinking(progressData, targetAiMessageId, skeletonImages, targetSessionId);
      }

      const streamResult = await apiProcessor.processStreamRequest(
        '/api/marking/remark-session',
        {
          sessionId: targetSessionId,
          targetSessionId,
          paperTitle,
          questionNumber: questionNumber || null,
          model: selectedModel || 'fast',
          aiMessageId: targetAiMessageId
        },
        {
          'loading_cache': 0,
          'fetching_scheme': 1,
          'marking': 2,
          'generating_output': 3
        },
        (nextProgress) => updateJobProgress(targetSessionId, nextProgress)
      );

      completeJob(
        targetSessionId,
        streamResult?.unifiedSession?.title ||
        streamResult?.sessionTitle ||
        liveSession?.title
      );
      if (streamResult?.unifiedSession && simpleSessionService.getCurrentSession()?.id === targetSessionId) {
        loadSession(streamResult.unifiedSession);
      }
      stopProcessing(targetSessionId);
      return true;
    } catch (err) {
      if (err?.isTransportDisconnect) {
        startPollingJob(targetSessionId);
        return false;
      }
      failJob(targetSessionId, err?.message || 'Failed to re-mark session.');
      if (snapshotMsg) {
        simpleSessionService.updateMessageInCurrentSession(targetAiMessageId, {
          ...snapshotMsg,
          isProcessing: false,
          progressData: snapshotMsg.progressData ? { ...snapshotMsg.progressData, isComplete: true } : undefined,
          remarkError: err?.message || 'Failed to re-mark session.'
        }, targetSessionId);
      }
      handleError(err);
      stopProcessing(targetSessionId);
      return false;
    }
  }, [currentSession, chatMessages, selectedModel, startProcessing, startAIThinking, stopProcessing, handleError, apiProcessor, loadSession, registerJob, updateJobProgress, completeJob, failJob, startPollingJob]);

  const attachMarkingSchemeAndRetry = useCallback(async (schemeFileList) => {
    const rawSchemeFiles = Array.from(schemeFileList || []);
    if (rawSchemeFiles.length === 0) return false;

    const liveSession = simpleSessionService.getCurrentSession() || currentSession;
    const targetSessionId = liveSession?.id;
    const allMsgs = liveSession?.messages || chatMessages || [];
    const existingAssistantMsg = [...allMsgs]
      .reverse()
      .find(m => m.role === 'assistant');
    const snapshotMsg = existingAssistantMsg ? JSON.parse(JSON.stringify(existingAssistantMsg)) : null;

    // Strict client-side format & magic-byte validation (blocks HEIC/BMP/SVG/DOCX/corrupt files before upload)
    const { validFiles: schemeFiles, rejectedFiles, errorMessage: formatErrorMsg } = await validateSupportedUploadFiles(rawSchemeFiles);
    if (rejectedFiles.length > 0 || schemeFiles.length === 0) {
      const msgText = formatErrorMsg || 'Unsupported file format. Please upload a PDF, JPG, PNG, or WebP file.';
      if (existingAssistantMsg && targetSessionId) {
        simpleSessionService.updateMessageInCurrentSession(existingAssistantMsg.id, {
          remarkError: msgText
        }, targetSessionId);
      } else {
        handleError(new Error(msgText));
      }
      return false;
    }

    const userMsg = allMsgs.find(m => m.role === 'user');
    const skeletonImages = (userMsg?.imageDataArray && userMsg.imageDataArray.length > 0)
      ? userMsg.imageDataArray
      : (existingAssistantMsg?.imageDataArray || []);

    const isEarlyRejectedUnsupportedSubject = Boolean(existingAssistantMsg?.requiresMarkingScheme === true);

    if (!isEarlyRejectedUnsupportedSubject && targetSessionId && !targetSessionId.startsWith('temp-')) {
      const targetAiMessageId = existingAssistantMsg?.id || createAIMessageId(`remark-scheme-${Date.now()}`);
      try {
        startProcessing(targetSessionId);
        const progressData = {
          isComplete: false,
          currentStepDescription: 'Validating & parsing uploaded marking scheme...',
          allSteps: [
            'Validating uploaded marking scheme...',
            'Extracting rubric criteria...',
            'Re-marking cached student work...',
            'Updating annotations & summary...'
          ],
          currentStepIndex: 0,
        };

        registerJob({
          sessionId: targetSessionId,
          title: liveSession?.title || 'Processing...',
          isRemark: true,
          progressData
        });

        if (existingAssistantMsg) {
          simpleSessionService.updateMessageInCurrentSession(targetAiMessageId, {
            isProcessing: true,
            progressData,
            imageDataArray: skeletonImages,
            remarkError: null
          }, targetSessionId);
        }

        const fileToBase64Obj = (file) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({
            originalName: file.name,
            mimeType: file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
            base64Data: reader.result
          });
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const uploadedSchemePayloads = await Promise.all(schemeFiles.map(fileToBase64Obj));

        const streamResult = await apiProcessor.processStreamRequest(
          '/api/marking/remark-session',
          {
            sessionId: targetSessionId,
            targetSessionId,
            uploadedSchemeFiles: uploadedSchemePayloads,
            model: selectedModel || 'fast',
            aiMessageId: targetAiMessageId
          },
          {
            'loading_cache': 0,
            'fetching_scheme': 1,
            'marking': 2,
            'generating_output': 3
          },
          (nextProgress) => updateJobProgress(targetSessionId, nextProgress)
        );

        completeJob(
          targetSessionId,
          streamResult?.unifiedSession?.title ||
          streamResult?.sessionTitle ||
          liveSession?.title
        );
        if (streamResult?.unifiedSession && simpleSessionService.getCurrentSession()?.id === targetSessionId) {
          loadSession(streamResult.unifiedSession);
        }
        stopProcessing(targetSessionId);
        return true;
      } catch (err) {
        if (err?.isTransportDisconnect) {
          startPollingJob(targetSessionId);
          return false;
        }
        const cleanRemarkErr = (err?.message || 'Invalid marking scheme uploaded.').replace(/^(?:INVALID_MARKING_SCHEME|UNSUPPORTED_SCHEME_FORMAT):\s*/i, '');
        failJob(targetSessionId, cleanRemarkErr);
        // Restore the exact original assistant message snapshot so nothing is lost
        if (snapshotMsg) {
          simpleSessionService.updateMessageInCurrentSession(targetAiMessageId, {
            ...snapshotMsg,
            isProcessing: false,
            progressData: snapshotMsg.progressData ? { ...snapshotMsg.progressData, isComplete: true } : undefined,
            remarkError: cleanRemarkErr
          }, targetSessionId);
        }
        // Reload persisted Option 1 error history (uploaded scheme + system response) if backend saved it
        try {
          const refreshed = await simpleSessionService.getSession(targetSessionId);
          if (refreshed?.session && simpleSessionService.getCurrentSession()?.id === targetSessionId) {
            loadSession(refreshed.session);
          }
        } catch {
          // Keep restored snapshotMsg with inline remarkError banner
        }
        stopProcessing(targetSessionId);
        return false;
      }
    }

    // Fallback ONLY for early-exit unsupported subjects (where student pages were never OCR'd)
    const studentFiles = await reconstructStudentFiles();
    const rawMergedFiles = [...studentFiles, ...schemeFiles];
    const seenKeys = new Set();
    const mergedFiles = rawMergedFiles.filter(f => {
      if (!f) return false;
      const key = `${(f.name || '').trim().toLowerCase()}::${f.size || 0}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    return handleMultiImageAnalysis(
      mergedFiles,
      `Attached Marking Scheme (${schemeFiles.map(f => f.name).join(', ')}) for grading.`
    );
  }, [currentSession?.id, currentSession?.messages, chatMessages, selectedModel, startProcessing, stopProcessing, handleError, apiProcessor, loadSession, handleMultiImageAnalysis]);

  const reconstructStudentFiles = useCallback(async () => {
    let studentFiles = lastUploadedStudentFilesRef.current || [];
    if (studentFiles.length === 0 && Array.isArray(chatMessages)) {
      const lastUserMsg = [...chatMessages].reverse().find(
        m =>
          m.role === 'user' &&
          (
            (Array.isArray(m.pdfContexts) && m.pdfContexts.length > 0) ||
            (Array.isArray(m.imageDataArray) && m.imageDataArray.length > 0) ||
            Boolean(m.imageData)
          )
      );
      const dataUrlToFile = (dataUrl, name) => {
        try {
          if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
          const [header, b64] = dataUrl.split(',');
          const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
          const bin = atob(b64);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          return new File([arr], name, { type: mime });
        } catch {
          return null;
        }
      };
      if (lastUserMsg) {
        if (Array.isArray(lastUserMsg.pdfContexts) && lastUserMsg.pdfContexts.length > 0) {
          const fetchedPdfs = await Promise.all(
            lastUserMsg.pdfContexts.map(async (pdf, idx) => {
              const name = pdf?.originalFileName || `student-document-${idx + 1}.pdf`;
              if (pdf?.url && pdf.url.startsWith('data:')) {
                return dataUrlToFile(pdf.url, name);
              }
              if (pdf?.url) {
                try {
                  const resp = await fetch(pdf.url);
                  if (!resp.ok) return null;
                  const blob = await resp.blob();
                  return new File([blob], name, { type: 'application/pdf' });
                } catch {
                  return null;
                }
              }
              return null;
            })
          );
          studentFiles = fetchedPdfs.filter(Boolean);
        }
        if (studentFiles.length === 0 && Array.isArray(lastUserMsg.imageDataArray) && lastUserMsg.imageDataArray.length > 0) {
          const reconstructedImgs = await Promise.all(
            lastUserMsg.imageDataArray.map(async (item, idx) => {
              const url = typeof item === 'string' ? item : item?.url;
              const name = (typeof item === 'object' && item?.originalFileName) || `student-page-${idx + 1}.jpg`;
              if (url && url.startsWith('data:')) {
                return dataUrlToFile(url, name);
              }
              if (url) {
                try {
                  const resp = await fetch(url);
                  if (!resp.ok) return null;
                  const blob = await resp.blob();
                  return new File([blob], name, { type: blob.type || 'image/jpeg' });
                } catch {
                  return null;
                }
              }
              return null;
            })
          );
          studentFiles = reconstructedImgs.filter(Boolean);
        } else if (studentFiles.length === 0 && lastUserMsg.imageData) {
          const singleReconstructed = dataUrlToFile(lastUserMsg.imageData, lastUserMsg.fileName || 'student-page-1.jpg');
          if (singleReconstructed) studentFiles = [singleReconstructed];
        }
      }
    }
    return studentFiles;
  }, [chatMessages]);

  const gradeSelectedPaperGroup = useCallback(async (group) => {
    if (!group) return false;
    let allFiles = await reconstructStudentFiles();
    const fileIndices = Array.isArray(group.fileIndices) ? group.fileIndices : [];
    const maxFileIdx = fileIndices.length > 0 ? Math.max(...fileIndices) : -1;

    let selectedFiles = [];
    if (allFiles.length > 0 && maxFileIdx >= 0 && maxFileIdx < allFiles.length) {
      selectedFiles = fileIndices.map(idx => allFiles[idx]).filter(Boolean);
    } else if (Array.isArray(group.storageUrls) && group.storageUrls.length > 0) {
      const fetched = await Promise.all(
        group.storageUrls.map(async (url, idx) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            const isPdf = blob.type === 'application/pdf' || url.toLowerCase().includes('.pdf');
            return new File(
              [blob],
              `${(group.label || 'paper').replace(/[^a-zA-Z0-9_-]/g, '_')}-page-${idx + 1}.${isPdf ? 'pdf' : 'jpg'}`,
              { type: blob.type || (isPdf ? 'application/pdf' : 'image/jpeg') }
            );
          } catch {
            return null;
          }
        })
      );
      selectedFiles = fetched.filter(Boolean);
    } else if (allFiles.length > 0) {
      selectedFiles = allFiles;
    }

    if (selectedFiles.length === 0) {
      console.warn('No files available for selected paper group:', group);
      return false;
    }

    const isSameFileSubsetByPage =
      allFiles.length > 0 &&
      selectedFiles.length === allFiles.length &&
      Array.isArray(group.rawPageIndices) &&
      group.rawPageIndices.length > 0;

    return handleMultiImageAnalysis(
      selectedFiles,
      `Grading ${group.label} (${group.pageCount} pages).`,
      {
        isPaperGroupSubset: true,
        ...(isSameFileSubsetByPage ? { selectedRawPageIndices: JSON.stringify(group.rawPageIndices) } : {})
      }
    );
  }, [reconstructStudentFiles, handleMultiImageAnalysis]);

  const gradeWithGeneralRubric = useCallback(async () => {
    const studentFiles = await reconstructStudentFiles();
    if (studentFiles.length === 0) {
      console.warn('No student files available to grade with general rubric.');
      return false;
    }

    return handleMultiImageAnalysis(
      studentFiles,
      'Marking with AI using General Rubric (No official marking scheme attached).',
      { allowGenericSubjectMarking: true }
    );
  }, [reconstructStudentFiles, handleMultiImageAnalysis]);

  const markPaperAnyway = useCallback(async () => {
    const studentFiles = await reconstructStudentFiles();
    if (studentFiles.length === 0) {
      console.warn('No student files available to mark anyway.');
      return false;
    }

    return handleMultiImageAnalysis(
      studentFiles,
      'Mark Paper Anyway.',
      { bypassDuplicateQuestionGuard: true }
    );
  }, [reconstructStudentFiles, handleMultiImageAnalysis]);

  const retryFailedUpload = useCallback(async () => {
    const studentFiles = await reconstructStudentFiles();
    if (studentFiles.length === 0) {
      console.warn('No student files available to retry.');
      return false;
    }

    return handleMultiImageAnalysis(
      studentFiles,
      'Retrying upload.'
    );
  }, [reconstructStudentFiles, handleMultiImageAnalysis]);

  const startMarkingFromPreCheck = useCallback(async (mode = 'attempted_only', customInstructions = '') => {
    const studentFiles = await reconstructStudentFiles();
    if (studentFiles.length === 0) {
      console.warn('No student files available to start marking from pre-check.');
      return false;
    }

    const trimmedInstructions = typeof customInstructions === 'string' ? customInstructions.trim() : '';
    const customText =
      mode === 'custom_instructions' && trimmedInstructions
        ? trimmedInstructions
        : mode === 'attempted_only'
          ? 'Only mark attempted questions'
          : 'Mark Full Paper';

    return handleMultiImageAnalysis(
      studentFiles,
      customText,
      { bypassPreCheckPause: true }
    );
  }, [reconstructStudentFiles, handleMultiImageAnalysis]);

  const value = useMemo(() => ({
    user, pageMode, selectedFile, selectedModel, showInfoDropdown, hoveredRating,
    handleFileSelect, clearFile, handleModelChange, onModelChange: handleModelChange,
    handleImageAnalysis, currentSession, chatMessages, sessionTitle, isFavorite, rating, onFavoriteToggle, onRatingChange, onTitleUpdate,
    setHoveredRating, onToggleInfoDropdown, isProcessing: isCurrentSessionProcessing, isAIThinking: isCurrentSessionThinking, error,
    onSendMessage, addMessage,
    onGenerateModelAnswer,
    onExplainMarkingScheme,
    isModelAnswerMode, setIsModelAnswerMode,
    isMarkingSchemeMode, setIsMarkingSchemeMode,
    initialInput, setInitialInput,
    showModelAnswerConfirmation, setShowModelAnswerConfirmation,
    pendingModelAnswerPaper, setPendingModelAnswerPaper,
    pendingConfirmationMode, setPendingConfirmationMode,
    chatContainerRef,
    isHistoryLoading,
    scrollToBottom,
    showScrollButton,
    hasNewResponse,
    scrollToNewResponse,
    scrollToMessage,
    cancelStabilization,
    onFollowUpImage: handleImageAnalysis,
    onAnalyzeMultiImage: handleMultiImageAnalysis,
    onFollowUpMultiImage: handleMultiImageAnalysis,
    attachMarkingSchemeAndRetry,
    gradeWithGeneralRubric,
    markPaperAnyway,
    retryFailedUpload,
    startMarkingFromPreCheck,
    gradeSelectedPaperGroup,
    remarkWithOfficialPaper,
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
    ensureCredits,
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
    pendingConfirmationMode, setPendingConfirmationMode,
    onFavoriteToggle, onRatingChange, onTitleUpdate, setHoveredRating, onToggleInfoDropdown, isCurrentSessionProcessing, isCurrentSessionThinking, error,
    onSendMessage, addMessage, chatContainerRef,
    isHistoryLoading,
    scrollToBottom, showScrollButton, hasNewResponse, scrollToNewResponse, scrollToMessage, cancelStabilization,
    handleMultiImageAnalysis, attachMarkingSchemeAndRetry, gradeWithGeneralRubric, markPaperAnyway, retryFailedUpload, startMarkingFromPreCheck, gradeSelectedPaperGroup, remarkWithOfficialPaper, progressProps, getImageSrc, startAIThinking,
    splitModeImages, activeImageIndex, enterSplitMode, exitSplitMode, setActiveImageIndex,
    activeQuestionId, setActiveQuestionId, isQuestionTableVisible, setQuestionTableVisibility,
    isContextFilterActive, setContextFilterActive,
    state.visibleTableIds,
    isNegative,
    setShowCreditsModal,
    showCreditsModal, credits, refreshCredits, ensureCredits,
    setSidebarOpen,
    guestLimitInfo,
    lastHandledSessionIdRef
  ]);

  // Track if a user refreshes or closes the browser tab while an upload/marking is actively running
  useEffect(() => {
    if (!isCurrentSessionProcessing && !isCurrentSessionThinking) return;

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
  }, [isCurrentSessionProcessing, isCurrentSessionThinking, progressProps.loadingMessage, progressProps.currentStepIndex, pageMode, user?.uid]);

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

  // --- Auto-Resume after login OR restore attached files if guest closed /login ---
  useEffect(() => {
    if (authLoading) return;

    const restoreStashedFile = (item, filename, mimeType) => {
      const resolvedName = filename || item?.name || 'upload';
      const fallbackMime = resolvedName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

      if (item?.buffer instanceof ArrayBuffer || ArrayBuffer.isView(item?.buffer)) {
        return new File([item.buffer], resolvedName, { type: mimeType || item.type || fallbackMime });
      }

      const base64 = typeof item === 'string' ? item : item?.base64;
      if (!base64) return null;
      const parts = base64.split(',');
      const rawBase64 = parts.length > 1 ? parts[1] : parts[0];
      const detectedMime = mimeType || item?.type || (parts[0].match(/:(.*?);/)?.[1]) || fallbackMime;
      const bstr = atob(rawBase64);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], resolvedName, { type: detectedMime });
    };

    if (user?.uid) {
      // 1. If user just completed 1-click Google sign-in directly inside GuestLimitModal,
      // their pending upload is still in memory — resume it immediately without IndexedDB round-trip.
      if (pendingUploadRef.current) {
        const inMemoryPending = pendingUploadRef.current;
        pendingUploadRef.current = null;
        setShowGuestLimitModal(false);

        trackFunnelEvent('post_login_stash_check', {
          hasStashedData: true,
          stashType: `in_memory_${inMemoryPending.type || 'unknown'}`,
          fileCount: inMemoryPending.files?.length || (inMemoryPending.file ? 1 : 0),
          paper: inMemoryPending.paper || null,
          navType: 'in_place_google_auth'
        }, user.uid);

        setTimeout(() => {
          if (inMemoryPending.type === 'multi' && Array.isArray(inMemoryPending.files) && inMemoryPending.files.length > 0) {
            resumeHandlersRef.current.handleMultiImageAnalysis(inMemoryPending.files, inMemoryPending.customText, inMemoryPending.extraParams);
          } else if (inMemoryPending.type === 'single' && inMemoryPending.file) {
            resumeHandlersRef.current.handleImageAnalysis(inMemoryPending.file, inMemoryPending.customText);
          } else if (inMemoryPending.type === 'model_answer' && inMemoryPending.paper) {
            resumeHandlersRef.current.onGenerateModelAnswer(inMemoryPending.paper);
          } else if (inMemoryPending.type === 'marking_scheme' && inMemoryPending.paper) {
            resumeHandlersRef.current.onExplainMarkingScheme(inMemoryPending.paper);
          }
        }, 300);
        return;
      }

      retrieveAndClearStash().then((stashedData) => {
        trackFunnelEvent('post_login_stash_check', {
          hasStashedData: Boolean(stashedData),
          stashType: stashedData?.type || null,
          fileCount: stashedData?.files?.length || (stashedData?.buffer || stashedData?.base64 ? 1 : 0),
          paper: stashedData?.paper || null,
          navType: getNavigationType()
        }, user.uid);

        if (stashedData) {
          console.log("Recovered stashed data after login, auto-resuming...");

          setTimeout(() => {
            if ((stashedData.type === 'multi_buffer' || stashedData.type === 'multi_base64') && Array.isArray(stashedData.files)) {
              const files = stashedData.files.map(f => restoreStashedFile(f, f.name, f.type)).filter(Boolean);
              if (files.length > 0) {
                resumeHandlersRef.current.handleMultiImageAnalysis(files, stashedData.customText);
              }
            } else if ((stashedData.type === 'single_buffer' || stashedData.type === 'single_base64') && (stashedData.buffer || stashedData.base64)) {
              const file = restoreStashedFile(stashedData, stashedData.fileName, stashedData.mimeType);
              if (file) {
                resumeHandlersRef.current.handleImageAnalysis(file, stashedData.customText);
              }
            } else if (stashedData.type === 'model_answer' && stashedData.paper) {
              resumeHandlersRef.current.onGenerateModelAnswer(stashedData.paper);
            } else if (stashedData.type === 'marking_scheme' && stashedData.paper) {
              resumeHandlersRef.current.onExplainMarkingScheme(stashedData.paper);
            }
          }, 500);
        }
      }).catch(console.error);
    } else {
      // Guest returned from /login without signing in (e.g. clicked Close/X):
      // restore their stashed attached file(s) back into the composer instead of losing them!
      retrieveAndClearStash().then((stashedData) => {
        if (!stashedData) return;
        let restoredFiles = [];
        if ((stashedData.type === 'multi_buffer' || stashedData.type === 'multi_base64') && Array.isArray(stashedData.files)) {
          restoredFiles = stashedData.files.map(f => restoreStashedFile(f, f.name, f.type)).filter(Boolean);
        } else if ((stashedData.type === 'single_buffer' || stashedData.type === 'single_base64') && (stashedData.buffer || stashedData.base64)) {
          const single = restoreStashedFile(stashedData, stashedData.fileName, stashedData.mimeType);
          if (single) restoredFiles = [single];
        }
        if (restoredFiles.length > 0) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('restoreStashedFiles', {
              detail: {
                files: restoredFiles,
                customText: stashedData.customText || ''
              }
            }));
          }, 100);
        }
      }).catch(console.error);
    }
  }, [user?.uid, authLoading]);

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
        fileCount={pendingUploadRef.current?.files?.length || (pendingUploadRef.current?.file ? 1 : 0)}
        requestType={
          pendingUploadRef.current?.type ||
          (isModelAnswerMode ? 'model_answer' : (isMarkingSchemeMode ? 'marking_scheme' : 'marking'))
        }
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
        onDirectAuthSuccess={() => {
          // Keep pendingUploadRef.current intact so the post-login useEffect auto-resumes it immediately
          setShowGuestLimitModal(false);
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

          // Store File(s) as binary ArrayBuffers in IndexedDB (avoids Base64 memory bloat while remaining iOS Safari safe) BEFORE redirect
          if (pendingUploadRef.current) {
            try {
              const uploadData = pendingUploadRef.current;

              if (uploadData.type === 'single' && uploadData.file) {
                const buffer = await uploadData.file.arrayBuffer();
                await stashUploadData({
                  type: 'single_buffer',
                  fileName: uploadData.file.name,
                  mimeType: uploadData.file.type || (uploadData.file.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                  buffer,
                  customText: uploadData.customText
                });
              } else if (uploadData.type === 'multi' && Array.isArray(uploadData.files)) {
                const bufferedFiles = await Promise.all(uploadData.files.map(async (f) => ({
                  name: f.name,
                  type: f.type || (f.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
                  buffer: await f.arrayBuffer()
                })));
                await stashUploadData({
                  type: 'multi_buffer',
                  files: bufferedFiles,
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

