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
    <>
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

      {/* Chat Input Bar */}
      <div className="main-upload-input-bar">
        <div className="main-upload-input">
          {/* Main Input Area */}
          <div className="input-container">
            <textarea
              placeholder={isProcessing ? "AI is processing your homework..." : "Ask me anything about your homework..."}
              value={chatInput}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyPress={onKeyPress}
              disabled={isProcessing}
              className="chat-history-input"
            />
          </div>
          
          {/* Model Selector with Send Button */}
          <div className="model-selector">
            <div className="left-controls">
              <div className="ai-model-dropdown">
                <button 
                  className="ai-model-button" 
                  disabled={isProcessing}
                >
                  <Bot size={16} />
                  <span>ai model</span>
                  <ChevronDown size={14} />
                </button>
              </div>
            </div>
            <button 
              className={`send-btn ${chatInput.trim() ? 'analyze-mode' : ''}`}
              disabled={isProcessing || !chatInput.trim()}
              onClick={onSendMessage}
            >
              {isProcessing ? (
                <div className="send-spinner"></div>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default ChatInterface;
