/**
 * MainLayout Component (TypeScript)
 * This is the definitive version with the fix for the re-mounting bug.
 */
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import ReactDOM from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import SessionManagement from './SessionManagement';
import FollowUpChatInput from '../chat/FollowUpChatInput';
import ChatMessage from '../focused/ChatMessage';
import type { UnifiedMessage } from '../../types';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { ensureStringContent } from '../../utils/contentUtils';
import { getSessionImages } from '../../utils/imageCollectionUtils';
import { useQuestionGrouping } from '../../hooks/useQuestionGrouping';
import './css/ChatInterface.css';
import './css/ImageUploadInterface.css';
import '../common/LoadingSpinner.css';
import QuestionNavigator from './QuestionNavigator';
import SEO from '../common/SEO';
import ImageViewer from '../common/ImageViewer';
import { analyticsService } from '../../services/AnalyticsService';
import { engagementTracker } from '../../utils/engagementTracker';

const productSchema = {
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "AI Marking",
  "description": "AI-powered marking for GCSE Maths papers. Get instant grades and step-by-step logic analysis.",
  "brand": {
    "@type": "Brand",
    "name": "AI Marking"
  },
  "offers": {
    "@type": "Offer",
    "url": "https://aimarking.ai",
    "priceCurrency": "GBP",
    "availability": "https://schema.org/InStock"
  }
};

interface MainLayoutProps {
  noIndex?: boolean;
}

