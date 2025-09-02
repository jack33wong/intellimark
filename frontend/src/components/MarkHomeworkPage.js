import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, MessageSquare } from 'lucide-react';
import './MarkHomeworkPage.css';
import API_CONFIG from '../config/api';

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
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [showRawResponses, setShowRawResponses] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const fileInputRef = useRef(null);
  const [imageDimensions, setImageDimensions] = useState(null);
  const [apiResponse, setApiResponse] = useState(null);
  const [classificationResult, setClassificationResult] = useState(null);

  const models = [
    { id: 'chatgpt-4o', name: 'ChatGPT-4o', description: 'Latest OpenAI model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced model' },
    { id: 'chatgpt-5', name: 'ChatGPT-5', description: 'Next generation AI' }
  ];

  // Load session from localStorage on component mount
  useEffect(() => {
    const savedSessionId = localStorage.getItem('chatSessionId');
    const savedChatMessages = localStorage.getItem('chatMessages');
    const savedChatMode = localStorage.getItem('isChatMode');
    
    if (savedSessionId) {
      setCurrentSessionId(savedSessionId);
      console.log('📝 Restored session ID from localStorage:', savedSessionId);
    }
    
    if (savedChatMessages) {
      try {
        const messages = JSON.parse(savedChatMessages);
        setChatMessages(messages);
        console.log('📝 Restored chat messages from localStorage:', messages.length, 'messages');
      } catch (error) {
        console.error('❌ Failed to parse saved chat messages:', error);
      }
    }
    
    if (savedChatMode === 'true') {
      setIsChatMode(true);
      console.log('📝 Restored chat mode from localStorage');
    }
  }, []);

  // Save session data to localStorage whenever it changes
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('chatSessionId', currentSessionId);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (chatMessages.length > 0) {
      localStorage.setItem('chatMessages', JSON.stringify(chatMessages));
    }
  }, [chatMessages]);

  useEffect(() => {
    localStorage.setItem('isChatMode', isChatMode.toString());
  }, [isChatMode]);

  // Function to convert file to base64
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // Keep the full data URL format for OpenAI API
        resolve(reader.result);
      };
      reader.onerror = error => reject(error);
    });
  };

  // Function to scale SVG coordinates to match displayed image
  const scaleSVGForDisplay = (svgString, originalWidth, originalHeight, displayWidth, displayHeight) => {
    if (!svgString || !originalWidth || !originalHeight || !displayWidth || !displayHeight) {
      return svgString;
    }

    const scaleX = displayWidth / originalWidth;
    const scaleY = displayHeight / originalHeight;

    console.log('🔍 Scaling SVG:', {
      original: `${originalWidth}x${originalHeight}`,
      display: `${displayWidth}x${displayHeight}`,
      scale: `${scaleX.toFixed(3)}x${scaleY.toFixed(3)}`
    });

    // Scale all numeric values in the SVG
    let scaledSVG = svgString
      .replace(/width="(\d+)"/, `width="${displayWidth}"`)
      .replace(/height="(\d+)"/, `height="${displayHeight}"`)
      .replace(/x="(\d+(?:\.\d+)?)"/g, (match, x) => `x="${(parseFloat(x) * scaleX).toFixed(1)}"`)
      .replace(/y="(\d+(?:\.\d+)?)"/g, (match, y) => `y="${(parseFloat(y) * scaleY).toFixed(1)}"`)
      .replace(/cx="(\d+(?:\.\d+)?)"/g, (match, cx) => `cx="${(parseFloat(cx) * scaleX).toFixed(1)}"`)
      .replace(/cy="(\d+(?:\.\d+)?)"/g, (match, cy) => `cy="${(parseFloat(cy) * scaleY).toFixed(1)}"`)
      .replace(/r="(\d+(?:\.\d+)?)"/g, (match, r) => `r="${(parseFloat(r) * Math.min(scaleX, scaleY)).toFixed(1)}"`)
      .replace(/x1="(\d+(?:\.\d+)?)"/g, (match, x1) => `x1="${(parseFloat(x1) * scaleX).toFixed(1)}"`)
      .replace(/y1="(\d+(?:\.\d+)?)"/g, (match, y1) => `y1="${(parseFloat(y1) * scaleY).toFixed(1)}"`)
      .replace(/x2="(\d+(?:\.\d+)?)"/g, (match, x2) => `x2="${(parseFloat(x2) * scaleX).toFixed(1)}"`)
      .replace(/y2="(\d+(?:\.\d+)?)"/g, (match, y2) => `y2="${(parseFloat(y2) * scaleY).toFixed(1)}"`);

    return scaledSVG;
  };

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
    setApiResponse(null);
    setClassificationResult(null);

    try {
      console.log('🚀 Starting homework marking process...');
      
      // Convert image to base64
      console.log('📸 Converting image to base64...');
      const imageData = await fileToBase64(selectedFile);
      console.log('📸 Image converted, length:', imageData.length);

      // Prepare request payload
      const payload = {
        imageData: imageData,
        model: selectedModel
      };

      const apiUrl = API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK;
      console.log('🌐 Making API call to:', apiUrl);
      console.log('🌐 API_CONFIG.BASE_URL:', API_CONFIG.BASE_URL);
      console.log('🌐 API_CONFIG.ENDPOINTS.MARK_HOMEWORK:', API_CONFIG.ENDPOINTS.MARK_HOMEWORK);
      console.log('🌐 Payload model:', payload.model);
      console.log('🌐 Payload imageData length:', payload.imageData.length);

      // Make API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      console.log('📡 Response status:', response.status);
      console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

             const result = await response.json();
       console.log('✅ API Response received:', result);

       // Check if this is a question-only image
       if (result.isQuestionOnly) {
         console.log('🔍 Image classified as question-only, switching to chat mode');
         
         // Store the classification result
         setClassificationResult({
           isQuestionOnly: true,
           reasoning: result.reasoning,
           apiUsed: result.apiUsed
         });
         
         // Switch to chat mode immediately
         setIsChatMode(true);
         
         // Add initial user message with the image
         const initialUserMessage = {
           id: Date.now(),
           role: 'user',
           content: 'I have a question that I need help with. Can you assist me?',
           timestamp: new Date().toLocaleTimeString(),
           imageData: imageData
         };
         
         setChatMessages([initialUserMessage]);
         
         // Automatically send the first chat message to get AI response
         setTimeout(() => {
           sendInitialChatMessage(imageData, selectedModel);
         }, 500);
         
         return; // Exit early for question-only mode
       }

       // For regular homework images, store the API response
       setApiResponse(result);
       
       // Extract classification result if available
       if (result.classificationResult) {
         setClassificationResult(result.classificationResult);
       }
      
    } catch (err) {
      console.error('❌ Upload error:', err);
      setError(`Failed to process the image: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
     }, [selectedFile, selectedModel]);

   // Send initial chat message when switching to chat mode
   const sendInitialChatMessage = useCallback(async (imageData, model) => {
     console.log('🔍 ===== SENDING INITIAL CHAT MESSAGE =====');
     console.log('🔍 Image data length:', imageData.length);
     console.log('🔍 Model:', model);
     console.log('🔍 Current session ID:', currentSessionId);
     
     setIsProcessing(true);
     
     try {
       const response = await fetch('/api/chat/', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({
           message: 'I have a question that I need help with. Can you assist me?',
           imageData: imageData,
           model: model,
           sessionId: currentSessionId
         }),
       });

       const data = await response.json();

       if (data.success) {
         console.log('🔍 Initial chat response received:', data.response.substring(0, 100) + '...');
         console.log('🔍 API Used:', data.apiUsed);
         console.log('🔍 Session ID from response:', data.sessionId);
         
         // Update session ID if we got a new one
         if (data.sessionId && data.sessionId !== currentSessionId) {
           setCurrentSessionId(data.sessionId);
         }
         
         // Add AI response to chat
         const aiResponse = {
           id: Date.now() + 2,
           role: 'assistant',
           content: data.response,
           timestamp: new Date().toLocaleTimeString(),
           apiUsed: data.apiUsed
         };
         
         setChatMessages(prev => [...prev, aiResponse]);
       } else {
         console.error('🔍 Initial chat failed:', data.error);
         
         // Add error message to chat
         const errorResponse = {
           id: Date.now() + 2,
           role: 'assistant',
           content: 'Sorry, I encountered an error while processing your image. Please try again.',
           timestamp: new Date().toLocaleTimeString()
         };
         
         setChatMessages(prev => [...prev, errorResponse]);
       }
     } catch (error) {
       console.error('🔍 Initial chat network error:', error);
       
       // Add error message to chat
       const errorResponse = {
         id: Date.now() + 2,
         role: 'assistant',
         content: 'Sorry, I encountered a network error. Please check your connection and try again.',
         timestamp: new Date().toLocaleTimeString()
       };
       
       setChatMessages(prev => [...prev, errorResponse]);
     } finally {
       setIsProcessing(false);
     }
   }, [currentSessionId]);

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
      console.log('🔍 ===== SENDING CHAT MESSAGE =====');
      console.log('🔍 Message:', chatInput.trim());
      console.log('🔍 Model:', selectedModel);
      console.log('🔍 Current session ID:', currentSessionId);
      
      // Get the image data from the first user message (which contains the image)
      const firstUserMessage = chatMessages.find(msg => msg.role === 'user' && msg.imageData);
      const imageData = firstUserMessage?.imageData || selectedFile;
      
      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: chatInput.trim(),
          imageData: imageData,
          model: selectedModel,
          sessionId: currentSessionId
        }),
      });

      const data = await response.json();

      if (data.success) {
        console.log('🔍 Chat response received:', data.response.substring(0, 100) + '...');
        console.log('🔍 API Used:', data.apiUsed);
        console.log('🔍 Session ID from response:', data.sessionId);
        console.log('🔍 Context info:', data.context);
        
        // Update session ID if we got a new one
        if (data.sessionId && data.sessionId !== currentSessionId) {
          setCurrentSessionId(data.sessionId);
        }
        
        // Add AI response to chat
        const aiResponse = {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.response,
          timestamp: new Date().toLocaleTimeString(),
          apiUsed: data.apiUsed
        };
        
        setChatMessages(prev => [...prev, aiResponse]);
      } else {
        console.error('🔍 Chat failed:', data.error);
        
        // Add error message to chat
        const errorResponse = {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'Sorry, I encountered an error while processing your message. Please try again.',
          timestamp: new Date().toLocaleTimeString()
        };
        
        setChatMessages(prev => [...prev, errorResponse]);
      }
    } catch (error) {
      console.error('🔍 Chat network error:', error);
      
      // Add error message to chat
      const errorResponse = {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'Sorry, I encountered a network error. Please check your connection and try again.',
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatMessages(prev => [...prev, errorResponse]);
    } finally {
      setIsProcessing(false);
    }
  }, [chatInput, selectedModel, chatMessages, selectedFile, currentSessionId]);

  if (isChatMode) {
    return (
      <div className="mark-homework-page">
        <div className="chat-container">
          <div className="chat-header">
            <button 
              className="back-btn"
              onClick={() => {
                setIsChatMode(false);
                setChatMessages([]);
                setChatInput('');
                setClassificationResult(null);
                setApiResponse(null);
                setCurrentSessionId(null);
                // Clear localStorage
                localStorage.removeItem('chatSessionId');
                localStorage.removeItem('chatMessages');
                localStorage.removeItem('isChatMode');
              }}
            >
              ← Back to Upload
            </button>
            <h2>AI Homework Assistant</h2>
            {currentSessionId && (
              <div className="session-info">
                <p><strong>Session:</strong> {currentSessionId.substring(0, 8)}...</p>
                <p><strong>Messages:</strong> {chatMessages.length}</p>
              </div>
            )}
            {classificationResult?.isQuestionOnly && (
              <div className="classification-info">
                <p><strong>Question Mode:</strong> {classificationResult.reasoning}</p>
              </div>
            )}
          </div>
          
          {/* Show the image context */}
          {previewUrl && (
            <div className="chat-image-context">
              <img src={previewUrl} alt="Question context" className="context-image" />
            </div>
          )}
          
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
                {models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} - {model.description}
                  </option>
                ))}
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

          {/* Results Section */}
          {apiResponse && (
            <div className="results-section">
              <h3>Analysis Results</h3>
              
              {classificationResult && (
                <div className="result-card">
                  <h4>Classification</h4>
                  <p><strong>Subject:</strong> {classificationResult.subject}</p>
                  <p><strong>Grade Level:</strong> {classificationResult.gradeLevel}</p>
                  <p><strong>Topic:</strong> {classificationResult.topic}</p>
                </div>
              )}

              {apiResponse.instructions && apiResponse.instructions.annotations && apiResponse.instructions.annotations.length > 0 && (
                <div className="result-card">
                  <h4>AI Annotations ({apiResponse.instructions.annotations.length})</h4>
                  <div className="annotations-list">
                    {apiResponse.instructions.annotations.map((annotation, index) => (
                      <div key={index} className="annotation-item">
                        <div className="annotation-action">
                          <span className={`action-badge action-${annotation.action}`}>
                            {annotation.action}
                          </span>
                        </div>
                        {annotation.comment && (
                          <div className="annotation-comment">
                            {annotation.comment}
                          </div>
                        )}
                        {annotation.text && (
                          <div className="annotation-text">
                            {annotation.text}
                          </div>
                        )}
                        <div className="annotation-position">
                          Position: [{annotation.bbox.join(', ')}]
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {apiResponse.annotatedImage && (
                <div className="result-card">
                  <h4>Annotated Image</h4>
                  <div className="annotated-image">
                    <div className="image-with-overlay">
                      <img 
                        src={previewUrl} 
                        alt="Original homework" 
                        className="base-image"
                        onLoad={(e) => {
                          const img = e.target;
                          console.log('🔍 Image loaded - Natural dimensions:', img.naturalWidth, 'x', img.naturalHeight);
                          console.log('🔍 Image loaded - Display dimensions:', img.offsetWidth, 'x', img.offsetHeight);
                          setImageDimensions({
                            natural: { width: img.naturalWidth, height: img.naturalHeight },
                            display: { width: img.offsetWidth, height: img.offsetHeight }
                          });
                        }}
                      />
                      <div 
                        className="svg-overlay" 
                        dangerouslySetInnerHTML={{ 
                          __html: imageDimensions ? 
                            scaleSVGForDisplay(
                              apiResponse.annotatedImage,
                              apiResponse.result?.imageDimensions?.width || 1466,
                              apiResponse.result?.imageDimensions?.height || 1364,
                              imageDimensions.display.width,
                              imageDimensions.display.height
                            ) : apiResponse.annotatedImage
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Debug info */}
              <div className="debug-info">
                <strong>Debug Info:</strong><br/>
                API Response: {apiResponse ? 'Present' : 'None'}<br/>
                Classification: {classificationResult ? 'Present' : 'None'}<br/>
                Error: {error || 'None'}<br/>
                {apiResponse && (
                  <>
                    <br/><strong>Response Details:</strong><br/>
                    hasAnnotatedImage: {apiResponse.annotatedImage ? 'Yes' : 'No'}<br/>
                    annotatedImageLength: {apiResponse.annotatedImage ? apiResponse.annotatedImage.length : 'N/A'}<br/>
                    hasInstructions: {apiResponse.instructions ? 'Yes' : 'No'}<br/>
                    annotationsCount: {apiResponse.instructions?.annotations?.length || 0}<br/>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarkHomeworkPage;
