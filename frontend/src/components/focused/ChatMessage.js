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
  ensureStringContent
}) => {
  const [imageError, setImageError] = useState(false);

  // Handle image click
  const handleImageClick = useCallback(() => {
    if (!hasImage(message)) return;
    
    if (onImageClick) {
      onImageClick(message);
    }
  }, [message, onImageClick]);

  // Handle image load error
  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  // Get message role
  const isUser = isUserMessage(message);

  // Get message content
  const content = getMessageDisplayText(message);
  const timestamp = getMessageTimestamp(message);

  // Get image source using passed function or fallback
  const imageSrc = getImageSrc ? getImageSrc(message?.imageLink || message?.imageData) : (message?.imageLink || message?.imageData);

  // Check if this is a marking message
  const isMarkingMessage = message?.type === 'marking_original' || message?.type === 'marking_annotated' || message?.type === 'question_original';

  return (
    <div className={`chat-message ${className} ${isUser ? 'user' : 'assistant'} ${compact ? 'compact' : ''}`}>
      <div className="chat-message-content">
        <div className={`chat-message-bubble ${isMarkingMessage ? 'marking-message' : ''}`}>
          {/* Assistant header with Brain icon */}
          {!isUser && (
            <div className="assistant-header">
              <Brain size={20} className="assistant-brain-icon" />
            </div>
          )}
          
          {/* Show content for regular chat messages and AI responses */}
          {!isUser && message?.type !== 'marking_original' && 
           content && 
           ensureStringContent && ensureStringContent(content).trim() !== '' && (
            <MarkdownMathRenderer 
              content={ensureStringContent(content)}
              className="chat-message-renderer"
            />
          )}
          
          {/* Handle marking messages with annotated images */}
          {!isUser && message?.type === 'marking_annotated' && hasImage(message) && imageSrc && !imageError && (
            <div className="homework-annotated-image">
              <h4>✅ Marked Homework Image</h4>
              <img 
                src={imageSrc}
                alt="Marked homework"
                className="annotated-image"
                onLoad={onImageLoad}
                onError={handleImageError}
              />
            </div>
          )}
          
          {/* Regular image display for user messages and other cases */}
          {isUser && hasImage(message) && imageSrc && !imageError && (
            <div className="message-image">
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
          
          {/* Text content for user messages */}
          {isUser && content && (
            <div className="message-text">
              {typeof content === 'string' ? content : String(content || '')}
            </div>
          )}
          
          {/* Empty message fallback */}
          {!content && !hasImage(message) && (
            <div className="chat-message-empty">
              <span>No content</span>
            </div>
          )}
        </div>
        
        {/* Timestamp */}
        {showTimestamp && timestamp && (
          <div className="chat-message-timestamp">
            {timestamp}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;