const MainLayout: React.FC<MainLayoutProps> = ({ noIndex = false }) => {
  const {
    isProcessing,
    selectedModel,
    onModelChange,
    chatMessages,
    chatContainerRef,
    showScrollButton,
    scrollToBottom,
    handleImageLoad,
    getImageSrc,
    hasNewResponse,
    scrollToNewResponse,
    scrollToMessage,
    currentSession,
    handleImageAnalysis,
    onAnalyzeMultiImage,
    onFollowUpMultiImage,
    onSendMessage,
    addMessage,
    startAIThinking,
    isAIThinking,
    // Context related state
    splitModeImages,
    activeImageIndex,
    enterSplitMode,
    exitSplitMode,
    setActiveImageIndex,
    activeQuestionId,
    setActiveQuestionId,
    isContextFilterActive,
    isQuestionTableVisible,
    visibleTableIds,
    isNegative,
    isHistoryLoading,
    isModelAnswerMode,
    isMarkingSchemeMode,
    user,
    guestLimitInfo
  } = useMarkingPage();

  const isGuest = !user;

  const isFollowUp = (chatMessages || []).length > 0;

  // Auto-refresh Header credits when session completes
  useEffect(() => {
    if (currentSession && !currentSession.id?.startsWith('temp-')) {
      // Wait 1 second for Firestore to save credit deduction
      setTimeout(() => {
        import('../../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
          EventManager.dispatch(EVENT_TYPES.REFRESH_CREDITS);
        });
      }, 1000);
    } else {
      // Stop engagement tracker when session is cleared or reset to a new upload
      engagementTracker.stopSession('session_switch');
    }
  }, [currentSession?.id]);

  // Stop engagement tracker when navigating away from MainLayout (e.g., to /admin)
  useEffect(() => {
    return () => {
      engagementTracker.stopSession('unmount');
    };
  }, []);

  const location = useLocation();
  const navigate = useNavigate();

  // Track subscription success from redirect
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('subscription') === 'success') {
      // Logic removed: Handle conversion via AnalyticsTracker.tsx
      // and URL cleanup via Header.js to prevent collisions.
    }
  }, [location]);

  // State to track if we've scrolled past the header to prevent ribbon overlap
  const [showRibbonOnScroll, setShowRibbonOnScroll] = React.useState(false);
  const [containerElement, setContainerElement] = React.useState<HTMLDivElement | null>(null);

  // Synchronization Lock: Prevents circular updates during programmatic navigation
  const isSyncingRef = React.useRef(false);

  // Reliable Ref Callback to capture the container node
  const setChatContainerRef = React.useCallback((node: HTMLDivElement | null) => {
    // Preserve the original ref from useScrollManager context
    // Preserve the original ref from useScrollManager context
    if (chatContainerRef) {
      if (typeof chatContainerRef === 'function') {
        chatContainerRef(node);
      } else {
        (chatContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    }
    setContainerElement(node);
  }, [chatContainerRef]);

  // Scroll Listener for Ribbon Visibility
  useEffect(() => {
    const container = containerElement;
    if (!container) return;

    const handleScroll = () => {
      const isPastHeader = container.scrollTop > 150;
      setShowRibbonOnScroll(prev => {
        if (isPastHeader !== prev) {
          return isPastHeader;
        }
        return prev;
      });
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerElement]);

  // Centralized Scroll-Spy Observer Ref
  const scrollSpyObserverRef = React.useRef<IntersectionObserver | null>(null);

  // Determine Marking Context for Ribbon
  const lastMarkingMessage = React.useMemo(() => {
    if (!currentSession || !currentSession.messages) return null;
    return [...currentSession.messages].reverse().find(m => (m as any).markingContext);
  }, [currentSession]);

  // Determine Detected Question for Ribbon logic (supports both past papers and generic papers)
  const activeDetectedQuestion = React.useMemo(() => {
    if (!currentSession) return null;
    if (currentSession.detectedQuestion?.examPapers?.length || currentSession.detectedQuestion?.found) {
      return currentSession.detectedQuestion;
    }

    if (currentSession.messages) {
      const msgWithQuestion = currentSession.messages.find(
        (m: any) => m.detectedQuestion?.examPapers?.length || m.detectedQuestion?.found
      );
      if (msgWithQuestion) return (msgWithQuestion as any).detectedQuestion;
    }
    return null;
  }, [currentSession]);

  // Use question grouping hook to get badges data
  const { groupedQuestions, getGroupColor } = useQuestionGrouping(activeDetectedQuestion, (lastMarkingMessage as any)?.markingContext);

  // Centralized Navigation & Sync Handler
  const navigateToQuestion = React.useCallback((qNum: string | number, imgIdx: number, source: 'ribbon' | 'image' | 'scroll') => {
    // 1. Set the Lock
    isSyncingRef.current = true;

    let targetImgIdx = imgIdx;

    // Auto-resolve index if not provided or invalid
    if (targetImgIdx === -1 || targetImgIdx === undefined) {
      const match = groupedQuestions.find(g => String(g.questionNumber).toLowerCase() === String(qNum).toLowerCase());
      if (match) {
        targetImgIdx = match.sourceImageIndex;
      } else {
        targetImgIdx = activeImageIndex || 0; // Fallback
      }
    }

    // 2. Update States
    setActiveQuestionId(qNum);
    if (source === 'ribbon') {
      engagementTracker.recordQuestionNavigation(targetImgIdx);
    } else {
      engagementTracker.recordPageView(targetImgIdx);
    }

    // If not in split mode, we only AUTO-ENTER it if the user explicitly clicked (Ribbon/Image)
    // Scrolling through the chat should NOT suddenly pop the user into split mode.
    if (!splitModeImages) {
      if (source !== 'scroll') {
        const sessionImages = currentSession ? getSessionImages(currentSession) : [];
        if (sessionImages.length > 0) {
          enterSplitMode(sessionImages, targetImgIdx);
        }
      } else {
        // Just keep the target index in sync background-ly
        setActiveImageIndex(targetImgIdx);
      }
    } else {
      // If already in split mode, always sync the image
      setActiveImageIndex(targetImgIdx);
    }

    // 3. Scroll Chat (only if triggered by ribbon or image)
    if (source !== 'scroll') {
      const normalizedQ = String(qNum).toLowerCase();
      // Prefer scrolling to the latest follow-up explanation message for this question if one exists
      const followUpForQ = [...(chatMessages || [])]
        .reverse()
        .find((m: any) =>
          m.role === 'assistant' &&
          !m.markingContext &&
          m.type !== 'marking_annotated' &&
          !m.performanceSummary &&
          String(m.contextQuestionId || '').toLowerCase() === normalizedQ
        );

      if (followUpForQ) {
        scrollToMessage(followUpForQ.id, { behavior: 'smooth', block: 'start' });
      } else {
        const targetId = `question-${normalizedQ}`;
        const el = document.getElementById(targetId);

        if (el) {
          // Native scroll with the CSS/inline scroll-margin-top handles the offset
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          // Fallback: search for any message containing this question if the specific header hasn't rendered yet
          const msg = chatMessages.find((m: any) => String(m.contextQuestionId || '').toLowerCase() === normalizedQ);
          if (msg) {
            scrollToMessage(msg.id, { behavior: 'smooth', block: 'start' });
          }
        }
      }
    }

    // 4. Clear lock after navigation settlement (to allow smooth scroll to finish)
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 1000);
  }, [currentSession, chatMessages, scrollToMessage, setActiveQuestionId, setActiveImageIndex, enterSplitMode, groupedQuestions, splitModeImages, activeImageIndex]);

  // Setup Centralized Scroll-Spy Observer
  useEffect(() => {
    if (!containerElement) return;

    // Cleanup previous observer
    if (scrollSpyObserverRef.current) {
      scrollSpyObserverRef.current.disconnect();
    }

    // Create a NEW observer for the container
    const observer = new IntersectionObserver((entries) => {
      // Determine which header or follow-up message is most prominent at the top
      const visibleHeaders = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => {
          // Get the distance from the top of the container
          const aTop = a.boundingClientRect.top;
          const bTop = b.boundingClientRect.top;
          return aTop - bTop;
        });

      if (visibleHeaders.length > 0) {
        const topHeader = visibleHeaders[0];
        const targetEl = topHeader.target as HTMLElement;
        const qId = targetEl.id;
        const contextQ = targetEl.getAttribute('data-context-question-id');
        const qNum = qId && qId.startsWith('question-')
          ? qId.replace('question-', '')
          : (contextQ || '');

        if (qNum) {
          // 1. Check ID change (Idempotency)
          if (String(qNum).toLowerCase() === String(activeQuestionId).toLowerCase()) {
            return;
          }

          // 2. Check Lock (Sync Safety)
          if (isSyncingRef.current) {
            return;
          }

          // Find associated image index
          const match = groupedQuestions.find(g => String(g.questionNumber).toLowerCase() === qNum.toLowerCase());
          const imgIdx = match ? match.sourceImageIndex : activeImageIndex;

          navigateToQuestion(qNum, imgIdx, 'scroll');
        }
      }
    }, {
      root: containerElement,
      rootMargin: '-110px 0px -60% 0px', // Adjusted margin to account for header height
      threshold: 0
    });

    scrollSpyObserverRef.current = observer;

    // We need to observe all elements with id="question-*" and follow-up messages with data-context-question-id
    const updateObservations = () => {
      const questionElements = containerElement.querySelectorAll('[id^="question-"], [data-context-question-id]');
      questionElements.forEach(el => observer.observe(el));
    };

    updateObservations();

    // Also re-observe on message changes
    const mutationObserver = new MutationObserver(updateObservations);
    mutationObserver.observe(containerElement, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [containerElement, chatMessages, groupedQuestions, activeImageIndex, navigateToQuestion, activeQuestionId]);

  // NOTE: All reactive effects for syncing between activeQuestionId and activeImageIndex have been REMOVED.

  // Prioritize lowest-scoring / mistake question when multiple questions share a page
  const sortQuestionsByMistakePriority = useCallback((questions: any[]) => {
    return [...questions].sort((a, b) => {
      const aMistake = a.hasResults && a.awardedMarks !== null && a.totalMarks > 0 && a.awardedMarks < a.totalMarks ? 0 : 1;
      const bMistake = b.hasResults && b.awardedMarks !== null && b.totalMarks > 0 && b.awardedMarks < b.totalMarks ? 0 : 1;
      if (aMistake !== bMistake) return aMistake - bMistake;
      const aRatio = (a.hasResults && a.awardedMarks !== null && a.totalMarks > 0) ? a.awardedMarks / a.totalMarks : 1;
      const bRatio = (b.hasResults && b.awardedMarks !== null && b.totalMarks > 0) ? b.awardedMarks / b.totalMarks : 1;
      return aRatio - bRatio;
    });
  }, []);

  const lostMarkQuestions = useMemo(() => {
    return groupedQuestions.filter(
      q => q.hasResults && q.awardedMarks !== null && q.totalMarks > 0 && q.awardedMarks < q.totalMarks
    );
  }, [groupedQuestions]);

  const lostMarkPageIndices = useMemo(() => {
    if (!splitModeImages || splitModeImages.length === 0) return [];
    const mistakeRawIndices = new Set<number>();
    lostMarkQuestions.forEach(q => {
      if (Array.isArray(q.allImageIndices) && q.allImageIndices.length > 0) {
        q.allImageIndices.forEach(idx => mistakeRawIndices.add(idx));
      } else if (typeof q.sourceImageIndex === 'number') {
        mistakeRawIndices.add(q.sourceImageIndex);
      }
    });

    const viewerIndices: number[] = [];
    splitModeImages.forEach((img: any, idx: number) => {
      const isAnnotated = img.messageRole === 'assistant' || img.messageType === 'marking_annotated';
      if (!isAnnotated) return;
      const pageIdx = img.pageIndex ?? idx;
      if (mistakeRawIndices.has(pageIdx) || mistakeRawIndices.has(idx)) {
        viewerIndices.push(idx);
      }
    });
    return Array.from(new Set(viewerIndices)).sort((a, b) => a - b);
  }, [lostMarkQuestions, splitModeImages]);

  // Memoize enriched images to provide a stable reference to the ImageViewer
  const enrichedSplitModeImages = React.useMemo(() => {
    if (!splitModeImages) return null;

    return splitModeImages.map((img: any, idx: number) => {
      // Only show badges for assistant/annotated messages
      const isAnnotated = img.messageRole === 'assistant' || img.messageType === 'marking_annotated';

      if (isAnnotated) {
        const pageIdx = img.pageIndex ?? idx;
        const matches = groupedQuestions.filter(
          g => g.allImageIndices.includes(pageIdx) || g.allImageIndices.includes(idx)
        );
        if (matches.length > 0) {
          const match = sortQuestionsByMistakePriority(matches)[0];
          const scoreText = match.awardedMarks !== null ? `${match.awardedMarks}/${match.totalMarks}` : `?/${match.totalMarks}`;
          return {
            ...img,
            badgeText: `Q${match.questionNumber} ${scoreText}`,
            badgeColor: getGroupColor(match)
          };
        }
      }
      return {
        ...img,
        badgeText: undefined // Ensure no badge for originals
      };
    });
  }, [splitModeImages, groupedQuestions, getGroupColor, sortQuestionsByMistakePriority]);

  // Enhanced Split Mode Entry
  const enterSplitModeEnriched = useCallback((images: any[], index: number, isGlobal?: boolean) => {
    const img = images?.[index];
    const pageIdx = img?.pageIndex ?? index;
    // Determine the question associated with this image index to keep the Ribbon in sync
    const matches = groupedQuestions.filter(
      g => g.allImageIndices.includes(pageIdx) || g.allImageIndices.includes(index)
    );
    const match = matches.length > 0 ? sortQuestionsByMistakePriority(matches)[0] : null;
    if (match && activeQuestionId !== match.questionNumber) {
      setActiveQuestionId(match.questionNumber);
    }

    // If we're not in split mode, enter it
    if (!splitModeImages) {
      enterSplitMode(images, index, isGlobal);
      return;
    }

    // If already in split mode, check if we need to update the image set
    // (e.g. switching from session-wide view to message-specific view)
    const imagesChanged = images.length !== splitModeImages.length ||
      (images.length > 0 && images[0].src !== splitModeImages[0].src);

    if (imagesChanged) {
      enterSplitMode(images, index, isGlobal);
    } else if (activeImageIndex !== index) {
      setActiveImageIndex(index);
    }
  }, [splitModeImages, enterSplitMode, activeImageIndex, setActiveImageIndex, groupedQuestions, activeQuestionId, setActiveQuestionId, sortQuestionsByMistakePriority]);

  // Reusable Ribbon Render Function
  const ribbonSessionImages = useMemo(
    () => (currentSession ? getSessionImages(currentSession) : []),
    [currentSession]
  );

  const renderQuestionRibbon = (isChatMode: boolean) => {
    if (!currentSession || groupedQuestions.length === 0) return null;

    const ribbonContent = (
      <QuestionNavigator
        mode="ribbon"
        idPrefix="ribbon"
        detectedQuestion={activeDetectedQuestion}
        markingContext={(lastMarkingMessage as any)?.markingContext}
        onNavigate={(qNum, imgIdx) => {
          navigateToQuestion(qNum, imgIdx, 'ribbon');
        }}
        activeQuestionId={activeQuestionId}
      />
    );

    return (
      <div className="question-navigator-ribbon-wrapper">
        <div className="question-navigator-ribbon-container">
          {ribbonContent}
        </div>
      </div>
    );
  };

  // Handler for image change (e.g. from thumbnail click) to sync ribbon and chat
  const handleImageChange = (index: number) => {
    if (activeImageIndex === index) return;

    const img = splitModeImages?.[index];
    const pageIdx = img?.pageIndex ?? index;
    // Find the question that maps to this page index (prioritizing mistakes when multiple share a page)
    const matches = groupedQuestions.filter(
      q => q.allImageIndices.includes(pageIdx) || q.allImageIndices.includes(index)
    );
    if (matches.length > 0) {
      const question = sortQuestionsByMistakePriority(matches)[0];
      navigateToQuestion(question.questionNumber, index, 'image');
    } else {
      setActiveImageIndex(index);
    }
  };

  const activeQuestionMeta = useMemo(() => {
    const currentIdx = activeImageIndex || 0;
    const img = splitModeImages?.[currentIdx];
    const isAnnotated = img?.messageRole === 'assistant' || img?.messageType === 'marking_annotated';
    if (!isAnnotated) return null;
    const pageIdx = img?.pageIndex ?? currentIdx;

    if (activeQuestionId) {
      const byActiveId = groupedQuestions.find(
        q => String(q.questionNumber).toLowerCase() === String(activeQuestionId).toLowerCase()
      );
      if (byActiveId && (byActiveId.allImageIndices.includes(pageIdx) || byActiveId.allImageIndices.includes(currentIdx))) {
        return {
          questionNumber: String(byActiveId.questionNumber),
          awardedMarks: byActiveId.awardedMarks,
          totalMarks: byActiveId.totalMarks
        };
      }
    }

    const pageMatches = groupedQuestions.filter(
      q => q.allImageIndices.includes(pageIdx) || q.allImageIndices.includes(currentIdx)
    );
    if (pageMatches.length > 0) {
      const prioritized = sortQuestionsByMistakePriority(pageMatches)[0];
      return {
        questionNumber: String(prioritized.questionNumber),
        awardedMarks: prioritized.awardedMarks,
        totalMarks: prioritized.totalMarks
      };
    }

    if (activeQuestionId) {
      const byActiveId = groupedQuestions.find(
        q => String(q.questionNumber).toLowerCase() === String(activeQuestionId).toLowerCase()
      );
      if (byActiveId) {
        return {
          questionNumber: String(byActiveId.questionNumber),
          awardedMarks: byActiveId.awardedMarks,
          totalMarks: byActiveId.totalMarks
        };
      }
    }

    return null;
  }, [activeQuestionId, activeImageIndex, splitModeImages, groupedQuestions, sortQuestionsByMistakePriority]);

  // Lock Scroll-Spy during active processing/AI thinking (and briefly after) so auto-scrolling to a new follow-up message never hijacks activeQuestionId or activeImageIndex
  useEffect(() => {
    if (isProcessing || isAIThinking) {
      isSyncingRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      isSyncingRef.current = false;
    }, 1000);
    return () => clearTimeout(timer);
  }, [isProcessing, isAIThinking]);

  const handleViewerSendFollowUp = useCallback(async (rawText: string, questionNumber?: string | null) => {
    const trimmed = rawText.trim();
    if (!trimmed || !onSendMessage) return;
    isSyncingRef.current = true;
    const targetQ = questionNumber || activeQuestionMeta?.questionNumber || activeQuestionId || null;
    if (targetQ) {
      setActiveQuestionId(String(targetQ));
    }
    const mentionsQuestion = /(?:question|q)\s*\d+/i.test(trimmed);
    const formattedPrompt = targetQ && !mentionsQuestion
      ? `[Question ${targetQ}] ${trimmed}`
      : trimmed;
    await onSendMessage(formattedPrompt);
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 1000);
  }, [onSendMessage, activeQuestionMeta, activeQuestionId, setActiveQuestionId]);

  const followUpResponsesByQuestion = useMemo(() => {
    const map = new Map<string, { id: string; questionNumber: string; content: string }>();
    if (!chatMessages || chatMessages.length === 0) return map;

    const extractQFromText = (txt: string): string | null => {
      const m = txt.match(/(?:question|q)\s*(\d+[a-z]*)/i);
      return m ? m[1] : null;
    };

    for (let i = 0; i < chatMessages.length; i++) {
      const msg = chatMessages[i] as any;
      if (
        msg.role === 'assistant' &&
        !msg.markingContext &&
        msg.type !== 'marking_annotated' &&
        !msg.performanceSummary &&
        !msg.studentScore
      ) {
        const contentStr = ensureStringContent(msg.content).trim();
        if (!contentStr) continue;
        const prevUser = i > 0 && chatMessages[i - 1]?.role === 'user' ? (chatMessages[i - 1] as any) : null;
        const resolvedQ =
          msg.contextQuestionId ||
          prevUser?.contextQuestionId ||
          extractQFromText(ensureStringContent(prevUser?.content || '')) ||
          extractQFromText(contentStr);
        if (resolvedQ) {
          const key = String(resolvedQ).toLowerCase();
          map.set(key, {
            id: String(msg.id || i),
            questionNumber: String(resolvedQ),
            content: contentStr
          });
        }
      }
    }
    return map;
  }, [chatMessages, ensureStringContent]);

  const activeQuestionFollowUpResponse = useMemo(() => {
    const activeQ = activeQuestionMeta?.questionNumber || activeQuestionId;
    if (activeQ) {
      const matched = followUpResponsesByQuestion.get(String(activeQ).toLowerCase());
      if (matched) return matched;
    }
    return null;
  }, [activeQuestionMeta, activeQuestionId, followUpResponsesByQuestion]);

  const hasExplanationForActiveQuestion = Boolean(activeQuestionFollowUpResponse);

  const handleFocusExistingExplanation = useCallback((questionNumber: string) => {
    if (!questionNumber) return;
    const normalizedQ = String(questionNumber).toLowerCase();
    const match = groupedQuestions.find(g => String(g.questionNumber).toLowerCase() === normalizedQ);
    const imgIdx = match ? match.sourceImageIndex : (activeImageIndex || 0);
    navigateToQuestion(questionNumber, imgIdx, 'image');
  }, [groupedQuestions, activeImageIndex, navigateToQuestion]);

  // Common Chat Content Render Function to reuse in both modes
  const renderChatContent = () => {
    let displayedMessages: UnifiedMessage[] = (chatMessages || []) as UnifiedMessage[];

    // Apply context filter if active
    if (isContextFilterActive && activeQuestionId) {
      displayedMessages = displayedMessages.filter((msg: UnifiedMessage) =>
        String(msg.contextQuestionId) === String(activeQuestionId) ||
        msg.role === 'system' ||
        (msg as any).markingContext
      );
    }

    const hasMessages = displayedMessages.length > 0;

    return (
      <div className="chat-panel-layout">
        <div className="marking-header-unified">
          {currentSession && (
            <SessionManagement key={currentSession.id} />
          )}

          {/* 🛡️ HIDE RIBBON IN QUESTION MODE: Added !isQuestionMode to the condition */}
          {!isModelAnswerMode && !isMarkingSchemeMode && !isQuestionMode && (
            <div className="marking-header-ribbon-row">
              <div className="ribbon-wrapper-full-width">
                {/* Sticky Ribbon Navigator for Chat Mode */}
                {renderQuestionRibbon(true)}
              </div>

              {!splitModeImages && ribbonSessionImages.length > 0 && (() => {
                const activeGroup = activeQuestionId
                  ? groupedQuestions.find(g => String(g.questionNumber) === String(activeQuestionId))
                  : null;
                const rawTargetIdx = activeGroup
                  ? (activeGroup.allImageIndices?.[0] ?? 0)
                  : 0;
                const targetIdx = Math.max(0, Math.min(rawTargetIdx, ribbonSessionImages.length - 1));
                const startIdx = ribbonSessionImages.length <= 3
                  ? 0
                  : Math.min(Math.max(0, targetIdx - 1), ribbonSessionImages.length - 3);
                const previewImages = ribbonSessionImages.slice(startIdx, startIdx + 3);
                const extraCount = ribbonSessionImages.length - previewImages.length;

                return (
                  <div className="ribbon-thumbnail-stack-wrapper">
                    <button
                      type="button"
                      className="ribbon-thumbnail-stack-btn"
                      onClick={() => enterSplitModeEnriched(ribbonSessionImages, targetIdx, true)}
                      title={`View marked page ${targetIdx + 1} of ${ribbonSessionImages.length}`}
                      aria-label={`View marked results (${ribbonSessionImages.length} pages)`}
                    >
                      <div className="ribbon-thumbnail-stack">
                        {previewImages.map((img, idx) => (
                          <img
                            key={img.messageId ? `${img.messageId}-${idx}` : idx}
                            src={img.src}
                            alt={`Page ${startIdx + idx + 1}`}
                            className="ribbon-thumbnail-item"
                            style={{ zIndex: previewImages.length - idx }}
                          />
                        ))}
                      </div>
                      {extraCount > 0 && (
                        <span className="ribbon-thumbnail-more">+{extraCount}</span>
                      )}
                    </button>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        <div className="chat-container" ref={setChatContainerRef}>
          {/* Welcome Message or Chat Messages */}
          {!hasMessages ? (
            <div className="focused-app-entry">
              <div className="landing-chat-input-placeholder">
                <FollowUpChatInput
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                  isProcessing={isProcessing}
                  onAnalyzeImage={handleImageAnalysis}
                  onFollowUpImage={handleImageAnalysis}
                  onAnalyzeMultiImage={onAnalyzeMultiImage}
                  onFollowUpMultiImage={onFollowUpMultiImage}
                  onSendMessage={onSendMessage}
                  mode="first-time"
                  currentSession={currentSession}
                  contextQuestionId={activeQuestionId}
                  setContextQuestionId={setActiveQuestionId}
                  isNegative={isNegative}
                  isFollowUp={isFollowUp}
                />
              </div>
            </div>
          ) : (
            <div className="chat-messages" key={currentSession?.id || 'empty'}>
              {displayedMessages.map((msg: any) => (
                <ChatMessage
                  key={`${currentSession?.id || 'no-session'}-${msg.id}`}
                  message={msg}
                  onImageLoad={() => {
                    const lastUserMsg = [...(chatMessages || [])].reverse().find(m => m.role === 'user');
                    if (msg.id === lastUserMsg?.id) {
                      if (msg.role === 'user') {
                        scrollToMessage(msg.id, { behavior: 'smooth', block: 'start' });
                      }
                    }
                  }}
                  getImageSrc={getImageSrc}
                  MarkdownMathRenderer={MarkdownMathRenderer}
                  ensureStringContent={ensureStringContent}
                  scrollToBottom={scrollToBottom}
                  session={currentSession}
                  addMessage={addMessage}
                  startAIThinking={startAIThinking}
                  selectedModel={selectedModel}
                  onEnterSplitMode={enterSplitModeEnriched}
                  onNavigate={navigateToQuestion}
                  isSyncingRef={isSyncingRef}
                />
              ))}
              {/* Bottom spacer with dynamic height */}
              <div
                className="chat-bottom-spacer"
                style={{
                  height: (isProcessing || isAIThinking) ? '60vh' : '250px',
                  flexShrink: 0
                }}
              />
            </div>
          )}
        </div>

        <div className={`scroll-to-bottom-container ${(showScrollButton || hasNewResponse) && hasMessages ? 'show' : 'hidden'}`}>
          <button
            className={`scroll-to-bottom-btn ${hasNewResponse ? 'new-response-btn' : ''}`}
            onClick={hasNewResponse ? scrollToNewResponse : scrollToBottom}
          >
            {hasNewResponse ? (
              <div className="new-response-icon"><span>New</span><ChevronDown size={16} /></div>
            ) : (
              <ChevronDown size={20} />
            )}
          </button>
        </div>

        {isFollowUp && (
          <div className="follow-up-chat-input-container follow-up-bottom">
            <FollowUpChatInput
              selectedModel={selectedModel}
              onModelChange={onModelChange}
              isProcessing={isProcessing}
              onAnalyzeImage={handleImageAnalysis}
              onFollowUpImage={handleImageAnalysis}
              onAnalyzeMultiImage={onAnalyzeMultiImage}
              onFollowUpMultiImage={onFollowUpMultiImage}
              onSendMessage={onSendMessage}
              mode="follow-up"
              currentSession={currentSession}
              contextQuestionId={activeQuestionId}
              setContextQuestionId={setActiveQuestionId}
              isNegative={isNegative}
              isFollowUp={isFollowUp}
            />
          </div>
        )}
      </div>
    );
  };

  // Responsive mobile media query listener
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 768px)').matches
      : typeof window !== 'undefined' && window.innerWidth <= 768
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 768px)');
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    handleMediaChange(mql);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleMediaChange);
      return () => mql.removeEventListener('change', handleMediaChange);
    } else {
      mql.addListener(handleMediaChange);
      return () => mql.removeListener(handleMediaChange);
    }
  }, []);

  const hasImages = splitModeImages && splitModeImages.length > 0;
  
  // 1. Lift Question Mode evaluation
  const sessionMode = (currentSession?.mode || '').toLowerCase();
  const hasQuestionResponseType = (chatMessages || []).some((m: any) => m.type === 'question_response');
  
  const isQuestionMode = sessionMode === 'question' || 
                         sessionMode === 'question mode' ||
                         hasQuestionResponseType;

  // 2. Split view condition: show split view when images are open, on desktop, and not in Question Mode
  // Note: Do NOT block/close split view during active processing/AI thinking so follow-up actions keep the image panel stably open
  const showSplitView = hasImages && !isMobile && !isQuestionMode;

  const layoutClass = `mark-homework-page ${isFollowUp ? 'chat-mode follow-up-mode' : 'initial-mode'} ${showSplitView ? 'split-mode' : ''}`;

  return (
    <div className={layoutClass}>
      <SEO
        title={!isFollowUp ? "Instant GCSE Maths Marking" : currentSession?.title || "Session"}
        schemaData={!isFollowUp ? productSchema : undefined}
        noIndex={noIndex}
      />
      {showSplitView ? (
        <div className="split-view-container">
          <div className="split-chat-panel">
            {renderChatContent()}
          </div>
          <div className="split-canvas-panel">
            <ImageViewer
              key={currentSession?.id || 'viewer'}
              images={enrichedSplitModeImages || []}
              initialImageIndex={activeImageIndex || 0}
              onClose={exitSplitMode}
              isOpen={true}
              onImageChange={handleImageChange}
              lostMarkPageIndices={lostMarkPageIndices}
              activeQuestionMeta={activeQuestionMeta}
              isMobile={false}
              onSendFollowUpMessage={!isQuestionMode ? handleViewerSendFollowUp : undefined}
              isProcessingFollowUp={isProcessing || isAIThinking}
              latestFollowUpResponse={activeQuestionFollowUpResponse}
              hasExplanationForActiveQuestion={hasExplanationForActiveQuestion}
              onFocusExistingExplanation={handleFocusExistingExplanation}
              MarkdownRenderer={MarkdownMathRenderer}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mark-homework-main-content">
            {renderChatContent()}
          </div>
          {(isMobile || isQuestionMode) && hasImages && (
            <div className="mobile-image-viewer-overlay">
              <ImageViewer
                key={currentSession?.id || 'viewer-mobile'}
                images={enrichedSplitModeImages || []}
                initialImageIndex={activeImageIndex || 0}
                onClose={exitSplitMode}
                isOpen={true}
                onImageChange={handleImageChange}
                lostMarkPageIndices={lostMarkPageIndices}
                activeQuestionMeta={activeQuestionMeta}
                isMobile={isMobile}
                onSendFollowUpMessage={!isQuestionMode ? handleViewerSendFollowUp : undefined}
                isProcessingFollowUp={isProcessing || isAIThinking}
                latestFollowUpResponse={activeQuestionFollowUpResponse}
                hasExplanationForActiveQuestion={hasExplanationForActiveQuestion}
                onFocusExistingExplanation={handleFocusExistingExplanation}
                MarkdownRenderer={MarkdownMathRenderer}
              />
            </div>
          )}
        </>
      )}
      
      {isGuest && (chatMessages || []).length > 0 && guestLimitInfo?.usageLimit > 0 && (
        <div className="guest-mode-floating-banner">
          <span className="guest-banner-text">
            🔒 Viewing {Math.max(0, guestLimitInfo.usageLimit - (guestLimitInfo.usageCount || 0))} free answers
          </span>
          <button className="guest-banner-btn" onClick={() => {
            import('../../utils/eventManager').then(({ default: EventManager, EVENT_TYPES }) => {
              EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: 'signup' });
            });
          }}>
            Create Free Account
          </button>
        </div>
      )}
    </div>
  );
};

export default MainLayout;
