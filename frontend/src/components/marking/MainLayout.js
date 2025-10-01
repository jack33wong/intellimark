/**
 * MainLayout Component
 * Orchestrates all the focused components for the mark homework page.
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

const MainLayout = () => {
  const {
    isProcessing,
    isAIThinking,
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
    onSendMessage,
    progressData,
    stepList,
    completedSteps,
  } = useMarkingPage();

  const isFollowUp = (chatMessages || []).length > 0;

  return (
    <div className={`mark-homework-page ${isFollowUp ? 'chat-mode' : 'initial-mode'}`}>
      <div className="mark-homework-main-content">
        <div className="chat-container" ref={chatContainerRef}>
          {currentSession && (
            <SessionManagement />
          )}
        
          <div className="chat-messages">
              {(chatMessages || []).map((message) => (
                // 👇 FIX: Use a stable key (message.id). This prevents the "page refresh" effect.
                <ChatMessage
                  key={message.id}
                  message={message}
                  onImageLoad={handleImageLoad}
                  getImageSrc={getImageSrc}
                  MarkdownMathRenderer={MarkdownMathRenderer}
                  progressData={progressData}
                  stepList={stepList}
                  completedSteps={completedSteps}
                  ensureStringContent={ensureStringContent}
                  scrollToBottom={scrollToBottom}
                />
              ))}
              
              {isAIThinking && !chatMessages?.some(msg => msg.role === 'assistant' && msg.isProcessing) && (
                <div className="chat-message assistant">
                   {/* AI Thinking Indicator would go here */}
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
        </div>
        
        <div className={`follow-up-chat-input-container ${isFollowUp ? 'follow-up-bottom' : 'follow-up-center'}`}>
            <FollowUpChatInput
                selectedModel={selectedModel}
                onModelChange={onModelChange}
                isProcessing={isProcessing}
                onAnalyzeImage={handleImageAnalysis}
                onSendMessage={onSendMessage}
                mode={isFollowUp ? 'follow-up' : 'first-time'}
            />
        </div>
      </div>
    </div>
  );
};

export default MainLayout;

