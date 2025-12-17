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
      // Toggle ribbon eligibility based on scroll past header (e.g. 60px)
      // This prevents the ribbon from covering the session title at the very top
      const isPastHeader = container.scrollTop > 60;
      // Use functional update to avoid `showRibbonOnScroll` in dependency array
      setShowRibbonOnScroll(prev => {
        if (isPastHeader !== prev) {
          return isPastHeader;
        }
        return prev;
      });
    };

    container.addEventListener('scroll', handleScroll);
    // Initial check
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerElement]);

  // Common Chat Content Render Function to reuse in both modes
  const renderChatContent = () => {
    const displayedMessages = chatMessages || [];
    const hasMessages = displayedMessages.length > 0;

    return (
      <div className="chat-panel-layout" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Sticky Ribbon Navigator for Chat Mode */}
        {renderQuestionRibbon(true)}

        <div className="chat-container" ref={setChatContainerRef} style={{ flex: 1, overflowY: 'auto' }}>
          {currentSession && (
            <SessionManagement key={currentSession.id} />
          )}

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
          />
        </div>
      </div>
    )
  };

  // Import ImageViewer directly here to avoid circular dependencies if placed at top
  const ImageViewer = require('../common/ImageViewer').default;

  // Determine Marking Context for Ribbon
  // We want the most recent marking context available in the session
  const lastMarkingMessage = React.useMemo(() => {
    if (!currentSession || !currentSession.messages) return null;
    return [...currentSession.messages].reverse().find(m => (m as any).markingContext);
  }, [currentSession]);

  // Determine Detected Question for Ribbon logic
  // Look for it in the session root first, then fallback to finding it in messages
  const activeDetectedQuestion = React.useMemo(() => {
    if (!currentSession) return null;
    if (currentSession.detectedQuestion?.found) return currentSession.detectedQuestion;

    // Search in messages (usually the first user message or first assistant message)
    if (currentSession.messages) {
      const msgWithQuestion = currentSession.messages.find((m: any) => m.detectedQuestion?.found);
      if (msgWithQuestion) return (msgWithQuestion as any).detectedQuestion;
    }
    return null;
  }, [currentSession]);

  // Use question grouping hook to get badges data
  const { groupedQuestions, getGroupColor } = useQuestionGrouping(activeDetectedQuestion, (lastMarkingMessage as any)?.markingContext);

  // Sync Active Question ID with Image Index in Split Mode
  // Sync Active Question ID with Image Index in Split Mode
  useEffect(() => {
    if (splitModeImages && activeImageIndex !== undefined) {
      // Find ALL questions on this page
      const questionsOnPage = groupedQuestions.filter(g => g.sourceImageIndex === activeImageIndex);

      if (questionsOnPage.length > 0) {
        // Check if currently active question is one of them
        // If it is, we don't need to change anything (user clicked specifically on this question)
        const isActiveValid = questionsOnPage.some(g => g.questionNumber === activeQuestionId);

        if (!isActiveValid) {
          // Only update if current active question is NOT on this page/valid
          // Default to the first question on the page
          setActiveQuestionId(questionsOnPage[0].questionNumber);
        }
      }
    }
  }, [activeImageIndex, splitModeImages, groupedQuestions, activeQuestionId, setActiveQuestionId]);

  // Enhanced Split Mode Entry
  const enterSplitModeEnriched = (images: any[], index: number) => {
    // Enrich images with badges
    const enrichedImages = images.map((img: any, idx: number) => {
      // Note: input images might not have correct 'idx' if they are just an array passed in
      // BUT for 'sessionImages', the index in array corresponds to page index 0,1,2...
      // IF 'images' is a subset (e.g. multi-image message), logic differs?
      // Wait: MainLayout always passes FULL session images for onNavigate (Ribbon).
      // ChatMessage grid passes ONLY its own images?
      // If ChatMessage passes subset, 'idx' 0 is NOT Page 0.
      // We need GLOBAL page index source.

      // Assumption: 'images' passed to this function are ALWAYS meant to be the full session context?
      // OR we need to know the global offset.

      // FIX: If we enter split mode from a message grid, we typically want FULL CONTEXT (all pages).
      // ChatMessage handleSmartNavigation does: getSessionImages(session).
      // ChatMessage handleMultiImageClick does: map(imageDataArray).
      // If we execute handleMultiImageClick (Grid), we get only 1-2 images.
      // If I enrich them, we assume index 0 is Page 0? No.

      // If we want badges, we probably want FULL session mode even from Grid click?
      // User said "click on 9 image thumbnail grid... enter split mode".
      // If I view just those 9 images, they might be Pages 1-9.
      // But groupedQuestions maps 'sourceImageIndex' (Page 0..N).

      // If the input 'images' are indeed the Full Session Images (which is preferred for split mode),
      // then index matches.
      // If they are specific to message, we might mismatch.

      // However, current implementation of `handleMultiImageClick` in ChatMessage uses local `imageDataArray`.
      // If I replace `handleMultiImageClick` logic to use `enterSplitModeEnriched`, and I pass `sessionImages` (full) instead of local?
      // Then we are safe.

      // So, I will define this expecting FULL session images.
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

    // Prevent duplicate ribbon in Split Mode
    if (isChatMode && splitModeImages) return null;

    if (isChatMode) {
      // 1. Must be scrolled past header to avoid overlap
      if (!showRibbonOnScroll) return null;

      // 2. Table must be hidden (scrolled away)
      if (isQuestionTableVisible) return null;
    }

    const ribbonContent = (
      <QuestionNavigator
        mode="ribbon"
        idPrefix="ribbon"
        detectedQuestion={activeDetectedQuestion}
        markingContext={(lastMarkingMessage as any)?.markingContext}
        onNavigate={(qNum, imgIdx) => {
          // Set active question
          setActiveQuestionId(qNum);

          // If valid images are found, ALWAYS enforce split mode update.
          const sessionImages = currentSession ? getSessionImages(currentSession) : [];

          if (sessionImages.length > 0) {
            enterSplitModeEnriched(sessionImages, imgIdx);
          } else {
            if (isChatMode) console.warn('[MainLayout] No session images found for split mode');
            setActiveImageIndex(imgIdx);
          }

          // 2. Scroll Chat using smooth scroll
          setTimeout(() => {
            const el = document.getElementById(`question-${qNum}`);
            if (el) {
              const chatContainer = document.querySelector('.chat-container') as HTMLElement;
              if (chatContainer) {
                const elRect = el.getBoundingClientRect();
                const containerRect = chatContainer.getBoundingClientRect();
                const offset = 100;
                const targetScrollTop = chatContainer.scrollTop + (elRect.top - containerRect.top) - offset;
                chatContainer.scrollTo({
                  top: targetScrollTop,
                  behavior: 'smooth'
                });
              }
            }
          }, 100);
        }}
        activeQuestionId={activeQuestionId}
      />
    );

    // Styling Wrapper based on Mode
    if (isChatMode) {
      return (
        <div className="question-navigator-ribbon-wrapper">
          <div className="question-navigator-ribbon-container">
            {ribbonContent}
          </div>
        </div>
      );
    } else {
      // Split Mode Wrapper (Simple full width of pane)
      return (
        <div style={{ flexShrink: 0, zIndex: 100, background: 'var(--surface-primary)', borderBottom: '1px solid var(--border-color)' }}>
          {ribbonContent}
        </div>
      );
    }
  };

  // Use simple relative positioning for standard layout
  return (
    <div className={`mark-homework-page ${isFollowUp ? 'chat-mode' : 'initial-mode'} ${splitModeImages ? 'split-mode' : ''}`}>
      {splitModeImages ? ReactDOM.createPortal(
        /* SPLIT VIEW LAYOUT (PORTAL) */
        <div className="split-view-portal-root" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 2147483647,
          background: 'var(--background-gray-main, #111827)',
          display: 'flex',
          overflow: 'hidden'
        }}>
          {/* Left Panel: Image Viewer (50%) */}
          <div className="split-left-panel" style={{ width: '50%', flex: '0 0 50%', borderRight: '1px solid var(--border-main)', position: 'relative', minWidth: '320px' }}>
            <ImageViewer
              images={splitModeImages}
              initialImageIndex={activeImageIndex || 0}
              onClose={exitSplitMode}
              isOpen={true}
              onImageChange={setActiveImageIndex}
            />
          </div>

          {/* Right Panel: Chat Interface (50%) */}
          <div className="split-right-panel" style={{ width: '50%', flex: '0 0 50%', display: 'flex', flexDirection: 'column', position: 'relative', minWidth: '320px', background: 'var(--background-gray-main)' }}>

            {/* Ribbon Navigator (Only if detectedQuestion exists) */}
            {renderQuestionRibbon(false)}

            <div className="mark-homework-main-content" style={{ height: '100%', padding: 0, overflowY: 'auto' }}>
              {renderChatContent()}
            </div>
          </div>
        </div>,
        document.body
      ) : (
        /* STANDARD SINGLE COLUMN LAYOUT */
        <div className="mark-homework-main-content">
          {renderChatContent()}
        </div>
      )
      }
    </div>
  );
};

export default MainLayout;
