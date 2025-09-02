import React, { useState, useCallback } from 'react';
import { Upload, MessageSquare } from 'lucide-react';
import './MarkHomeworkPage.css';

const MarkHomeworkPage = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [isChatMode, setIsChatMode] = useState(false);
  const [showRawResponse, setShowRawResponse] = useState(false);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  const handleFileSelect = useCallback((file) => {
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setError(null);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please select a valid image file (JPG, PNG, or GIF)');
      setSelectedFile(null);
      setPreviewUrl(null);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // For demo purposes, add a sample chat message
      setChatMessages([
        {
          id: 1,
          role: 'assistant',
          content: 'I\'ve analyzed your homework image. This appears to be a mathematics problem. How can I help you with it?',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      
      setIsChatMode(true);
    } catch (err) {
      setError('Failed to process the image. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile]);

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: chatInput,
      timestamp: new Date().toLocaleTimeString()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsProcessing(true);

    try {
      // Simulate AI response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const aiResponse = {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'I understand your question. Let me help you with this step by step...',
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatMessages(prev => [...prev, aiResponse]);
    } catch (err) {
      setError('Failed to send message. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [chatInput]);

  if (isChatMode) {
    return (
      <div className="mark-homework-page">
        <div className="chat-container">
          <div className="chat-header">
            <button 
              className="back-btn"
              onClick={() => setIsChatMode(false)}
            >
              ← Back to Upload
            </button>
            <h2>AI Homework Assistant</h2>
          </div>
          
          <div className="chat-messages">
            {chatMessages.map((message) => (
              <div 
                key={message.id} 
                className={`chat-message ${message.role}`}
              >
                <div className="message-content">
                  {message.content}
                </div>
                <div className="message-timestamp">
                  {message.timestamp}
                </div>
              </div>
            ))}
          </div>
          
          <div className="chat-input-container">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask me anything about your homework..."
              className="chat-input"
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              disabled={isProcessing}
            />
            <button 
              className="send-btn"
              onClick={handleSendMessage}
              disabled={isProcessing || !chatInput.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mark-homework-page">
      <div className="mark-homework-container">
        <div className="mark-homework-header">
          <h1>AI Homework Marker</h1>
          <p>Upload your homework images and get instant AI-powered feedback, explanations, and corrections</p>
        </div>

        <div className="mark-homework-content">
          {/* Upload Section */}
          <div className="upload-section">
            <div className="model-selector">
              <label htmlFor="model-select">Select AI Model</label>
              <select
                id="model-select"
                className="model-dropdown"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="chatgpt-4o">GPT-4o (Most Capable)</option>
                <option value="chatgpt-4">GPT-4 (Balanced)</option>
                <option value="chatgpt-3.5">GPT-3.5 (Fast)</option>
              </select>
            </div>

            {previewUrl ? (
              <div className="image-preview-container">
                <img 
                  src={previewUrl} 
                  alt="Homework preview" 
                  className="preview-image"
                />
                <div className="preview-overlay">
                  <div className="preview-info">
                    <div className="file-info">
                      <span className="file-name">{selectedFile?.name}</span>
                      <span className="file-size">
                        {(selectedFile?.size / 1024 / 1024).toFixed(2)} MB
                      </span>
                    </div>
                    <button 
                      className="change-image-btn"
                      onClick={() => document.getElementById('file-input').click()}
                    >
                      Change Image
                    </button>
                  </div>
                </div>
                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
              </div>
            ) : (
              <div
                className="upload-area"
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-input').click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  style={{ display: 'none' }}
                />
                
                <Upload className="upload-icon" />
                <div className="upload-text">Drop your homework here</div>
                <div className="upload-subtext">or click to browse files</div>
                <div className="upload-hint">Supports JPG, PNG, GIF</div>
              </div>
            )}

            {error && (
              <div className="error-message">
                <span>⚠️</span>
                {error}
              </div>
            )}

            <div className="upload-actions">
              <button
                className="upload-homework-btn"
                onClick={handleUpload}
                disabled={!selectedFile || isProcessing}
              >
                {isProcessing ? (
                  <>
                    <div className="spinner"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload />
                    Upload & Analyze
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarkHomeworkPage;
