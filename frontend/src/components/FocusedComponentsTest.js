/**
 * Focused Components Test Page
 * Demonstrates the new focused components in action
 */

import React, { useState, useCallback } from 'react';
import { 
  ImageUpload, 
  ModelSelector, 
  SendButton, 
  ChatMessage 
} from './focused';
import { createUserMessage, createAssistantMessage } from '../utils/messageUtils';
import './FocusedComponentsTest.css';

const FocusedComponentsTest = () => {
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);

  // Handle image selection
  const handleImageSelect = useCallback((imageData) => {
    setSelectedImage(imageData);
    
    // Create user message with image
    const userMessage = createUserMessage('Image uploaded', {
      imageData: imageData.base64,
      imageLink: imageData.previewUrl,
      fileName: imageData.file.name
    });
    
    setMessages(prev => [...prev, userMessage]);
  }, []);

  // Handle send button click
  const handleSend = useCallback(() => {
    if (!selectedImage) return;
    
    setIsLoading(true);
    
    // Simulate AI response
    setTimeout(() => {
      const aiMessage = createAssistantMessage(
        `I can see you've uploaded an image. I'm using the ${selectedModel} model to analyze it. This is a test response.`,
        {
          type: 'question_response'
        }
      );
      
      setMessages(prev => [...prev, aiMessage]);
      setIsLoading(false);
    }, 2000);
  }, [selectedImage, selectedModel]);

  // Handle errors
  const handleError = useCallback((error) => {
    console.error('Component error:', error);
    alert(`Error: ${error.message}`);
  }, []);

  return (
    <div className="focused-components-test">
      <div className="test-header">
        <h1>Focused Components Test</h1>
        <p>Testing the new focused, maintainable components</p>
      </div>

      <div className="test-content">
        {/* Image Upload Test */}
        <div className="test-section">
          <h2>Image Upload Component</h2>
          <ImageUpload
            onImageSelect={handleImageSelect}
            onError={handleError}
            showPreview={true}
            placeholder="Upload an image to test"
          />
        </div>

        {/* Model Selector Test */}
        <div className="test-section">
          <h2>Model Selector Component</h2>
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onError={handleError}
            showDescriptions={true}
            size="medium"
          />
        </div>

        {/* Send Button Test */}
        <div className="test-section">
          <h2>Send Button Component</h2>
          <div className="button-group">
            <SendButton
              onClick={handleSend}
              onError={handleError}
              disabled={!selectedImage}
              loading={isLoading}
              text="Send Message"
              size="medium"
              variant="primary"
            />
            <SendButton
              onClick={() => alert('Secondary button clicked')}
              onError={handleError}
              text="Secondary"
              size="medium"
              variant="secondary"
            />
            <SendButton
              onClick={() => alert('Success button clicked')}
              onError={handleError}
              text="Success"
              size="medium"
              variant="success"
            />
          </div>
        </div>

        {/* Chat Messages Test */}
        <div className="test-section">
          <h2>Chat Messages Component</h2>
          <div className="chat-container">
            {messages.length === 0 ? (
              <div className="no-messages">
                <p>No messages yet. Upload an image and click send to see messages.</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <ChatMessage
                  key={message.id || index}
                  message={message}
                  onImageClick={(msg) => alert(`Image clicked: ${msg.fileName}`)}
                  onError={handleError}
                  showTimestamp={true}
                  showAvatar={true}
                />
              ))
            )}
          </div>
        </div>

        {/* Component Features */}
        <div className="test-section">
          <h2>Component Features</h2>
          <div className="features-grid">
            <div className="feature-card">
              <h3>ImageUpload</h3>
              <ul>
                <li>Drag & drop support</li>
                <li>File validation</li>
                <li>Preview generation</li>
                <li>Error handling</li>
                <li>Loading states</li>
              </ul>
            </div>
            <div className="feature-card">
              <h3>ModelSelector</h3>
              <ul>
                <li>Dropdown interface</li>
                <li>Model descriptions</li>
                <li>Size variants</li>
                <li>Keyboard navigation</li>
                <li>Click outside to close</li>
              </ul>
            </div>
            <div className="feature-card">
              <h3>SendButton</h3>
              <ul>
                <li>Loading states</li>
                <li>Size variants</li>
                <li>Color variants</li>
                <li>Icon support</li>
                <li>Accessibility</li>
              </ul>
            </div>
            <div className="feature-card">
              <h3>ChatMessage</h3>
              <ul>
                <li>User/Assistant styling</li>
                <li>Image display</li>
                <li>Timestamp support</li>
                <li>Avatar display</li>
                <li>Responsive design</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FocusedComponentsTest;
