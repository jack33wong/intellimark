/**
 * Focused ChatMessage Component (TypeScript)
 * This is the definitive version with fixes for all rendering and state bugs.
 */
import React, { useCallback, useState } from 'react';
import { Brain } from 'lucide-react';
import { 
  isUserMessage, 
  hasImage, 
  getMessageDisplayText,
  getMessageTimestamp
} from '../../utils/messageUtils.js';
import { 
  isAnnotatedImageMessage
} from '../../utils/sessionUtils';
import { useDropdownState } from '../../hooks/useDropdownState';
import ExamPaperTab from '../marking/ExamPaperTab';
import './ChatMessage.css';
import { UnifiedMessage } from '../../types';


interface ChatMessageProps {
  message: UnifiedMessage;
  onImageLoad?: () => void;
  getImageSrc: (message: UnifiedMessage) => string | null;
  MarkdownMathRenderer: React.ElementType;
  ensureStringContent: (content: any) => string;
  scrollToBottom?: () => void;
}

const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ 
  message, 
  onImageLoad,
  getImageSrc,
  MarkdownMathRenderer,
  ensureStringContent,
  scrollToBottom
}) => {
  const [imageError, setImageError] = useState<boolean>(false);
  
  // Inline function to avoid Jest import issues
  const shouldRenderMessage = (message: UnifiedMessage): boolean => {
    if (message.role === 'user') {
      return true; // Always render user messages
    }
    
    // For assistant messages, check if it's not a ghost message
    if (message.role !== 'assistant') {
      return false;
    }
    
    // Keep assistant messages that have content or are processing
    const hasContent = message.content && message.content.trim() !== '';
    const isProcessing = message.isProcessing === true;
    const hasProgressData = !!message.progressData;
    
    // Filter out empty assistant messages that are not processing
    return hasContent || isProcessing || hasProgressData;
  };
  
  // Use custom hook for dropdown state management
  const { showProgressDetails, toggleDropdown } = useDropdownState(message.id);

  const handleProgressToggle = useCallback(() => {
    toggleDropdown(scrollToBottom);
  }, [toggleDropdown, scrollToBottom]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  const isUser = isUserMessage(message);
  const content = getMessageDisplayText(message);
  const timestamp = getMessageTimestamp(message);
  const imageSrc = getImageSrc(message);

  // Don't render ghost messages
  if (!shouldRenderMessage(message)) {
    return null;
  }

  return (
    <div 
      className={`chat-message ${isUser ? 'user' : 'assistant'}`}
      data-message-id={message.id}
      aria-roledescription={isUser ? 'user-message' : 'assistant-message'}
    >
      <div className="chat-message-content">
        <div className={`chat-message-bubble`}>
          {!isUser && (
            <div className="assistant-header">
              <Brain size={20} className="assistant-brain-icon" />
              {message.progressData && (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    {!message.progressData.isComplete && (
                      <div className="thinking-dots">
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                      </div>
                    )}
                    <div className="thinking-text">
                      {message.progressData.isComplete ? 'Show thinking' : (message.progressData.currentStepDescription || 'Processing...')}
                    </div>
                    {message.progressData.allSteps && message.progressData.allSteps.length > 0 && (
                      <div className="progress-toggle-container">
                                <button
                                  className="progress-toggle-button"
                                  onClick={handleProgressToggle}
                                  style={{ transform: showProgressDetails ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 9l6 6 6-6"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {!isUser && message.detectedQuestion && message.detectedQuestion.found && (
            <ExamPaperTab detectedQuestion={message.detectedQuestion} />
          )}
          
                  {showProgressDetails && message.progressData?.allSteps && (
             <div className="progress-details-container">
                <div className="step-list-container">
                  {(message.progressData.allSteps || []).map((step: any, index: number) => {
                      const stepText = typeof step === 'string' ? step : (step.description || 'Step');
                      const currentStepIndex = message.progressData?.currentStepIndex || 0;
                      const isComplete = message.progressData?.isComplete || false;
                      
                      // If process is complete, all steps are completed
                      // Otherwise, step N is completed when currentStepIndex > N (we've moved past step N)
                      const isCompleted = isComplete || index < currentStepIndex;
                      // Step N is current when currentStepIndex === N AND process is not complete
                      const isCurrent = !isComplete && index === currentStepIndex;
                      
                      return (
                        <div key={index} className={`step-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                          <div className="step-indicator">
                            {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                          </div>
                          <div className="step-description">
                            {stepText}
                          </div>
                        </div>
                      );
                  })}
                </div>
             </div>
          )}

          {!isUser && content && ensureStringContent(content).trim() !== '' && (
            <MarkdownMathRenderer 
              content={ensureStringContent(content)}
              className="chat-message-renderer"
            />
          )}
          
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
          
          {isUser && content && (
            <div className="message-text">
              {ensureStringContent(content)}
            </div>
          )}
        </div>
        
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
        
        {hasImage(message) && imageError && (
          <div className="chat-message-image-error">
            <span>📷 Image failed to load</span>
          </div>
        )}
        
        {timestamp && (isUser || !message.isProcessing) && (
          <div className="chat-message-timestamp">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatMessage;

