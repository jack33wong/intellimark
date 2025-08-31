import React, { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import './MarkHomeworkPage.css';

const MarkHomeworkPage = () => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [classificationResult, setClassificationResult] = useState(null);
  const [isChatMode, setIsChatMode] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const fileInputRef = useRef(null);

  const models = [
    { id: 'chatgpt-4o', name: 'ChatGPT-4o', description: 'Latest OpenAI model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced model' },
    { id: 'chatgpt-5', name: 'ChatGPT-5', description: 'Next generation AI' }
  ];

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setError(null);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please select a valid image file');
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedFile(file);
      setError(null);
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setError('Please drop a valid image file');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const processHomework = async () => {
    if (!selectedFile) {
      setError('Please select an image first');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setClassificationResult(null);

    try {
      console.log('🔍 ===== PROCESSING HOMEWORK =====');
      const formData = new FormData();
      formData.append('imageData', previewUrl);
      formData.append('model', selectedModel);

      const response = await fetch('/api/mark-homework/mark-homework', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: previewUrl,
          model: selectedModel
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log('🔍 Frontend received response:', data);
        // Handle classification result
        if (data.isQuestionOnly) {
          console.log('🔍 Image classified as question-only, switching to chat mode');
          // Image classified as question-only, switch to chat mode
          setClassificationResult(data);
          setIsChatMode(true);
          
          // Initialize chat with the image and automatically send first message
          const initialMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: `I have an image that was classified as question-only. Can you help me with this?`,
            timestamp: new Date(),
            imageData: previewUrl
          };
          setChatMessages([initialMessage]);
          
          // Automatically send the first message to get AI response
          setTimeout(() => {
            sendInitialChatMessage(previewUrl, selectedModel);
          }, 500);
        } else {
          console.log('🔍 Image classified as homework, showing marking results');
          // Image classified as homework, show marking results
          setResult(data);
        }
      } else {
        setError(data.error || 'Failed to process homework');
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Send initial chat message when switching to chat mode
  const sendInitialChatMessage = async (imageData, model) => {
    console.log('🔍 ===== SENDING INITIAL CHAT MESSAGE =====');
    console.log('🔍 Image data length:', imageData.length);
    console.log('🔍 Model:', model);
    
    setIsChatLoading(true);
    
    try {
      const response = await fetch('/api/chat/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'I have an image that was classified as question-only. Can you help me with this?',
          imageData: imageData,
          model: model
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log('🔍 Initial chat response received:', data.response.substring(0, 100) + '...');
        
        // Add AI response to chat
        const aiResponse = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        };
        
        setChatMessages(prev => [...prev, aiResponse]);
      } else {
        console.error('🔍 Initial chat failed:', data.error);
        
        // Add error message to chat
        const errorResponse = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Sorry, I encountered an error while processing your image. Please try again.',
          timestamp: new Date()
        };
        
        setChatMessages(prev => [...prev, errorResponse]);
      }
    } catch (error) {
      console.error('🔍 Initial chat network error:', error);
      
      // Add error message to chat
      const errorResponse = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered a network error. Please check your connection and try again.',
        timestamp: new Date()
      };
      
      setChatMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Chat functionality
  const sendChatMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;
    
    const userMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date()
    };
    
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);
    
    try {
      console.log('🔍 ===== SENDING CHAT MESSAGE =====');
      console.log('🔍 Message:', chatInput.trim());
      console.log('🔍 Model:', selectedModel);
      
      const response = await fetch('/api/chat/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: chatInput.trim(),
          imageData: previewUrl,
          model: selectedModel
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log('🔍 Chat response received:', data.response.substring(0, 100) + '...');
        
        // Add AI response to chat
        const aiResponse = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        };
        
        setChatMessages(prev => [...prev, aiResponse]);
      } else {
        console.error('🔍 Chat failed:', data.error);
        
        // Add error message to chat
        const errorResponse = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Sorry, I encountered an error while processing your message. Please try again.',
          timestamp: new Date()
        };
        
        setChatMessages(prev => [...prev, errorResponse]);
      }
    } catch (error) {
      console.error('🔍 Chat network error:', error);
      
      // Add error message to chat
      const errorResponse = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered a network error. Please check your connection and try again.',
        timestamp: new Date()
      };
      
      setChatMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsChatLoading(false);
    }
  };
  
  const handleChatKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };
  
  const switchBackToHomework = () => {
    setIsChatMode(false);
    setChatMessages([]);
    setChatInput('');
    setClassificationResult(null);
  };

  const resetForm = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Render chat interface when in chat mode
  if (isChatMode) {
    return (
      <div className="mark-homework-page chat-mode">
        <div className="chat-header">
          <h1>Chat Mode - Question Assistance</h1>
          <p>Your image has been classified as question-only. Chat with AI to get help!</p>
          <button className="switch-mode-btn" onClick={switchBackToHomework}>
            ← Back to Homework Marking
          </button>
        </div>
        
        <div className="chat-content">
          <div className="image-context">
            <img src={previewUrl} alt="Question context" className="context-image" />
            <div className="classification-info">
              <strong>Classification:</strong> {classificationResult?.reasoning}
            </div>
          </div>
          
          <div className="chat-messages">
            {chatMessages.map((message) => (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <div className="message-avatar">
                  {message.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className="message-content">
                  <div className="message-text">{message.content}</div>
                  <div className="message-timestamp">
                    {message.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            
            {isChatLoading && (
              <div className="chat-message assistant">
                <div className="message-avatar">🤖</div>
                <div className="message-content">
                  <div className="message-text">Thinking...</div>
                </div>
              </div>
            )}
          </div>
          
          <div className="chat-input">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={handleChatKeyPress}
              placeholder="Ask about the question in the image..."
              disabled={isChatLoading}
              rows={2}
            />
            <button 
              onClick={sendChatMessage}
              disabled={!chatInput.trim() || isChatLoading}
              className="send-btn"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render homework interface when not in chat mode
  return (
    <div className="mark-homework-page">
      <div className="mark-homework-header">
        <h1>Mark Homework</h1>
        <p>Upload an image of homework to get AI-powered marking and feedback</p>
      </div>

      <div className="mark-homework-content">
        <div className="upload-section">
          <div className="model-selector">
            <label htmlFor="model-select">AI Model:</label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="model-dropdown"
            >
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`upload-area ${previewUrl ? 'has-preview' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            
            {!previewUrl ? (
              <div className="upload-placeholder">
                <Upload className="upload-icon" />
                <h3>Upload Homework Image</h3>
                <p>Drag and drop an image here, or click to browse</p>
                <span className="upload-hint">Supports JPG, PNG, GIF</span>
              </div>
            ) : (
              <div className="preview-container">
                <img src={previewUrl} alt="Homework preview" className="preview-image" />
                <div className="preview-overlay">
                  <button className="change-image-btn" onClick={(e) => {
                    e.stopPropagation();
                    resetForm();
                  }}>
                    Change Image
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="error-message">
              <AlertCircle className="error-icon" />
              <span>{error}</span>
            </div>
          )}

          <div className="action-buttons">
            <button
              className="process-btn"
              onClick={processHomework}
              disabled={!selectedFile || isProcessing}
            >
              {isProcessing ? (
                <>
                  <div className="loading-spinner"></div>
                  Processing...
                </>
              ) : (
                <>
                  <FileText className="btn-icon" />
                  Mark Homework
                </>
              )}
            </button>
            
            {selectedFile && (
              <button className="reset-btn" onClick={resetForm}>
                Reset
              </button>
            )}
          </div>
        </div>

        {result && (
          <div className="results-section">
            <div className="results-header">
              <CheckCircle className="success-icon" />
              <h2>Marking Complete</h2>
            </div>
            
            <div className="results-content">
              <div className="result-card">
                <h3>Extracted Text</h3>
                <div className="extracted-text">
                  {result.result?.ocrText || 'No text extracted'}
                </div>
              </div>

              <div className="result-card">
                <h3>Confidence Score</h3>
                <div className="confidence-score">
                  {((result.result?.confidence || 0) * 100).toFixed(1)}%
                </div>
              </div>

              {result.annotatedImage && (
                <div className="result-card">
                  <h3>Annotated Image</h3>
                  <div className="annotated-image">
                    <img src={result.annotatedImage} alt="Annotated homework" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat redirect section removed - now automatically redirects */}
        
        {/* Debug info */}
        <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0', fontSize: '12px' }}>
          <strong>Debug Info:</strong><br/>
          isChatMode: {String(isChatMode)}<br/>
          classificationResult: {classificationResult ? 'Present' : 'None'}<br/>
          result: {result ? 'Present' : 'None'}<br/>
          error: {error || 'None'}
        </div>
      </div>
    </div>
  );
};

export default MarkHomeworkPage;
