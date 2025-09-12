import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Send, ChevronDown } from 'lucide-react';
import Button from '../common/Button';
import LoadingSpinner from '../common/LoadingSpinner';
import MarkdownMathRenderer from '../MarkdownMathRenderer';
import { generateId } from '../../utils/helpers';
// CSS imported via App.css to avoid webpack circular dependency

/**
 * Chat interface component for marking homework
 * @param {Object} props - Component props
 * @param {Array} props.messages - Chat messages
 * @param {Function} props.onSendMessage - Send message handler
 * @param {boolean} props.isProcessing - Whether AI is processing
 * @param {boolean} props.disabled - Whether input is disabled
 * @param {string} props.placeholder - Input placeholder text
 * @param {string} props.className - Additional CSS classes
 */
const ChatInterface = ({
  messages = [],
  onSendMessage,
  isProcessing = false,
  disabled = false,
  placeholder = "Ask a question about this image...",
  className = ''
}) => {
  const [inputValue, setInputValue] = useState('');
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesEndRef = useRef(null);
  const chatContentRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Check if scroll button should be shown
  useEffect(() => {
    const handleScroll = () => {
      if (chatContentRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = chatContentRef.current;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
        setShowScrollButton(!isAtBottom && messages.length > 0);
      }
    };

    const chatContent = chatContentRef.current;
    if (chatContent) {
      chatContent.addEventListener('scroll', handleScroll);
      handleScroll(); // Check initial state
    }

    return () => {
      if (chatContent) {
        chatContent.removeEventListener('scroll', handleScroll);
      }
    };
  }, [messages.length]);

  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isProcessing || disabled) return;

    const message = {
      id: generateId('msg'),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toLocaleTimeString(),
      showRaw: false
    };

    onSendMessage(message);
    setInputValue('');
  }, [inputValue, isProcessing, disabled, onSendMessage]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }, [handleSubmit]);

  const toggleRawContent = useCallback((messageId) => {
    // This would need to be handled by parent component
  }, []);

  return (
    <div className={`chat-interface ${className}`}>
      {/* Chat Messages */}
      <div className="chat-content" ref={chatContentRef}>
        <div className="chat-messages">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`chat-message chat-message-${message.role}`}
            >
              <div className="message-header">
                <span className="message-role">
                  {message.role === 'user' ? 'You' : 'AI'}
                </span>
                <span className="message-time">{message.timestamp}</span>
                {message.apiUsed && (
                  <span className="message-api">via {message.apiUsed}</span>
                )}
              </div>
              
              <div className="message-content">
                {message.type === 'question_original' && message.detectedQuestion && (
                  <div className="question-metadata">
                    <h4>Question {message.detectedQuestion.questionNumber}</h4>
                    <p>{message.detectedQuestion.questionText}</p>
                    <div className="confidence-badge">
                      Confidence: {Math.round(message.detectedQuestion.confidence * 100)}%
                    </div>
                  </div>
                )}
                
                {message.imageData && (
                  <div className="message-image">
                    <img 
                      src={message.imageData} 
                      alt="Message content" 
                      className="content-image"
                    />
                  </div>
                )}
                
                <div className="message-text">
                  <MarkdownMathRenderer content={typeof message.content === 'string' ? message.content : String(message.content || '')} />
                </div>
                
                {message.rawContent && message.rawContent !== message.content && (
                  <div className="message-raw">
                    <button
                      className="raw-toggle"
                      onClick={() => toggleRawContent(message.id)}
                    >
                      {message.showRaw ? 'Hide Raw' : 'Show Raw'}
                    </button>
                    {message.showRaw && (
                      <pre className="raw-content">{message.rawContent}</pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {isProcessing && (
            <div className="chat-message chat-message-assistant">
              <div className="message-content">
                <LoadingSpinner size="small" text="AI is thinking..." />
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
        
        {/* Scroll to Bottom Button */}
        {showScrollButton && (
          <button
            className="scroll-to-bottom"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={20} />
          </button>
        )}
      </div>

      {/* Chat Input */}
      <form className="chat-input-form" onSubmit={handleSubmit}>
        <div className="chat-input-container">
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            disabled={disabled || isProcessing}
            className="chat-input"
            rows={1}
          />
          <Button
            type="submit"
            variant="primary"
            size="medium"
            disabled={!inputValue.trim() || isProcessing || disabled}
            loading={isProcessing}
            className="send-button"
          >
            <Send size={20} />
          </Button>
        </div>
      </form>
    </div>
  );
};

export default ChatInterface;
