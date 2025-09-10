import React, { useState, useRef, useEffect, useCallback } from 'react';
import './TestScrollPage.css';

const TestScrollPage = () => {
  const [messages, setMessages] = useState([]);
  const [messageCount, setMessageCount] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [scrollDebugInfo, setScrollDebugInfo] = useState({});
  const [isScrolling, setIsScrolling] = useState(false);
  const chatContainerRef = useRef(null);
  const messageInputRef = useRef(null);
  const scrollTimeoutRef = useRef(null);

  // Add different types of messages
  const addMessage = () => {
    const messageTypes = [
      { type: 'short', text: `Short msg ${messageCount + 1}` },
      { type: 'medium', text: `This is a medium length message that should test the scroll behavior with more content. Message ${messageCount + 1}` },
      { type: 'long', text: `This is a very long message that contains multiple lines of text to really test the scroll behavior. It should wrap to multiple lines and create a taller message that will help us see if the scroll positioning is working correctly. This message is designed to be long enough to test various scroll scenarios. Message ${messageCount + 1}` },
      { type: 'code', text: `\`\`\`javascript\nfunction testScroll() {\n  console.log("Testing scroll behavior");\n  return "This is a code block";\n}\n\`\`\`` },
      { type: 'math', text: `Math equation: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$` }
    ];
    
    const randomType = messageTypes[Math.floor(Math.random() * messageTypes.length)];
    const newMessage = {
      id: Date.now(),
      type: randomType.type,
      text: randomType.text,
      timestamp: new Date().toLocaleTimeString()
    };
    setMessages(prev => [...prev, newMessage]);
    setMessageCount(prev => prev + 1);
  };

  // Add multiple messages
  const addManyMessages = () => {
    const newMessages = [];
    for (let i = 0; i < 10; i++) {
      newMessages.push({
        id: Date.now() + i,
        type: 'bulk',
        text: `Bulk message ${messageCount + i + 1} - This is a test message to fill up the chat with content and test scroll behavior.`,
        timestamp: new Date().toLocaleTimeString()
      });
    }
    setMessages(prev => [...prev, ...newMessages]);
    setMessageCount(prev => prev + 10);
  };

  // Add image message
  const addImageMessage = () => {
    const newMessage = {
      id: Date.now(),
      type: 'image',
      text: 'Test image message',
      imageUrl: 'https://via.placeholder.com/300x200/007bff/ffffff?text=Test+Image',
      timestamp: new Date().toLocaleTimeString()
    };
    setMessages(prev => [...prev, newMessage]);
    setMessageCount(prev => prev + 1);
  };

  // Add very long message
  const addLongMessage = () => {
    const longText = `This is an extremely long message designed to test the scroll behavior with a lot of content. 
    
    It contains multiple paragraphs and should create a very tall message that will definitely require scrolling.
    
    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
    
    Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
    
    Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.
    
    This message should definitely test the scroll behavior thoroughly!`;
    
    const newMessage = {
      id: Date.now(),
      type: 'very-long',
      text: longText,
      timestamp: new Date().toLocaleTimeString()
    };
    setMessages(prev => [...prev, newMessage]);
    setMessageCount(prev => prev + 1);
  };

  // Clear all messages
  const clearMessages = () => {
    setMessages([]);
    setMessageCount(0);
  };

  // Send message from input
  const sendMessage = () => {
    const input = messageInputRef.current;
    if (input && input.value.trim()) {
      const newMessage = {
        id: Date.now(),
        text: input.value.trim(),
        timestamp: new Date().toLocaleTimeString()
      };
      setMessages(prev => [...prev, newMessage]);
      setMessageCount(prev => prev + 1);
      input.value = '';
    }
  };

  // Handle Enter key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  // Scroll to bottom with debugging
  const scrollToBottom = () => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      const scrollTop = container.scrollHeight - container.clientHeight;
      
      setIsScrolling(true);
      container.scrollTop = scrollTop;
      
      // Update debug info
      setScrollDebugInfo({
        scrollTop: scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        isAtBottom: true,
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Clear scrolling state after animation
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 300);
    }
  };

  // Handle scroll events with enhanced debugging
  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      const { scrollTop, scrollHeight, clientHeight } = container;
      
      // Check if we're at the bottom (within 10px tolerance) - more reliable calculation
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isAtBottom = distanceFromBottom <= 10;
      
      // Check if scroll button should be shown - match MarkHomeworkPage logic
      const shouldShowButton = !isAtBottom && messages.length > 0;
      setShowScrollButton(shouldShowButton);
      
      // Debug logging
      console.log('Scroll Debug:', {
        scrollTop: Math.round(scrollTop),
        scrollHeight: Math.round(scrollHeight),
        clientHeight: Math.round(clientHeight),
        distanceFromBottom: Math.round(distanceFromBottom),
        isAtBottom,
        messagesLength: messages.length,
        shouldShowButton
      });
      
      // Update debug info
      setScrollDebugInfo({
        scrollTop: Math.round(scrollTop),
        scrollHeight: Math.round(scrollHeight),
        clientHeight: Math.round(clientHeight),
        isAtBottom,
        distanceFromBottom: Math.round(distanceFromBottom),
        timestamp: new Date().toLocaleTimeString()
      });
    }
  }, [messages.length]);

  // Auto-scroll to bottom when new messages are added (if enabled)
  useEffect(() => {
    if (autoScrollEnabled) {
      scrollToBottom();
    }
  }, [messages, autoScrollEnabled]);

  // Show button if there are messages and content is scrollable - match MarkHomeworkPage logic
  useEffect(() => {
    if (messages.length > 0) {
      if (chatContainerRef.current) {
        const container = chatContainerRef.current;
        const isScrollable = container.scrollHeight > container.clientHeight;
        setShowScrollButton(isScrollable);
      }
    } else {
      setShowScrollButton(false);
    }
  }, [messages.length]);

  // Add scroll event listener
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll(); // Check initial state
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  return (
    <div className="test-scroll-page chat-mode">
      {/* Enhanced Test Controls */}
      <div className="test-controls">
        <div className="control-section">
          <h4>Message Types</h4>
          <button className="test-btn" onClick={addMessage}>Random Message</button>
          <button className="test-btn" onClick={addImageMessage}>Image Message</button>
          <button className="test-btn" onClick={addLongMessage}>Very Long Message</button>
          <button className="test-btn" onClick={addManyMessages}>Add 10 Messages</button>
        </div>
        
        <div className="control-section">
          <h4>Controls</h4>
          <button className="test-btn" onClick={clearMessages}>Clear All</button>
          <label className="toggle-label">
            <input 
              type="checkbox" 
              checked={autoScrollEnabled}
              onChange={(e) => setAutoScrollEnabled(e.target.checked)}
            />
            Auto-scroll
          </label>
        </div>
        
        <div className="control-section">
          <h4>Stats</h4>
          <div className="message-count">Messages: <span>{messageCount}</span></div>
          <div className="scroll-status">
            Status: <span className={isScrolling ? 'scrolling' : 'idle'}>
              {isScrolling ? 'Scrolling...' : 'Idle'}
            </span>
          </div>
        </div>
      </div>

      {/* Debug Info Panel */}
      <div className="debug-panel">
        <h4>Scroll Debug Info</h4>
        <div className="debug-info">
          <div>Scroll Top: {scrollDebugInfo.scrollTop || 0}px</div>
          <div>Scroll Height: {scrollDebugInfo.scrollHeight || 0}px</div>
          <div>Client Height: {scrollDebugInfo.clientHeight || 0}px</div>
          <div>Distance from Bottom: {scrollDebugInfo.distanceFromBottom || 0}px</div>
          <div>At Bottom: {scrollDebugInfo.isAtBottom ? 'Yes' : 'No'}</div>
          <div>Near Bottom: {scrollDebugInfo.isNearBottom ? 'Yes' : 'No'}</div>
          <div>Last Update: {scrollDebugInfo.timestamp || 'Never'}</div>
        </div>
      </div>

      {/* Test Chat Container - The "Grow" Element */}
      <div 
        className="test-chat-container" 
        ref={chatContainerRef}
      >
        {/* Test Chat Messages */}
        <div className="test-chat-messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>No messages yet. Click "Random Message" to start testing!</p>
              <p>Try different message types to test various scroll scenarios.</p>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`message message-${message.type}`}>
                <div className="message-content">
                  <div className="message-type-badge">{message.type}</div>
                  <div className="message-text">
                    {message.type === 'image' ? (
                      <div>
                        <div>{message.text}</div>
                        <img 
                          src={message.imageUrl} 
                          alt="Test" 
                          className="message-image"
                          onLoad={() => {
                            // Trigger scroll update when image loads
                            setTimeout(() => {
                              if (autoScrollEnabled) {
                                scrollToBottom();
                              }
                            }, 100);
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ whiteSpace: 'pre-wrap' }}>{message.text}</div>
                    )}
                  </div>
                  <div className="message-time">{message.timestamp}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Test Input Bar - The "Fixed Size" Element */}
      <div className="test-input-bar">
        <input 
          type="text" 
          className="input-field" 
          ref={messageInputRef}
          placeholder="Type a message..." 
          onKeyPress={handleKeyPress}
        />
        <button className="send-btn" onClick={sendMessage}>Send</button>
      </div>

      {/* Test Scroll to Bottom Button */}
      <div className={`test-scroll-to-bottom-container ${showScrollButton ? 'show' : 'hidden'}`}>
        <button 
          className="test-scroll-to-bottom"
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          ↓
        </button>
      </div>
    </div>
  );
};

export default TestScrollPage;
