/**
 * MainLayout Component (TypeScript)
 * This is the definitive version with the fix for the re-mounting bug.
 */
import React, { useEffect } from 'react';
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
    currentSession,
    handleImageAnalysis,
    onAnalyzeMultiImage,
    onFollowUpMultiImage,
    onSendMessage,
    addMessage,
    startAIThinking,
    // Split Mode Context
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

  // Reliable Ref Callback to capture the container node
  const setChatContainerRef = React.useCallback((node: HTMLDivElement | null) => {
    // Preserve the original ref from useScrollManager context
    if (chatContainerRef) {
      chatContainerRef.current = node;
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

  // Import ImageViewer directly here to avoid circular dependencies if placed at top
  const ImageViewer = require('../common/ImageViewer').default;

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

  // Sync Active Question ID with Image Index in Split Mode
  useEffect(() => {
    if (splitModeImages && activeImageIndex !== undefined) {
      const questionsOnPage = groupedQuestions.filter(g => g.sourceImageIndex === activeImageIndex);

      if (questionsOnPage.length > 0) {
        const isActiveValid = questionsOnPage.some(g => g.questionNumber === activeQuestionId);

        if (!isActiveValid) {
          setActiveQuestionId(questionsOnPage[0].questionNumber);
        }
      }
    }
  }, [activeImageIndex, splitModeImages, groupedQuestions, activeQuestionId, setActiveQuestionId]);

  // Enhanced Split Mode Entry
  const enterSplitModeEnriched = (images: any[], index: number) => {
    const enrichedImages = images.map((img: any, idx: number) => {
      const match = groupedQuestions.find(g => g.sourceImageIndex === idx);
      if (match) {
        const scoreText = match.awardedMarks !== null ? `${match.awardedMarks}/${match.totalMarks}` : `?/${match.totalMarks}`;
        return {
          ...img,
          badgeText: `Q${match.questionNumber} ${scoreText}`,
          badgeColor: getGroupColor(match)
        };
      }
      return img;
    });

    enterSplitMode(enrichedImages, index);
  };

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
          setActiveQuestionId(qNum);
          const sessionImages = currentSession ? getSessionImages(currentSession) : [];
          if (sessionImages.length > 0) {
            enterSplitModeEnriched(sessionImages, imgIdx);
          } else {
            setActiveImageIndex(imgIdx);
          }

          setTimeout(() => {
            const targetId = `question-${String(qNum).toLowerCase()}`;
            const el = document.getElementById(targetId);

            if (el) {
              const chatContainer = document.querySelector('.chat-container') as HTMLElement;
              if (chatContainer) {
                const elRect = el.getBoundingClientRect();
                const containerRect = chatContainer.getBoundingClientRect();
                const offset = 120; // Match the scrollMarginTop in ChatMessage
                const targetScrollTop = chatContainer.scrollTop + (elRect.top - containerRect.top) - offset;

                chatContainer.scrollTo({
                  top: targetScrollTop,
                  behavior: 'smooth'
                });
              }
            }
          }, 250); // Increased timeout to ensure re-render and ID injection complete
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
      <div className="chat-panel-layout" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div className="marking-header-unified" style={{ flexShrink: 0, backgroundColor: 'var(--background-gray-main)', zIndex: 100 }}>
          {currentSession && (
            <SessionManagement key={currentSession.id} />
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
            <div style={{ flex: 1 }}>
              {/* Sticky Ribbon Navigator for Chat Mode */}
              {renderQuestionRibbon(true)}
            </div>

            {activeQuestionId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '12px', borderLeft: '1px solid var(--border-main)' }}>
                <button
                  className={`filter-toggle-btn ${isContextFilterActive ? 'active' : ''}`}
                  onClick={() => setContextFilterActive(!isContextFilterActive)}
                  title={isContextFilterActive ? "Show all messages" : "Show only current question messages"}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '16px',
                    border: '1px solid var(--border-main)',
                    backgroundColor: isContextFilterActive ? 'var(--button-primary-black)' : 'transparent',
                    color: isContextFilterActive ? 'white' : 'var(--text-primary)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <Brain size={14} />
                  {isContextFilterActive ? "Grouped by Q" : "Group Chat"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="chat-container" ref={setChatContainerRef} style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {/* Welcome Message or Chat Messages */}
          {!hasMessages ? (
            null
          ) : (
            <div className="chat-messages">
              {displayedMessages.map((msg: any) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onImageLoad={scrollToBottom}
                  getImageSrc={getImageSrc}
                  MarkdownMathRenderer={MarkdownMathRenderer}
                  ensureStringContent={ensureStringContent}
                  scrollToBottom={scrollToBottom}
                  session={currentSession}
                  addMessage={addMessage}
                  startAIThinking={startAIThinking}
                  selectedModel={selectedModel}
                  onEnterSplitMode={enterSplitModeEnriched}
                />
              ))}
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
          />
        </div>
      </div>
    );
  };

  // Determine layout class
  const layoutClass = `mark-homework-page ${isFollowUp ? 'chat-mode' : 'initial-mode'} ${splitModeImages ? 'split-mode' : ''}`;

  if (splitModeImages) {
    return (
      <div className={layoutClass}>
        <div className="split-view-container">
          <div className="split-chat-panel">
            {renderChatContent()}
          </div>
          <div className="split-canvas-panel">
            <ImageViewer
              images={splitModeImages}
              initialImageIndex={activeImageIndex || 0}
              onClose={exitSplitMode}
              isOpen={true}
              onImageChange={setActiveImageIndex}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={layoutClass}>
      <div className="mark-homework-main-content">
        {renderChatContent()}
      </div>
    </div>
  );
};

export default MainLayout;
