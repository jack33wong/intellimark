/**
 * Chat Interface Component
 * Handles message display and input
 */

import React from 'react';
import { Bot, ChevronDown, Brain } from 'lucide-react';
import MarkdownMathRenderer from '../MarkdownMathRenderer';
import { ensureStringContent } from '../../utils/contentUtils';

const ChatInterface = ({
  messages = [],
  chatInput,
  onInputChange,
  onSendMessage,
  onKeyPress,
  isProcessing = false,
  showScrollButton = false,
  onScrollToBottom,
  markingResult = null,
  getImageSrc = (src) => src
}) => {
  return (
    <div className="chat-interface">
      {/* Chat Messages */}
      <div className="chat-messages" ref={onScrollToBottom}>
        {messages.map((message, index) => (
          <div 
            key={`${message.id}-${index}`} 
            className={`chat-message ${message.role}`}
          >
            <div className={`message-bubble ${(message.type === 'marking_original' || message.type === 'marking_annotated') ? 'marking-message' : ''}`}>
              {message.role === 'assistant' ? (
                <div>
                  <div className="assistant-header">
                    <Brain size={20} className="assistant-brain-icon" />
                  </div>
                  
                  {/* Only show content for regular chat messages, not marking messages */}
                  {message.type !== 'marking_annotated' && message.type !== 'marking_original' && 
                   message.content && 
                   ensureStringContent(message.content).trim() !== '' && (
                    <MarkdownMathRenderer 
                      content={ensureStringContent(message.content)}
                      className="chat-message-renderer"
                    />
                  )}
                  
                  {/* Handle marking messages with annotated images */}
                  {message.type === 'marking_annotated' && (message.imageLink || message.imageData) && (
                    <div className="homework-annotated-image">
                      <h4>✅ Marked Homework Image</h4>
                      <img 
                        src={getImageSrc(message.imageLink || message.imageData)}
                        alt="Marked homework"
                        className="annotated-image"
                        onError={(e) => {
                          console.warn('Failed to load image:', message.imageLink || message.imageData);
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  
                  {/* Raw content toggle */}
                  <button 
                    className="raw-toggle-btn"
                    onClick={() => {
                      // This would need to be handled by parent component
                      console.log('Toggle raw content for message:', message.id);
                    }}
                    style={{marginTop: '8px', fontSize: '12px'}}
                  >
                    {message.showRaw ? 'Hide Raw' : 'Show Raw'}
                  </button>
                  
                  {message.showRaw && (
                    <div className="raw-response">
                      <div className="raw-header">Raw Response</div>
                      <div className="raw-content">
                        {ensureStringContent(message.rawContent || message.content)}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {/* User message content */}
                  {message.imageData && (
                    <div className="message-image">
                      <img 
                        src={getImageSrc(message.imageData)}
                        alt="Uploaded"
                        className="content-image"
                      />
                    </div>
                  )}
                  
                  <div className="message-text">
                    {typeof message.content === 'string' ? message.content : String(message.content || '')}
                  </div>
                  
                  {message.metadata && (
                    <div className="message-metadata">
                      <div className="metadata-item">
                        <span>Processing Time:</span>
                        <span>{message.metadata.processingTimeMs}ms</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        
        {/* Processing indicator */}
        {isProcessing && (
          <div className="chat-message assistant">
            <div className="message-bubble">
              <div className="assistant-header">
                <Brain size={20} className="assistant-brain-icon" />
              </div>
              <div className="thinking-animation">
                <div className="thinking-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span className="thinking-text">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <button 
          className="scroll-to-bottom-btn"
          onClick={onScrollToBottom}
          title="Scroll to bottom"
        >
          <ChevronDown size={20} />
        </button>
      )}

      {/* Chat Input */}
      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <input
            type="text"
            value={chatInput}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyPress={onKeyPress}
            placeholder="Ask a question about the homework..."
            className="chat-input"
            disabled={isProcessing}
          />
          <button
            className="send-btn"
            onClick={onSendMessage}
            disabled={isProcessing || !chatInput.trim()}
          >
            <Bot size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
