/**
 * MainLayout Component
 * Orchestrates all the focused components for the mark homework page
 */

import React from 'react';
import PropTypes from 'prop-types';
import { ChevronDown, Brain } from 'lucide-react';
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
  isTextOnlySubmission,
  onFileSelect,
  onAnalyzeImage,
  onClearFile,
  selectedModel,
  onModelChange,
  loadingProgress,
  loadingStep,
  loadingTotalSteps,
  loadingMessage,
  progressData,
  stepList,
  completedSteps,
  showExpandedThinking,
  showProgressDetails,
  setShowProgressDetails,
  markError,
  
  // Chat props
  chatMessages,
  chatContainerRef,
  showScrollButton,
  scrollToBottom,
  handleImageLoad,
  getImageSrc,
  hasNewResponse,
  scrollToNewResponse,
  
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
                progressData={progressData}
                stepList={stepList}
                completedSteps={completedSteps}
                ensureStringContent={ensureStringContent}
                scrollToBottom={scrollToBottom}
              />
            ))}
            
        {/* AI Thinking Indicator - Show during processing with toggle and dropdown */}
        {/* Only show for image submissions when there's no processing message in chatMessages */}
        {/* For text-only submissions, the processing message is handled by ChatMessage component */}
        {!isTextOnlySubmission && (isAIThinking || isProcessing) && !chatMessages?.some(msg => msg.role === 'assistant' && msg.isProcessing) && (
          <div className="chat-message assistant">
            <div className="chat-message-content">
              <div className="chat-message-bubble">
                <div className="assistant-header">
                  <Brain size={20} className="assistant-brain-icon" />
                  <div className="thinking-indicator">
                    <div className="progress-main-line">
                      <div className="thinking-dots" style={{ flexShrink: 0 }}>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                      </div>
                      <div className="thinking-text" style={{ flexShrink: 0 }}>
                        {loadingMessage || 'AI is thinking...'}
                      </div>
                      {(stepList && stepList.length > 0) && (
                        <div className="progress-toggle-container">
                          <button
                            className="progress-toggle-button"
                            onClick={() => setShowProgressDetails(!showProgressDetails)}
                            style={{
                              transform: showProgressDetails ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s ease'
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M6 9l6 6 6-6"/>
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Progress details - only show if there are steps */}
            {showProgressDetails && stepList && stepList.length > 0 && (
              <div className="progress-details-container" style={{ textAlign: 'left' }}>
                <div className="step-list-container">
                  {(() => {
                    // Show only steps that have started (completed + current step)
                    const completedCount = (completedSteps || []).length;
                    const currentStepIndex = completedCount;
                    const stepsToShow = (stepList || []).slice(0, currentStepIndex + 1);
                    
                    return stepsToShow.map((step, index) => {
                      const isCompleted = (completedSteps || []).includes(step.id);
                      const isCurrent = index === completedCount;
                      return (
                        <div key={step.id || index} className={`step-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                          <div className="step-indicator">
                            {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                          </div>
                          <div className="step-description">
                            {step.description}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
          </div>
          
          {/* Scroll to Bottom Button / New Response Button */}
          <div className={`scroll-to-bottom-container ${(showScrollButton || hasNewResponse) ? 'show' : 'hidden'}`}>
            <button 
              className={`scroll-to-bottom-btn ${hasNewResponse ? 'new-response-btn blinking' : ''}`}
              onClick={hasNewResponse ? scrollToNewResponse : scrollToBottom}
              title={hasNewResponse ? "View new response" : "Scroll to bottom"}
            >
              {hasNewResponse ? (
                <div className="new-response-icon">
                  <span className="new-text">New</span>
                  <ChevronDown size={16} />
                </div>
              ) : (
                <ChevronDown size={20} />
              )}
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
  isTextOnlySubmission: PropTypes.bool,
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
