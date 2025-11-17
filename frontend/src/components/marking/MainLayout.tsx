/**
 * MainLayout Component (TypeScript)
 * This is the definitive version with the fix for the re-mounting bug.
 */
import React from 'react';
import { ChevronDown } from 'lucide-react';
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
  } = useMarkingPage();

  const isFollowUp = (chatMessages || []).length > 0;

  return (
    <div className={`mark-homework-page ${isFollowUp ? 'chat-mode' : 'initial-mode'}`}>
      <div className="mark-homework-main-content">
        <div className="chat-container" ref={chatContainerRef}>
          {currentSession && (
            // 👇 FIX: Add a stable `key`. This prevents the component from being
            // unmounted and remounted, which was resetting the dropdown state.
            <SessionManagement key={currentSession.id} />
          )}
        
          <div className="chat-messages">
              {(chatMessages || []).map((message: any) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onImageLoad={handleImageLoad}
                  getImageSrc={getImageSrc}
                  MarkdownMathRenderer={MarkdownMathRenderer}
                  ensureStringContent={ensureStringContent}
                  scrollToBottom={scrollToBottom}
                  session={currentSession}
                  addMessage={addMessage}
                  startAIThinking={startAIThinking}
                  selectedModel={selectedModel}
                />
              ))}
              
              {/* Removed empty assistant message div that was causing ghost messages */}
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
            />
        </div>
      </div>
    </div>
  );
};

export default MainLayout;

