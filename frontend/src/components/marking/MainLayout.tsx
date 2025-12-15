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

  // Common Chat Content Render Function to reuse in both modes
  const renderChatContent = () => {
    const displayedMessages = chatMessages || [];
    const hasMessages = displayedMessages.length > 0;

    return (
      <div className="chat-panel-layout" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

        {/* Sticky Ribbon Navigator for Chat Mode */}
        {renderQuestionRibbon(true)}

        <div className="chat-container" ref={chatContainerRef} style={{ flex: 1, overflowY: 'auto' }}>
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
                  onEnterSplitMode={enterSplitMode}
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

  // Reusable Ribbon Render Function
  const renderQuestionRibbon = (isChatMode: boolean) => {
    if (!currentSession || !activeDetectedQuestion || !activeDetectedQuestion.found) return null;

    // Prevent duplicate ribbon in Split Mode
    // Split mode has its own dedicated ribbon, so suppress the specific "Chat Mode" one
    if (isChatMode && splitModeImages) return null;

    // In Chat Mode, only show if table is hidden
    if (isChatMode && isQuestionTableVisible) return null;

    const ribbonContent = (
      <QuestionNavigator
        mode="ribbon"
        detectedQuestion={activeDetectedQuestion}
        markingContext={(lastMarkingMessage as any)?.markingContext}
        onNavigate={(qNum, imgIdx) => {
          // Set active question
          setActiveQuestionId(qNum);

          // If valid images are found, ALWAYS enforce split mode update.
          // This ensures that even if the user is already in split mode (potentially with stale/broken data),
          // Get reliable session images (same logic as Table Mode)
          const sessionImages = currentSession ? getSessionImages(currentSession) : [];

          // Enrich images with badges
          const enrichedImages = sessionImages.map((img: any, idx: number) => {
            // Find matching group for this image page index
            // Note: sourceImageIndex is 0-based page index
            const match = groupedQuestions.find(g => g.sourceImageIndex === idx);
            if (match) {
              // Format: Q1 5/5
              const scoreText = match.awardedMarks !== null ? `${match.awardedMarks}/${match.totalMarks}` : `?/${match.totalMarks}`;
              return {
                ...img,
                badgeText: `Q${match.questionNumber} ${scoreText}`,
                badgeColor: getGroupColor(match)
              };
            }
            return img;
          });

          // Use a robust check: if we have images, we should be in split mode or verify split mode
          if (enrichedImages.length > 0) {
            // Always update/enter split mode with fresh images
            enterSplitMode(enrichedImages, imgIdx);
          } else {
            // Fallback for no images
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
        <div style={{ flexShrink: 0, zIndex: 100, background: 'var(--surface-primary)', borderBottom: '1px solid var(--border-color)', width: '100%' }}>
          <div style={{ maxWidth: '1000px', width: '85vw', margin: '0 auto', paddingLeft: '48px', paddingRight: '48px' }}>
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
