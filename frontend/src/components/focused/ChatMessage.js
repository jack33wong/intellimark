/**
 * Focused ChatMessage Component
 * Simple, maintainable, single-purpose component for displaying chat messages
 */

import React, { useCallback, useState, useRef } from 'react';
import { Brain } from 'lucide-react';
import { 
  isUserMessage, 
  hasImage, 
  getMessageDisplayText,
  getMessageTimestamp 
} from '../../utils/messageUtils';
import { 
  isMarkingMessage, 
  isAnnotatedImageMessage
} from '../../utils/sessionUtils';
import './ChatMessage.css';

const ChatMessage = ({ 
  message, 
  onImageClick, 
  onError, 
  className = '',
  showTimestamp = true,
  compact = false,
  onImageLoad,
  getImageSrc,
  MarkdownMathRenderer,
  ensureStringContent,
  progressData,
  stepList,
  completedSteps,
  scrollToBottom
}) => {
  const [imageError, setImageError] = useState(false);
  const [showProgressDetails, setShowProgressDetails] = useState(false);
  const messageRef = useRef(null);

  // Smart scroll handler for progress details toggle
  const handleProgressToggle = useCallback(() => {
    const newShowProgressDetails = !showProgressDetails;
    setShowProgressDetails(newShowProgressDetails);
    
    // Only scroll if we're expanding the progress details and scrollToBottom is available
    if (newShowProgressDetails && scrollToBottom) {
      // Use setTimeout to allow the DOM to update with the new progress details
      setTimeout(() => {
        // Check if this is the last message in the chat
        const chatMessages = document.querySelector('.chat-messages');
        if (chatMessages) {
          const messageElements = chatMessages.querySelectorAll('.chat-message');
          const lastMessageElement = messageElements[messageElements.length - 1];
          const isLastMessage = lastMessageElement && lastMessageElement.contains(messageRef.current);
          
          if (isLastMessage) {
            // Check if there's content below the progress details
            const progressDetails = messageRef.current?.querySelector('.progress-details-container');
            if (progressDetails) {
              const progressRect = progressDetails.getBoundingClientRect();
              const chatRect = chatMessages.getBoundingClientRect();
              
              // Only scroll if the progress details extend beyond the visible chat area
              if (progressRect.bottom > chatRect.bottom) {
                scrollToBottom();
              }
            } else {
              // If progress details don't exist yet, just scroll to bottom anyway
              // This handles the case where allSteps is not available yet during processing
              scrollToBottom();
            }
          }
        }
      }, 150); // Increased delay to allow for DOM updates and animations
    }
  }, [showProgressDetails, scrollToBottom]);

  // Handle image load error
  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  // Get message role
  const isUser = isUserMessage(message);

  // Get message content - only show AI response, progress steps are handled separately
  const content = getMessageDisplayText(message);
  const timestamp = getMessageTimestamp(message);

  // Get image source using passed function or fallback
  const imageSrc = getImageSrc ? getImageSrc(message) : (message?.imageLink || message?.imageData);


  // Check if this is a marking message using utility function
  const isMarking = isMarkingMessage(message);

  return (
    <div 
      ref={messageRef}
      className={`chat-message ${className} ${isUser ? 'user' : 'assistant'} ${compact ? 'compact' : ''}`}
      data-message-id={message.id}
    >
      <div className="chat-message-content">
        <div className={`chat-message-bubble ${isMarking ? 'marking-message' : ''}`}>
          {/* Assistant header with Brain icon and thinking indicator */}
          {!isUser && (
            <div className="assistant-header">
              <Brain size={20} className="assistant-brain-icon" />
              {/* Progress steps display for AI messages */}
              {message.progressData && message.progressData.allSteps && !message.progressData.isComplete ? (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    <div className="thinking-dots" style={{ flexShrink: 0 }}>
                      <div className={`thinking-dot ${message.progressData?.isComplete ? 'no-animation' : ''}`}></div>
                      <div className={`thinking-dot ${message.progressData?.isComplete ? 'no-animation' : ''}`}></div>
                      <div className={`thinking-dot ${message.progressData?.isComplete ? 'no-animation' : ''}`}></div>
                    </div>
                    <div className="thinking-text" style={{ flexShrink: 0 }}>
                      {!message.progressData?.isComplete ? 
                        (message.progressData?.currentStepDescription || message.progressData?.allSteps?.[0] || 'Processing...') : 
                        'Show thinking'
                      }
                    </div>
                    <div className="progress-toggle-container">
                      <button
                        className="progress-toggle-button"
                        onClick={handleProgressToggle}
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
                  </div>
                </div>
              ) : message.progressData && !message.progressData.isComplete ? (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    <div className="thinking-dots" style={{ flexShrink: 0 }}>
                      <div className="thinking-dot"></div>
                      <div className="thinking-dot"></div>
                      <div className="thinking-dot"></div>
                    </div>
                    <div className="thinking-text" style={{ flexShrink: 0 }}>
                      Processing...
                    </div>
                  </div>
                </div>
              ) : message.progressData ? (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    <div className="thinking-text" style={{ flexShrink: 0 }}>
                      Show thinking
                    </div>
                    <div className="progress-toggle-container">
                      <button
                        className="progress-toggle-button"
                        onClick={handleProgressToggle}
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
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Progress details - completely outside header */}
          {!isUser && message.progressData && message.progressData.allSteps && showProgressDetails && (
            <div className="progress-details-container" style={{ textAlign: 'left' }}>
              <div className="step-list-container">
                {(() => {
                  // Handle simplified structure: allSteps is array of strings
                  const allSteps = message.progressData.allSteps || [];
                  const completedCount = message.progressData.completedSteps?.length || 0;
                  const currentStepIndex = message.progressData.currentStepIndex || completedCount;
                  
                  // Show only steps that have started (completed + current step)
                  const stepsToShow = allSteps.slice(0, Math.min(currentStepIndex + 1, allSteps.length));
                  
                  return stepsToShow.map((step, index) => {
                    // Handle both string and object formats
                    const stepText = typeof step === 'string' ? step : (step.description || step.name || 'Step');
                    const stepId = typeof step === 'string' ? `step-${index}` : (step.id || `step-${index}`);
                    
                    const isCompleted = index < completedCount;
                    const isCurrent = index === currentStepIndex && !isCompleted;
                    
                    return (
                      <div key={stepId} className={`step-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                        <div className="step-indicator">
                          {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                        </div>
                        <div className="step-description">
                          {stepText}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          
          {/* Show content for regular chat messages and AI responses */}
          {!isUser && 
           content && 
           ensureStringContent && 
           ensureStringContent(content) && 
           ensureStringContent(content).trim() !== '' && (
            <MarkdownMathRenderer 
              content={ensureStringContent(content)}
              className="chat-message-renderer"
            />
          )}
          
          {/* Handle marking messages with annotated images */}
          {!isUser && isAnnotatedImageMessage(message) && hasImage(message) && imageSrc && !imageError && (
            <div className="homework-annotated-image">
              <img 
                src={imageSrc}
                alt="Marked homework"
                className="annotated-image"
                onLoad={onImageLoad}
                onError={handleImageError}
              />
            </div>
          )}
          
          {/* Text content for user messages */}
          {isUser && content && (
            <div className="message-text">
              {typeof content === 'string' ? content : String(content || '')}
            </div>
          )}
          
          {/* Empty message fallback - only for user messages or AI messages without progress data */}
          {!content && !hasImage(message) && (isUser || !message.progressData) && (
            <div className="chat-message-empty">
              <span>No content</span>
            </div>
          )}
        </div>
        
        {/* User uploaded image - positioned above timestamp */}
        {isUser && hasImage(message) && imageSrc && !imageError && (
          <div className="chat-message-image">
            <img 
              src={imageSrc}
              alt="Uploaded"
              className="content-image"
              onLoad={onImageLoad}
              onError={handleImageError}
            />
          </div>
        )}
        
        {/* Image error fallback */}
        {hasImage(message) && imageError && (
          <div className="chat-message-image-error">
            <span>📷 Image failed to load</span>
          </div>
        )}
        
        {/* Timestamp - only show for user messages or AI messages that are not processing */}
        {showTimestamp && timestamp && (isUser || !message.isProcessing) && (
          <div className="chat-message-timestamp">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
