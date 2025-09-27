/**
 * Focused ChatMessage Component
 * Simple, maintainable, single-purpose component for displaying chat messages
 */

import React, { useCallback, useState } from 'react';
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
  scrollToBottom,
  isLastMessage = false
}) => {
  const [imageError, setImageError] = useState(false);
  const [showProgressDetails, setShowProgressDetails] = useState(false);

  // Handle progress toggle with conditional scroll
  const handleProgressToggle = () => {
    const newShowProgressDetails = !showProgressDetails;
    setShowProgressDetails(newShowProgressDetails);
    
    // Only scroll to bottom if:
    // 1. This is the last message
    // 2. We're expanding (not collapsing) the progress details
    // 3. scrollToBottom function is available
    // 4. The expanded content would be cut off (not fully visible)
    if (isLastMessage && newShowProgressDetails && scrollToBottom) {
      // Use setTimeout to ensure the DOM has updated with the expanded content
      setTimeout(() => {
        // Check if the expanded content is fully visible
        const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
        if (messageElement) {
          const messageRect = messageElement.getBoundingClientRect();
          const containerRect = messageElement.closest('.chat-messages-container')?.getBoundingClientRect();
          
          if (containerRect) {
            // Check if the bottom of the message is below the visible area
            const isMessageCutOff = messageRect.bottom > containerRect.bottom;
            
            // Only scroll if the message is cut off
            if (isMessageCutOff) {
              scrollToBottom();
            }
          }
        }
      }, 100);
    }
  };


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
              {message.progressData && message.progressData.allSteps && message.isProcessing ? (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    <div className="thinking-dots" style={{ flexShrink: 0 }}>
                      <div className={`thinking-dot ${(() => {
                        // For chat history (simplified progressData), stop animation
                        if (!message.progressData.isComplete && message.progressData.currentStepIndex === undefined) {
                          return 'no-animation';
                        }
                        // For real-time processing, use isComplete
                        return message.progressData.isComplete ? 'no-animation' : '';
                      })()}`}></div>
                      <div className={`thinking-dot ${(() => {
                        // For chat history (simplified progressData), stop animation
                        if (!message.progressData.isComplete && message.progressData.currentStepIndex === undefined) {
                          return 'no-animation';
                        }
                        // For real-time processing, use isComplete
                        return message.progressData.isComplete ? 'no-animation' : '';
                      })()}`}></div>
                      <div className={`thinking-dot ${(() => {
                        // For chat history (simplified progressData), stop animation
                        if (!message.progressData.isComplete && message.progressData.currentStepIndex === undefined) {
                          return 'no-animation';
                        }
                        // For real-time processing, use isComplete
                        return message.progressData.isComplete ? 'no-animation' : '';
                      })()}`}></div>
                    </div>
                    <div className="thinking-text" style={{ flexShrink: 0 }}>
                      {(() => {
                        // For chat history (simplified progressData), always show "Show thinking"
                        if (!message.progressData.isComplete && message.progressData.currentStepIndex === undefined) {
                          return 'Show thinking';
                        }
                        // For real-time processing, show current step or "Show thinking"
                        return message.progressData.isComplete ? 'Show thinking' : (message.progressData.allSteps[message.progressData.currentStepIndex] || 'Processing...');
                      })()}
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
              ) : message.isProcessing ? (
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
                  // For chat history (simplified progressData), show all steps as completed
                  if (!message.progressData.completedStepIndices && message.progressData.currentStepIndex === undefined) {
                    return message.progressData.allSteps.map((step, index) => (
                      <div key={index} className="step-item completed">
                        <div className="step-indicator">✓</div>
                        <div className="step-description">{step}</div>
                      </div>
                    ));
                  }
                  
                  // For real-time processing, show progress
                  const completedCount = message.progressData.completedStepIndices?.length || 0;
                  const currentStepIndex = message.progressData.currentStepIndex || 0;
                  const stepsToShow = message.progressData.allSteps.slice(0, Math.max(completedCount, currentStepIndex + 1));
                  
                  return stepsToShow.map((step, index) => {
                    const isCompleted = message.progressData.completedStepIndices?.includes(index) || false;
                    const isCurrent = index === currentStepIndex && !isCompleted;
                    return (
                      <div key={index} className={`step-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                        <div className="step-indicator">
                          {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                        </div>
                        <div className="step-description">
                          {step}
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
