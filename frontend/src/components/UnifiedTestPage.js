/**
 * Unified Test Page
 * Test the new unified image processing system
 */

import React, { useState } from 'react';
import UnifiedImageUpload from './UnifiedImageUpload';
import './UnifiedTestPage.css';

const UnifiedTestPage = () => {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(null);

  const handleImageProcessed = (userMessage, newSessionId) => {
    setSessionId(newSessionId);
  };

  const handleMessagesUpdate = (newMessages) => {
    setMessages(newMessages);
  };

  return (
    <div className="unified-test-page">
      <h1>Unified Image Processing Test</h1>
      
      <div className="test-section">
        <h2>Upload Image</h2>
        <UnifiedImageUpload
          onImageProcessed={handleImageProcessed}
          onMessagesUpdate={handleMessagesUpdate}
        />
      </div>

      <div className="test-section">
        <h2>Session Info</h2>
        <div className="session-info">
          <p><strong>Session ID:</strong> {sessionId || 'None'}</p>
          <p><strong>Message Count:</strong> {messages.length}</p>
        </div>
      </div>

      <div className="test-section">
        <h2>Messages</h2>
        <div className="messages-display">
          {messages.length === 0 ? (
            <p>No messages yet. Upload an image to see messages here.</p>
          ) : (
            messages.map((message, index) => (
              <div key={message.id || index} className="message-item">
                <div className="message-header">
                  <strong>{message.role}</strong> - {message.type}
                </div>
                <div className="message-content">
                  {message.content}
                </div>
                {message.imageData && (
                  <div className="message-image">
                    <img 
                      src={message.imageData} 
                      alt="Message image" 
                      style={{ maxWidth: '200px', maxHeight: '200px' }}
                    />
                  </div>
                )}
                <div className="message-metadata">
                  <small>ID: {message.id}</small>
                  <small>Timestamp: {message.timestamp}</small>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedTestPage;
