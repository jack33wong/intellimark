/**
 * MainLayout Component
 * Orchestrates all the focused components for the mark homework page
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Brain, ChevronDown } from 'lucide-react';
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
  loadingStep,
  loadingTotalSteps,
  loadingMessage,
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
  // State for progress details toggle
  const [showProgressDetails, setShowProgressDetails] = useState(false);
  
  // Runtime validation for critical props
  if (process.env.NODE_ENV === 'development') {
    if (!onModelChange) {
      console.error('MainLayout: onModelChange prop is required but was undefined');
    }
    if (!selectedModel) {
      console.error('MainLayout: selectedModel prop is required but was undefined');
    }
  }

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
            {(isAIThinking || isProcessing) && (
              <div className="chat-message assistant">
                <div className="message-bubble">
                  <div className="assistant-header">
                    <Brain size={20} className="assistant-brain-icon" />
                  </div>
                  <div className="thinking-indicator">
                    {/* Always show the main thinking line */}
                    <div className="progress-main-line">
                      <div className="thinking-dots" style={{ flexShrink: 0 }}>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                      </div>
                      <div className="thinking-text" style={{ flexShrink: 0 }}>
                        AI is thinking...
                      </div>
                      
                      {/* Always reserve space for toggle button to prevent layout shift */}
                      <div className="progress-toggle-container">
                        {/* Show toggle button when processing starts */}
                        {(isProcessing || isAIThinking) && (
                          <button 
                            onClick={() => setShowProgressDetails(!showProgressDetails)}
                            className="progress-toggle-button"
                          >
                            {showProgressDetails ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* Progress details - show when toggled */}
                    {showProgressDetails && (isProcessing || isAIThinking) && (
                      <div className="progress-details-container">
                        <div className="progress-message-text">
                          {loadingMessage}
                        </div>
                        <div className="progress-step-text">
                          {loadingStep > 0 && loadingTotalSteps ? `Step ${loadingStep}/${loadingTotalSteps} • ` : ''}{loadingProgress > 0 ? `${loadingProgress}%` : 'Starting...'}
                        </div>
                        <div className="progress-bar-container">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${loadingProgress}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
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
          onModelChange={onModelChange}
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
          loadingProgress={loadingProgress}
          loadingStep={loadingStep}
          loadingMessage={loadingMessage}
        />
      </div>
    </div>
  );
};

MainLayout.propTypes = {
  pageMode: PropTypes.string.isRequired,
  selectedFile: PropTypes.object,
  onFileSelect: PropTypes.func,
  onAnalyzeImage: PropTypes.func,
  onClearFile: PropTypes.func,
  selectedModel: PropTypes.string.isRequired,
  onModelChange: PropTypes.func.isRequired,
  currentSession: PropTypes.object,
  chatMessages: PropTypes.array,
  sessionTitle: PropTypes.string,
  isFavorite: PropTypes.bool,
  onFavoriteToggle: PropTypes.func,
  rating: PropTypes.number,
  onRatingChange: PropTypes.func,
  isProcessing: PropTypes.bool,
  isAIThinking: PropTypes.bool,
  error: PropTypes.object,
  onError: PropTypes.func,
  onFollowUpImage: PropTypes.func,
  onUploadClick: PropTypes.func,
  onClearPreview: PropTypes.func,
  chatInput: PropTypes.string,
  setChatInput: PropTypes.func,
  onSendMessage: PropTypes.func,
  onKeyPress: PropTypes.func,
  handleImageLoad: PropTypes.func,
  getImageSrc: PropTypes.func
};

export default MainLayout;
