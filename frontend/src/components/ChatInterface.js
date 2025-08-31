import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, User, Bot, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * ChatInterface component for displaying and sending messages
 * @param {Object} props - Component props
 * @param {Object} props.currentChat - Currently selected chat
 * @param {Function} props.onUpdateChatTitle - Function to update chat title
 * @returns {JSX.Element} The chat interface component
 */
function ChatInterface({ currentChat, onUpdateChatTitle }) {
  const location = useLocation();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [imageData, setImageData] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  
  // API base URL for development vs production
  const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : '';

  /**
   * Scroll to bottom of messages
   */
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  /**
   * Load messages for the current chat
   */
  const loadMessages = async (chatId) => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE}/api/chat/${chatId}/messages`);
      if (response.ok) {
        const chatMessages = await response.json();
        setMessages(chatMessages);
      } else {
        setError('Failed to load messages');
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      setError('Failed to load messages');
    }
  };

  /**
   * Send a message
   */
  const sendMessage = async () => {
    if (!inputValue.trim() || !currentChat || isLoading) return;

    const messageContent = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    try {
      const requestBody = { content: messageContent };
      
      // Include image data if available (for the first message)
      if (imageData && messages.length === 0) {
        requestBody.imageData = imageData;
      }

      const response = await fetch(`${API_BASE}/api/chat/${currentChat.id}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const { userMessage, aiResponse, chat } = await response.json();
        
        // Add new messages to the list
        setMessages(prev => [...prev, userMessage, aiResponse]);
        
        // Update chat title if this is the first message
        if (messages.length === 0) {
          onUpdateChatTitle(currentChat.id, chat.title);
        }
      } else {
        setError('Failed to send message');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setError('Failed to send message');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle Enter key press
   */
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Auto-resize textarea
   */
  const handleInputChange = (e) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  // Load messages when chat changes
  useEffect(() => {
    if (currentChat) {
      loadMessages(currentChat.id);
    } else {
      setMessages([]);
    }
  }, [currentChat]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input when chat changes
  useEffect(() => {
    if (currentChat && inputRef.current) {
      inputRef.current.focus();
    }
  }, [currentChat]);

  // Handle incoming image data from mark-homework page
  useEffect(() => {
    if (location.state?.autoStart && location.state?.imageData) {
      console.log('🔍 ChatInterface received image data:', location.state);
      setImageData(location.state.imageData);
      
      // Automatically start conversation with the image
      if (currentChat) {
        const autoMessage = {
          id: Date.now().toString(),
          role: 'user',
          content: `I have an image that was classified as question-only. Can you help me with this?`,
          timestamp: new Date(),
          imageData: location.state.imageData
        };
        
        // Add the auto-message to the chat
        setMessages([autoMessage]);
        
        // Clear the location state to prevent re-triggering
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, currentChat]);

  if (!currentChat) {
    return (
      <div className="main-content">
        <div className="empty-state">
          <MessageSquare className="empty-state-icon" size={64} />
          <h3>Welcome to Intellimark Chat</h3>
          <p>Start a new conversation to begin chatting with AI. Your chat history will appear here.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="main-content">
        <div className="error-state">
          <h3>Something went wrong</h3>
          <p>{error}</p>
          <button 
            className="retry-button"
            onClick={() => loadMessages(currentChat.id)}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      <div className="chat-header">
        <h2>{currentChat.title}</h2>
        {imageData && (
          <div className="image-indicator">
            📷 Image attached to conversation
          </div>
        )}
      </div>

      <div className="chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`message ${message.sender}`}
          >
            <div className="message-avatar">
              {message.sender === 'user' ? (
                <User size={16} />
              ) : (
                <Bot size={16} />
              )}
            </div>
            <div className="message-content">
              <div>{message.content}</div>
              <div className="message-timestamp">
                {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="message ai">
            <div className="message-avatar">
              <Bot size={16} />
            </div>
            <div className="message-content">
              <div>Thinking...</div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input">
        <div className="input-container">
          <textarea
            ref={inputRef}
            className="message-input"
            value={inputValue}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isLoading}
            rows={1}
          />
          <button
            className="send-button"
            onClick={sendMessage}
            disabled={!inputValue.trim() || isLoading}
          >
            <Send size={16} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChatInterface;
