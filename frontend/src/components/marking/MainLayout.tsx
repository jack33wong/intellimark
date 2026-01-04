/**
 * MainLayout Component (TypeScript)
 * This is the definitive version with the fix for the re-mounting bug.
 */
import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Brain } from 'lucide-react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import SessionManagement from './SessionManagement';
import FollowUpChatInput from '../chat/FollowUpChatInput';
import { ChatMessage } from '../focused';
import type { UnifiedMessage } from '../../types';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { ensureStringContent } from '../../utils/contentUtils';
import { getSessionImages } from '../../utils/imageCollectionUtils';
import { useQuestionGrouping } from '../../hooks/useQuestionGrouping';
import './css/ChatInterface.css';
import './css/ImageUploadInterface.css';
import QuestionNavigator from './QuestionNavigator';
import SEO from '../common/SEO';
import ImageViewer from '../common/ImageViewer';
import HeroAnimation from '../layout/HeroAnimation';

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

const MainLayout: React.FC = () => {
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
    setContextFilterActive,
    isQuestionTableVisible,
    visibleTableIds,
    isNegative
  } = useMarkingPage();

  const isFollowUp = (chatMessages || []).length > 0;

  // Auto-refresh Header credits when session completes
  useEffect(() => {
    if (currentSession && !currentSession.id?.startsWith('temp-')) {
      // Wait 1 second for Firestore to save credit deduction
      setTimeout(() => {
        if (typeof window.refreshHeaderSubscription === 'function') {
          window.refreshHeaderSubscription();
        }
      }, 1000);
    }
  }, [currentSession?.id]);

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

  // Determine Detected Question for Ribbon logic
  const activeDetectedQuestion = React.useMemo(() => {
    if (!currentSession) return null;
    if (currentSession.detectedQuestion?.found) return currentSession.detectedQuestion;

    if (currentSession.messages) {
      const msgWithQuestion = currentSession.messages.find((m: any) => m.detectedQuestion?.found);
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
      const targetId = `question-${String(qNum).toLowerCase()}`;
      const el = document.getElementById(targetId);

      if (el) {
        // Native scroll with the CSS/inline scroll-margin-top handles the offset
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        // Fallback: search for the message containing this question if the specific header hasn't rendered yet
        const msg = chatMessages.find((m: any) => String(m.contextQuestionId) === String(qNum));
        if (msg) {
          scrollToMessage(msg.id, { behavior: 'smooth', block: 'start' });
        }
      }
    }

    // 4. Clear lock after navigation settlement (to allow smooth scroll to finish)
    setTimeout(() => {
      isSyncingRef.current = false;
    }, 1000);
  }, [currentSession, setActiveQuestionId, setActiveImageIndex, enterSplitMode, groupedQuestions, splitModeImages, activeImageIndex]);

  // Setup Centralized Scroll-Spy Observer
  useEffect(() => {
    if (!containerElement) return;

    // Cleanup previous observer
    if (scrollSpyObserverRef.current) {
      scrollSpyObserverRef.current.disconnect();
    }

    // Create a NEW observer for the container
    const observer = new IntersectionObserver((entries) => {
      // Determine which header is most prominent at the top
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
        const qId = topHeader.target.id;
        const qNum = qId.replace('question-', '');

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

    // We need to observe all elements with id="question-*"
    const updateObservations = () => {
      const questionElements = containerElement.querySelectorAll('[id^="question-"]');
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

  // Memoize enriched images to provide a stable reference to the ImageViewer
  const enrichedSplitModeImages = React.useMemo(() => {
    if (!splitModeImages) return null;

    return splitModeImages.map((img: any, idx: number) => {
      // Only show badges for assistant/annotated messages
      const isAnnotated = img.messageRole === 'assistant' || img.messageType === 'marking_annotated';

      if (isAnnotated) {
        const match = groupedQuestions.find(g => g.sourceImageIndex === idx);
        if (match) {
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
  }, [splitModeImages, groupedQuestions, getGroupColor]);

  // Enhanced Split Mode Entry
  const enterSplitModeEnriched = useCallback((images: any[], index: number, isGlobal?: boolean) => {
    // Determine the question associated with this image index to keep the Ribbon in sync
    const match = groupedQuestions.find(g => g.sourceImageIndex === index);
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
  }, [splitModeImages, enterSplitMode, activeImageIndex, setActiveImageIndex, groupedQuestions, activeQuestionId, setActiveQuestionId]);

  // Reusable Ribbon Render Function
  const renderQuestionRibbon = (isChatMode: boolean) => {
    if (!currentSession || !activeDetectedQuestion || !activeDetectedQuestion.found) return null;

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

    // Find the question that maps to this page index
    const question = groupedQuestions.find(q => q.sourceImageIndex === index);
    if (question) {
      navigateToQuestion(question.questionNumber, index, 'image');
    } else {
      setActiveImageIndex(index);
    }
  };

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

          <div className="marking-header-ribbon-row">
            <div className="ribbon-wrapper-full-width">
              {/* Sticky Ribbon Navigator for Chat Mode */}
              {renderQuestionRibbon(true)}
            </div>

            {activeQuestionId && (
              <div className="context-filter-wrapper">
                <button
                  className={`filter-toggle-btn ${isContextFilterActive ? 'active' : ''}`}
                  onClick={() => setContextFilterActive(!isContextFilterActive)}
                  title={isContextFilterActive ? "Show all messages" : "Show only current question messages"}
                >
                  <Brain size={14} />
                  {isContextFilterActive ? "Grouped by Q" : "Group Chat"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="chat-container" ref={setChatContainerRef}>
          {/* Welcome Message or Chat Messages */}
          {!hasMessages ? (
            null
          ) : (
            <div className="chat-messages">
              {displayedMessages.map((msg: any) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onImageLoad={() => {
                    const lastUserMsg = [...(chatMessages || [])].reverse().find(m => m.role === 'user');
                    if (msg.id === lastUserMsg?.id) {
                      scrollToMessage(msg.id, { behavior: 'smooth', block: 'start' });
                    } else {
                      scrollToBottom();
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
              {/* When thinking, expand to push user question to top (85vh). Otherwise standard spacer (250px). */}
              <div
                className="chat-bottom-spacer"
                style={{
                  height: (isProcessing || isAIThinking) ? '85vh' : '250px',
                  flexShrink: 0
                }}
              />
            </div>
          )}
        </div>

        <div className={`scroll-to-bottom-container ${(showScrollButton || hasNewResponse) ? 'show' : 'hidden'}`}>
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

        <div className={`follow-up-chat-input-container ${isFollowUp ? 'follow-up-bottom' : 'follow-up-center'}`}>
          <FollowUpChatInput
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            isProcessing={isProcessing}
            onAnalyzeImage={handleImageAnalysis}
            onFollowUpImage={handleImageAnalysis}
            onAnalyzeMultiImage={onAnalyzeMultiImage}
            onFollowUpMultiImage={onFollowUpMultiImage}
            onSendMessage={onSendMessage}
            mode={isFollowUp ? 'follow-up' : 'first-time'}
            currentSession={currentSession}
            contextQuestionId={activeQuestionId}
            setContextQuestionId={setActiveQuestionId}
            isNegative={isNegative}
          />

          {!isFollowUp && (
            <div className="landing-intro-image-container">
              <HeroAnimation />
            </div>
          )}
        </div>
      </div>
    );
  };

  // Determine layout class
  const layoutClass = `mark-homework-page ${isFollowUp ? 'chat-mode follow-up-mode' : 'initial-mode'} ${splitModeImages ? 'split-mode' : ''}`;

  return (
    <div className={layoutClass}>
      <SEO
        title={!isFollowUp ? "Instant GCSE Maths Marking" : currentSession?.title || "Session"}
        schemaData={!isFollowUp ? productSchema : undefined}
      />
      {splitModeImages ? (
        <div className="split-view-container">
          <div className="split-chat-panel">
            {renderChatContent()}
          </div>
          <div className="split-canvas-panel">
            <ImageViewer
              images={enrichedSplitModeImages || []}
              initialImageIndex={activeImageIndex || 0}
              onClose={exitSplitMode}
              isOpen={true}
              onImageChange={handleImageChange}
            />
          </div>
        </div>
      ) : (
        <div className="mark-homework-main-content">
          {renderChatContent()}
        </div>
      )}
    </div>
  );
};

export default MainLayout;
