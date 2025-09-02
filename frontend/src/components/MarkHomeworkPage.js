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
      
      const aiMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'I understand your question. Let me provide a detailed explanation...',
        timestamp: new Date().toLocaleTimeString()
      };

      setChatMessages(prev => [...prev, aiMessage]);
    } catch (err) {
      setError('Failed to send message. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  }, [chatInput]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);

  if (isChatMode) {
    return (
      <div className="mark-homework-page">
        <div className="mark-homework-container">
          <div className="chat-mode">
            <div className="chat-header">
              <div className="chat-header-left">
                <h1>Homework Assistant</h1>
                <p>Ask me anything about your homework</p>
              </div>
              <div className="chat-header-right">
                <div>
                  <div className="classification-info">
                    Question detected
                  </div>
                  <img 
                    src={previewUrl} 
                    alt="Homework context" 
                    className="context-image"
                  />
                </div>
                <button 
                  className="raw-toggle-btn"
                  onClick={() => setShowRawResponse(!showRawResponse)}
                >
                  {showRawResponse ? 'Hide Raw' : 'Show Raw'}
                </button>
                <button 
                  className="switch-mode-btn"
                  onClick={() => setIsChatMode(false)}
                >
                  Switch Mode
                </button>
              </div>
            </div>

            <div className="chat-content">
              <div className="chat-messages">
                {chatMessages.map((message) => (
                  <div key={message.id} className="chat-message">
                    <div className="message-content">
                      <p className="message-text">{message.content}</p>
                    </div>
                    <div className="message-meta">
                      <span>{message.role === 'user' ? 'You' : 'AI Assistant'}</span>
                      <span>{message.timestamp}</span>
                    </div>
                  </div>
                ))}
                
                {isProcessing && (
                  <div className="chat-message">
                    <div className="message-content">
                      <p className="message-text">Thinking...</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="chat-input">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask me about your homework..."
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
          {/* Left Column - Upload Section */}
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
