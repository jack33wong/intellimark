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
  ensureStringContent
}) => {
  const [imageError, setImageError] = useState(false);


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
  const imageSrc = getImageSrc ? getImageSrc(message) : (message?.imageLink || message?.imageData);


  // Check if this is a marking message using utility function
  const isMarking = isMarkingMessage(message);

  return (
    <div className={`chat-message ${className} ${isUser ? 'user' : 'assistant'} ${compact ? 'compact' : ''}`}>
      <div className="chat-message-content">
        <div className={`chat-message-bubble ${isMarking ? 'marking-message' : ''}`}>
          {/* Assistant header with Brain icon */}
          {!isUser && (
            <div className="assistant-header">
              <Brain size={20} className="assistant-brain-icon" />
            </div>
          )}
          
          {/* Show content for regular chat messages and AI responses */}
          {!isUser && !isMarkingMessage(message) && 
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
          
          {/* Regular image display for user messages and other cases */}
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
