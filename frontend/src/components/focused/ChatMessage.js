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
  completedSteps
}) => {
  const [imageError, setImageError] = useState(false);
  const [showProgressSteps, setShowProgressSteps] = useState(false);


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
    <div className={`chat-message ${className} ${isUser ? 'user' : 'assistant'} ${compact ? 'compact' : ''}`}>
      <div className="chat-message-content">
        <div className={`chat-message-bubble ${isMarking ? 'marking-message' : ''}`}>
          {/* Assistant header with Brain icon and thinking indicator */}
          {!isUser && (
            <div className="assistant-header">
              <Brain size={20} className="assistant-brain-icon" />
              {/* Progress steps display for AI messages (same style as processing) */}
              {message.progressData && message.progressData.allSteps && (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    <div className="thinking-dots" style={{ flexShrink: 0 }}>
                      <div className={`thinking-dot ${message.progressData.isComplete ? 'no-animation' : ''}`}></div>
                      <div className={`thinking-dot ${message.progressData.isComplete ? 'no-animation' : ''}`}></div>
                      <div className={`thinking-dot ${message.progressData.isComplete ? 'no-animation' : ''}`}></div>
                    </div>
                    <div className="thinking-text" style={{ flexShrink: 0 }}>
                      {message.progressData.isComplete ? 'Show thinking' : (message.progressData.currentStepDescription || 'Processing...')}
                    </div>
                    <div className="progress-toggle-container">
                      <button 
                        className="progress-toggle-button"
                        onClick={() => setShowProgressSteps(!showProgressSteps)}
                      >
                        <svg 
                          width="16" 
                          height="16" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2" 
                          strokeLinecap="round" 
                          strokeLinejoin="round"
                          style={{ 
                            transform: showProgressSteps ? 'rotate(180deg)' : 'rotate(0deg)', 
                            transition: 'transform 0.2s ease' 
                          }}
                        >
                          <path d="M6 9l6 6 6-6"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Progress details - moved outside assistant header to avoid content overlap */}
          {!isUser && message.progressData && message.progressData.allSteps && showProgressSteps && (
            <div className="progress-details-container" style={{ textAlign: 'left' }}>
              <div className="step-list-container">
                {(() => {
                  // Show only steps that have started (completed + current step)
                  const completedCount = message.progressData.completedSteps?.length || 0;
                  const currentStepIndex = completedCount;
                  const stepsToShow = message.progressData.allSteps.slice(0, currentStepIndex + 1);
                  
                  return stepsToShow.map((step, index) => {
                    const isCompleted = message.progressData.completedSteps?.includes(step.id) || false;
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
