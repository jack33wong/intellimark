/**
 * MainLayout Component (TypeScript)
 * This is the definitive version with the fix for the re-mounting bug.
 */
import React, { useEffect } from 'react';
import { ChevronDown, Brain } from 'lucide-react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import SessionManagement from './SessionManagement';
import FollowUpChatInput from '../chat/FollowUpChatInput';
import { ChatMessage } from '../focused';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { ensureStringContent } from '../../utils/contentUtils';
import './css/ChatInterface.css';
import './css/ImageUploadInterface.css';

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
  } = useMarkingPage();

  const isFollowUp = (chatMessages || []).length > 0;

  // Auto-refresh Header credits when session completes
  useEffect(() => {
    if (currentSession && !currentSession.id?.startsWith('temp-')) {
      console.log('[MainLayout] Session completed, scheduling Header credit refresh in 1s');
      // Wait 1 second for Firestore to save credit deduction
      setTimeout(() => {
        console.log('[MainLayout] Triggering Header credit refresh now');
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
      <div className="chat-panel-layout">
        <div className="chat-container" ref={chatContainerRef}>
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

  // Use simple relative positioning for standard layout
  return (
    <div className={`mark-homework-page ${isFollowUp ? 'chat-mode' : 'initial-mode'} ${splitModeImages ? 'split-mode' : ''}`}>
      {splitModeImages ? (
        /* SPLIT VIEW LAYOUT */
        <div className="split-view-container" style={{ display: 'flex', height: '100vh', width: '100%', overflow: 'hidden' }}>
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
            <div className="mark-homework-main-content" style={{ height: '100%', padding: 0 }}>
              {renderChatContent()}
            </div>
          </div>
        </div>
      ) : (
        /* STANDARD SINGLE COLUMN LAYOUT */
        <div className="mark-homework-main-content">
          {renderChatContent()}
        </div>
      )}
    </div>
  );
};

export default MainLayout;
