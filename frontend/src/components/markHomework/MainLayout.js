/**
 * MainLayout Component
 * Orchestrates all the focused components for the mark homework page
 */

import React from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import UnifiedChatInput from '../chat/UnifiedChatInput';
import SessionManagement from './SessionManagement';
import FollowUpChatInput from '../chat/FollowUpChatInput';
import { ChatMessage } from '../focused';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { ensureStringContent } from '../../utils/contentUtils';
import './css/ChatInterface.css';
import './css/ImageUploadInterface.css';

const MainLayout = ({
  // Page mode
  pageMode,
  
  // Image upload props
  selectedFile,
  previewUrl,
  isProcessing,
  isAIThinking,
  onFileSelect,
  onAnalyzeImage,
  onClearFile,
  selectedModel,
  onModelChange,
  loadingProgress,
  showExpandedThinking,
  markError,
  
  // Chat props
  chatMessages,
  chatContainerRef,
  showScrollButton,
  scrollToBottom,
  handleImageLoad,
  getImageSrc,
  
  // Session props
  currentSession,
  sessionTitle,
  isFavorite,
  onFavoriteToggle,
  rating,
  onRatingChange,
  hoveredRating,
  onRatingHover,
  user,
  markingResult,
  sessionData,
  showInfoDropdown,
  onToggleInfoDropdown,
  
  // Follow-up chat props
  onFollowUpImage,
  onUploadClick,
  onClearPreview,
  
  // Text input props
  chatInput,
  setChatInput,
  onSendMessage,
  onKeyPress
}) => {


  // Determine if we're in follow-up mode (chat input bar at bottom)
  const isFollowUpMode = (chatMessages || []).length > 0;
  
  return (
    <div className={`mark-homework-page chat-mode ${isFollowUpMode ? 'follow-up-mode' : 'initial-mode'}`}>
      <div className="mark-homework-main-content">
        <div className="chat-container" ref={chatContainerRef}>
          {/* Show chat header when we have a session */}
          {currentSession && (
            <SessionManagement
              sessionTitle={isProcessing ? 'Processing...' : sessionTitle}
              isFavorite={isFavorite}
              onFavoriteToggle={onFavoriteToggle}
              rating={rating}
              onRatingChange={onRatingChange}
              hoveredRating={hoveredRating}
              onRatingHover={onRatingHover}
              user={user}
              markingResult={markingResult}
              sessionData={sessionData}
              showInfoDropdown={showInfoDropdown}
              onToggleInfoDropdown={onToggleInfoDropdown}
              currentSession={currentSession}
              isProcessing={isProcessing}
            />
          )}
        
        <div className="chat-messages">
            {(chatMessages || []).map((message, index) => (
              <ChatMessage
                key={`${message.id}-${index}`}
                message={message}
                onImageLoad={handleImageLoad}
                getImageSrc={getImageSrc}
                MarkdownMathRenderer={MarkdownMathRenderer}
                ensureStringContent={ensureStringContent}
              />
            ))}
            
            {/* AI Thinking Indicator */}
            {isAIThinking && (
              <div className="chat-message assistant">
                <div className="message-bubble">
                  <div className="assistant-header">
                    <Brain size={20} className="assistant-brain-icon" />
                  </div>
                  <div className="thinking-indicator">
                    <div className="thinking-dots">
                      <div className="thinking-dot"></div>
                      <div className="thinking-dot"></div>
                      <div className="thinking-dot"></div>
                    </div>
                    <div className="thinking-text">
                      AI is thinking...
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Scroll to Bottom Button */}
          <div className={`scroll-to-bottom-container ${showScrollButton ? 'show' : 'hidden'}`}>
            <button 
              className="scroll-to-bottom-btn"
              onClick={scrollToBottom}
              title="Scroll to bottom"
            >
              <ChevronDown size={20} />
            </button>
          </div>
        </div>
      </div>
      
      {markError && (
        <div className="error-message">
          <p>{markError}</p>
        </div>
      )}
      
      {/* Follow-up Chat Input Bar */}
      <div className={`follow-up-chat-input-container ${(chatMessages || []).length === 0 ? 'follow-up-center' : 'follow-up-bottom'}`}>
        <FollowUpChatInput
          selectedModel={selectedModel}
          isProcessing={isProcessing}
          onAnalyzeImage={onAnalyzeImage}
          onFollowUpImage={onFollowUpImage}
          onUploadClick={onUploadClick}
          currentSession={currentSession}
          clearPreview={onClearPreview}
          chatInput={chatInput}
          setChatInput={setChatInput}
          onSendMessage={onSendMessage}
          onKeyPress={onKeyPress}
        />
      </div>
    </div>
  );
};

export default MainLayout;
