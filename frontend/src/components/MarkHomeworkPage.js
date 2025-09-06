import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload } from 'lucide-react';
import './MarkHomeworkPage.css';
import API_CONFIG from '../config/api';
import MarkdownMathRenderer from './MarkdownMathRenderer';

const MarkHomeworkPage = ({ selectedMarkingResult, onClearSelectedResult, onMarkingResultSaved, onPageModeChange }) => {
  // === CORE STATE ===
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  // const [isShowingHistoricalData, setIsShowingHistoricalData] = useState(false); // Removed - not used
  
  // Notify parent of page mode changes
  useEffect(() => {
    if (onPageModeChange) {
      onPageModeChange(pageMode);
    }
  }, [pageMode, onPageModeChange]);
  
  // === UPLOAD MODE STATE ===
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [apiResponse, setApiResponse] = useState(null);
  const [classificationResult, setClassificationResult] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [lastUploadedImageData, setLastUploadedImageData] = useState(null);
  
  // === CHAT MODE STATE ===
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [lastScrollTop, setLastScrollTop] = useState(0);
  const [showExpandedThinking, setShowExpandedThinking] = useState(false);
  const [showMarkingSchemeDetails, setShowMarkingSchemeDetails] = useState(false);
  const [showInfoDropdown, setShowInfoDropdown] = useState(false);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showInfoDropdown && !event.target.closest('.info-dropdown') && !event.target.closest('.info-btn')) {
        setShowInfoDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showInfoDropdown]);
  
  // === REFS ===
  // const fileInputRef = useRef(null); // Removed - not used
  const chatMessagesRef = useRef(null);

  const models = [
    { id: 'chatgpt-4o', name: 'ChatGPT-4o', description: 'Latest OpenAI model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced model' },
    { id: 'chatgpt-5', name: 'ChatGPT-5', description: 'Next generation AI' }
  ];

  // === MODE MANAGEMENT ===
  
  // Reset component state when component is mounted fresh (key change)
  useEffect(() => {
    setPageMode('upload');
    setChatMessages([]);
    setChatInput('');
    setCurrentSessionId(null);
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    setApiResponse(null);
    setClassificationResult(null);
    setLastUploadedImageData(null);
    setLastScrollTop(0);
    setShowExpandedThinking(false);
    setShowMarkingSchemeDetails(false);
    setLoadingProgress(0);
    // Clear localStorage
    localStorage.removeItem('chatSessionId');
    localStorage.removeItem('chatMessages');
    localStorage.setItem('isChatMode', 'false');
  }, []); // Empty dependency array means this runs once on mount
  
  // Handle selected marking result from sidebar
  useEffect(() => {
    if (selectedMarkingResult) {
      
      // Switch to chat mode to display the session messages
      setPageMode('chat');
      
      // Load the session messages into chat
      if (selectedMarkingResult.messages && Array.isArray(selectedMarkingResult.messages)) {
        // Convert Firestore messages to chat format
        const formattedMessages = selectedMarkingResult.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          rawContent: msg.rawContent || msg.content, // Store raw content for toggle
          timestamp: (() => {
            try {
              // Handle already formatted Date objects from backend
              if (msg.timestamp instanceof Date) {
                return msg.timestamp.toLocaleString();
              }
              // Handle Firestore timestamp with _seconds
              else if (msg.timestamp && typeof msg.timestamp === 'object' && msg.timestamp._seconds) {
                return new Date(msg.timestamp._seconds * 1000).toLocaleString();
              }
              // Handle Firestore timestamp with toDate method
              else if (msg.timestamp && typeof msg.timestamp === 'object' && msg.timestamp.toDate) {
                return msg.timestamp.toDate().toLocaleString();
              }
              // Handle ISO string or other valid date formats
              else if (msg.timestamp && (typeof msg.timestamp === 'string' || typeof msg.timestamp === 'number')) {
                const date = new Date(msg.timestamp);
                if (!isNaN(date.getTime())) {
                  return date.toLocaleString();
                }
              }
              // Fallback to current time
              return new Date().toLocaleString();
            } catch (error) {
              console.warn('Error parsing timestamp:', error, 'Raw timestamp:', msg.timestamp);
              return new Date().toLocaleString();
            }
          })(),
          type: msg.type,
          imageLink: msg.imageLink,
          imageData: msg.imageData,
          markingData: msg.markingData,
          model: msg.model,
          detectedQuestion: msg.detectedQuestion,
          apiUsed: msg.apiUsed, // Add API used field
          showRaw: msg.showRaw || false, // Add raw toggle state
          isImageContext: msg.isImageContext || false, // Add image context flag
          historicalData: msg.historicalData // Add historical data for marking messages
        }));
        
        setChatMessages(formattedMessages);
        setCurrentSessionId(selectedMarkingResult.id);
        
        // Scroll to bottom of chat
        setTimeout(() => {
          if (chatMessagesRef.current) {
            chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
          }
        }, 100);
      }
      
      // Clear the selected result after processing with a small delay
      if (onClearSelectedResult) {
        setTimeout(() => {
          onClearSelectedResult();
        }, 100);
      }
    }
  }, [selectedMarkingResult, onClearSelectedResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load session from localStorage on component mount
  useEffect(() => {
    const savedSessionId = localStorage.getItem('chatSessionId');
    const savedChatMessages = localStorage.getItem('chatMessages');
    const savedChatMode = localStorage.getItem('isChatMode');
    
    if (savedSessionId) {
      setCurrentSessionId(savedSessionId);
    }
    
    if (savedChatMessages) {
      try {
        const messages = JSON.parse(savedChatMessages);
        setChatMessages(messages);
      } catch (error) {
        console.error('❌ Failed to parse saved chat messages:', error);
      }
    }
    
    if (savedChatMode === 'true' && pageMode === 'upload') {
      setPageMode('chat');
    }
  }, [pageMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
    localStorage.setItem('isChatMode', (pageMode === 'chat').toString());
  }, [pageMode]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatMessagesRef.current && chatMessages.length > 0) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Handle expanded thinking bubble after 10 seconds
  useEffect(() => {
    let timer;
    if (isProcessing) {
      setShowExpandedThinking(false);
      timer = setTimeout(() => {
        setShowExpandedThinking(true);
      }, 10000); // 10 seconds
    } else {
      setShowExpandedThinking(false);
    }
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isProcessing]);

  // Handle fake loading progress when processing
  useEffect(() => {
    let progressInterval;
    if (isProcessing) {
      setLoadingProgress(0);
      progressInterval = setInterval(() => {
        setLoadingProgress(prev => {
          if (prev >= 95) return 95; // Stop at 95% until processing is complete
          return prev + Math.random() * 15; // Random increment between 0-15
        });
      }, 200); // Update every 200ms
    } else {
      setLoadingProgress(100); // Complete the progress bar
      setTimeout(() => setLoadingProgress(0), 500); // Reset after animation
    }
    
    return () => {
      if (progressInterval) clearInterval(progressInterval);
    };
  }, [isProcessing]);


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

  // Function to scale SVG coordinates to match displayed image - REMOVED (unused)

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

  // Send initial chat message when switching to chat mode
  const sendInitialChatMessage = useCallback(async (imageData, model, mode, sessionId = null) => {
    setIsProcessing(true);
    
    try {
      // Use the provided session ID, current session ID, or let the API create a new one
      const sessionIdToUse = sessionId || currentSessionId || null;
      
      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'I have a question about this image. Can you help me understand it?',
          imageData: imageData,
          model: model,
          sessionId: sessionIdToUse,
          ...(mode ? { mode } : {})
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update session ID if we got a new one
        if (data.sessionId && data.sessionId !== currentSessionId) {
          setCurrentSessionId(data.sessionId);
        }
        
        // Add AI response to chat
        const aiResponse = {
          id: Date.now() + 2,
          role: 'assistant',
          content: data.response,
          rawContent: data.response, // Store raw content for toggle
          timestamp: new Date().toLocaleTimeString(),
          apiUsed: data.apiUsed,
          showRaw: false // Track raw toggle state
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
  }, [currentSessionId, onMarkingResultSaved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle image analysis
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    setError(null);
    setApiResponse(null);
    setClassificationResult(null);
    
    try {
      // Convert image to base64
      const imageData = await fileToBase64(selectedFile);
      setLastUploadedImageData(imageData);

      // Prepare request payload
      const payload = {
        imageData: imageData,
        model: selectedModel
      };

      const apiUrl = API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK;

      // Get authentication token
      const authToken = localStorage.getItem('authToken');
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add authorization header if token is available
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Make API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Check if this is a question-only image
      if (result.isQuestionOnly) {
        // Store the classification result
        setClassificationResult({
          isQuestionOnly: true,
          reasoning: result.reasoning,
          apiUsed: result.apiUsed,
          questionDetection: result.questionDetection
        });
        
        // Switch to chat mode immediately
        setPageMode('chat');
        
        // Refresh mark history in sidebar
        if (onMarkingResultSaved) {
          onMarkingResultSaved();
        }
        
        // Set the session ID from the response
        setCurrentSessionId(result.sessionId);
        
        // Add initial user message with the image
        const initialUserMessage = {
          id: Date.now(),
          role: 'user',
          content: 'I have a question about this image. Can you help me understand it?',
          timestamp: new Date().toLocaleTimeString(),
          imageData: imageData,
          fileName: selectedFile.name
        };
        
        // Add the user message to chat
        setChatMessages([initialUserMessage]);
        
        // Automatically send the first chat message to get AI response
        setTimeout(() => {
          sendInitialChatMessage(imageData, selectedModel, null, result.sessionId);
        }, 500);
        
        return; // Exit early for question-only mode
      }

      // Store the API response and classification result
      setApiResponse(result);
      setClassificationResult({
        isQuestionOnly: false,
        reasoning: result.reasoning,
        apiUsed: result.apiUsed,
        questionDetection: result.questionDetection
      });

      // Refresh mark history in sidebar
      if (onMarkingResultSaved) {
        onMarkingResultSaved();
      }

      // Switch to chat mode with the marked homework
      setPageMode('chat');
      
      // Set the session ID from the response
      setCurrentSessionId(result.sessionId);
      
      // Add the marked homework message to chat
      const markedMessage = {
        id: Date.now(),
        role: 'assistant',
        content: 'Marking completed with annotations',
        timestamp: new Date().toLocaleTimeString(),
        type: 'marking_annotated',
        imageData: result.annotatedImage,
        markingData: {
          examDetails: result.questionDetection.match?.markingScheme?.examDetails || result.questionDetection.match?.examDetails || {},
          questionMarks: result.questionDetection.match?.markingScheme?.questionMarks || result.questionDetection.match?.questionMarks || {},
          confidence: result.questionDetection.match?.markingScheme?.confidence || result.questionDetection.match?.confidence || 0
        }
      };
      
      setChatMessages([markedMessage]);
      
    } catch (error) {
      console.error('❌ Upload error:', error);
      setError(`Failed to process the image: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, selectedModel, onMarkingResultSaved, sendInitialChatMessage]);

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
      // Convert image to base64
      const imageData = await fileToBase64(selectedFile);
      setLastUploadedImageData(imageData);

      // Prepare request payload
      const payload = {
        imageData: imageData,
        model: selectedModel
      };

      const apiUrl = API_CONFIG.BASE_URL + API_CONFIG.ENDPOINTS.MARK_HOMEWORK;

      // Get authentication token
      const authToken = localStorage.getItem('authToken');
      
      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
      };
      
      // Add authorization header if token is available
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      // Make API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      // Check if this is a question-only image
      if (result.isQuestionOnly) {
        // Store the classification result
        setClassificationResult({
          isQuestionOnly: true,
          reasoning: result.reasoning,
          apiUsed: result.apiUsed,
          questionDetection: result.questionDetection
        });
        
        // Switch to chat mode immediately
        setPageMode('chat');
        
        // Refresh mark history in sidebar
        if (onMarkingResultSaved) {
          onMarkingResultSaved();
        }
        
        // Set the session ID from the response
        setCurrentSessionId(result.sessionId);
        
        // Add initial user message with the image
        const initialUserMessage = {
          id: Date.now(),
          role: 'user',
          content: 'I have a question about this image. Can you help me understand it?',
          timestamp: new Date().toLocaleTimeString(),
          imageData: imageData,
          isImageContext: true
        };
        
        // Append to existing chat history instead of replacing
        setChatMessages(prevMessages => [...prevMessages, initialUserMessage]);
        
        // Automatically send the first chat message to get AI response
        setTimeout(() => {
          sendInitialChatMessage(imageData, selectedModel, null, result.sessionId);
        }, 500);
        
        return; // Exit early for question-only mode
      }

      // For regular homework images, go directly to chat mode
      setPageMode('chat');
      
      // Refresh mark history in sidebar
      if (onMarkingResultSaved) {
        onMarkingResultSaved();
      }
      
      // Since the backend already saves the data to Firestore, we can simulate the chat messages
      // by creating them from the response data and appending to existing chat history
      const newMessages = [
        {
          id: `msg-${Date.now()}`,
          role: 'user',
          content: 'Uploaded homework image for marking',
          timestamp: new Date().toLocaleString(),
          type: 'marking_original',
          imageData: imageData,
          detectedQuestion: result.questionDetection?.found ? {
            examDetails: result.questionDetection.match?.markingScheme?.examDetails || result.questionDetection.match?.examDetails || {},
            questionNumber: result.questionDetection.match?.questionNumber || 'Unknown',
            questionText: result.questionDetection.match?.questionText || result.classification?.extractedQuestionText || '',
            confidence: result.questionDetection.match?.markingScheme?.confidence || result.questionDetection.match?.confidence || 0
          } : undefined
        },
        {
          id: `msg-${Date.now() + 1}`,
          role: 'assistant',
          content: 'Marking completed with annotations',
          timestamp: new Date().toLocaleString(),
          type: 'marking_annotated',
          imageData: result.annotatedImage,
          detectedQuestion: result.questionDetection?.found ? {
            examDetails: result.questionDetection.match?.markingScheme?.examDetails || result.questionDetection.match?.examDetails || {},
            questionNumber: result.questionDetection.match?.questionNumber || 'Unknown',
            questionText: result.questionDetection.match?.questionText || result.classification?.extractedQuestionText || '',
            confidence: result.questionDetection.match?.markingScheme?.confidence || result.questionDetection.match?.confidence || 0
          } : undefined
        }
      ];
      
      // Append new messages to existing chat history instead of replacing
      setChatMessages(prevMessages => [...prevMessages, ...newMessages]);
      setCurrentSessionId(result.sessionId);
      
      // Auto-scroll to bottom
      setTimeout(() => {
        if (chatMessagesRef.current) {
          chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
        }
      }, 100);
      
    } catch (err) {
      console.error('❌ Upload error:', err);
      setError(`Failed to process the image: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, selectedModel, onMarkingResultSaved, sendInitialChatMessage]); // eslint-disable-line react-hooks/exhaustive-deps



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
      
      // Get the image data from the first user message (which contains the image)
      const firstUserMessage = chatMessages.find(msg => msg.role === 'user' && msg.imageData);
      const imageData = firstUserMessage?.imageData || lastUploadedImageData;
      
      // Use the current session ID if available, otherwise let the API create a new one
      const sessionIdToUse = currentSessionId || null;
      
      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: chatInput.trim(),
          imageData: imageData,
          model: selectedModel,
          sessionId: sessionIdToUse,
          mode: classificationResult?.isQuestionOnly ? 'question' : 'qa'
        }),
      });

      const data = await response.json();

             if (data.success) {
        
        // Update session ID if we got a new one
        if (data.sessionId && data.sessionId !== currentSessionId) {
          setCurrentSessionId(data.sessionId);
        }
        
        // Add AI response to chat
        const aiResponse = {
          id: Date.now() + 1,
          role: 'assistant',
          content: data.response,
          rawContent: data.response, // Store raw content for toggle
          timestamp: new Date().toLocaleTimeString(),
          apiUsed: data.apiUsed,
          showRaw: false // Track raw toggle state
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
  }, [chatInput, selectedModel, chatMessages, lastUploadedImageData, currentSessionId, classificationResult]);

  return (
    <>
      {pageMode === 'chat' ? (
        <div className="mark-homework-page chat-mode">
          <div className="chat-container">
            <div className="chat-header">
              <div className="chat-header-content">
                <div className="chat-header-left">
                  <h1>force and friction</h1>
                </div>
                <div className="chat-header-right">
                <button 
                  className="header-btn info-btn"
                  onClick={() => {
                    console.log('Info button clicked, current state:', showInfoDropdown);
                    console.log('Classification result:', classificationResult);
                    setShowInfoDropdown(!showInfoDropdown);
                  }}
                  title="Information"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 16v-4"/>
                    <path d="M12 8h.01"/>
                  </svg>
                </button>
                <button 
                  className="header-btn bookmark-btn"
                  onClick={() => {
                    // TODO: Implement bookmark functionality
                    console.log('Bookmark button clicked');
                  }}
                  title="Bookmark"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
                </div>
              </div>
            </div>
            
            {/* Info Dropdown */}
            {showInfoDropdown && (
              <div className="info-dropdown" style={{border: '2px solid red', background: 'yellow'}}>
                <div className="info-dropdown-content">
                  <div className="classification-info-chat">
                    <p><strong>Test Dropdown:</strong> This should be visible!</p>
                    {classificationResult ? (
                      <p><strong>Question Mode:</strong> {classificationResult.reasoning}</p>
                    ) : (
                      <p>No classification result available</p>
                    )}

                    {/* Exam Paper Detection for Chat Mode */}
                    {classificationResult && classificationResult.questionDetection && classificationResult.questionDetection.found && (
                      <div className="exam-paper-header-chat">
                         <div className="exam-paper-info-chat" style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px'}}>
                           <div style={{display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap'}}>
                             <h5 style={{margin: '0', fontSize: '16px'}}>📄 Detected Exam Paper</h5>
                             <div className="exam-paper-details-chat" style={{display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'}}>
                               <span className="exam-board">{classificationResult.questionDetection.match.board}</span>
                               <span className="exam-qualification">{classificationResult.questionDetection.match.qualification}</span>
                               <span className="exam-paper-code">{classificationResult.questionDetection.match.paperCode}</span>
                               <span className="exam-year">{classificationResult.questionDetection.match.year}</span>
                               {classificationResult.questionDetection.match.questionNumber && (
                                 <span className="question-number">Question {classificationResult.questionDetection.match.questionNumber}</span>
                               )}
                               {classificationResult.questionDetection.match.confidence && (
                                 <span className="confidence-score" style={{fontSize: '12px', color: 'var(--secondary-text)'}}>
                                   ({Math.round(classificationResult.questionDetection.match.confidence * 100)}% match)
                                 </span>
                               )}
                             </div>
                           </div>
                           {classificationResult.questionDetection.match.markingScheme && (
                             <button 
                               className="marking-scheme-btn"
                               onClick={() => {
                                 setShowMarkingSchemeDetails(!showMarkingSchemeDetails);
                               }}
                               title="Toggle Marking Scheme Details"
                               style={{marginLeft: 'auto', flexShrink: 0}}
                             >
                               📋 {showMarkingSchemeDetails ? 'Hide' : 'View'} Marking Scheme
                             </button>
                           )}
                         </div>

                         {/* Expandable Marking Scheme Details */}
                         {classificationResult.questionDetection.match.markingScheme && showMarkingSchemeDetails && (
                           <div className="marking-scheme-details" style={{
                             marginTop: '12px',
                             padding: '16px',
                             background: 'var(--tertiary-bg)',
                             border: '1px solid var(--border-color)',
                             borderRadius: '18px',
                             fontSize: '14px',
                             boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                             transition: 'all 0.2s ease'
                           }}>
                             <div style={{marginBottom: '12px'}}>
                               <strong>Answer:</strong> {classificationResult.questionDetection.match.markingScheme.questionMarks.answer}
                             </div>
                             
                             <div style={{marginBottom: '12px'}}>
                               <strong>Marks:</strong>
                               <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                 {classificationResult.questionDetection.match.markingScheme.questionMarks.marks.map((mark, index) => (
                                   <li key={index} style={{marginBottom: '6px'}}>
                                     <strong>{mark.mark}:</strong> {mark.answer}
                                     {mark.comments && <span style={{color: 'var(--secondary-text)', fontStyle: 'italic'}}> ({mark.comments})</span>}
                                   </li>
                                 ))}
                               </ul>
                             </div>
                             
                             {classificationResult.questionDetection.match.markingScheme.questionMarks.guidance && classificationResult.questionDetection.match.markingScheme.questionMarks.guidance.length > 0 && (
                               <div>
                                 <strong>Guidance:</strong>
                                 <ul style={{margin: '8px 0', paddingLeft: '20px'}}>
                                   {classificationResult.questionDetection.match.markingScheme.questionMarks.guidance.map((guidance, index) => (
                                     <li key={index} style={{marginBottom: '4px', color: 'var(--secondary-text)'}}>
                                       <strong>{guidance.scenario}:</strong> {guidance.outcome}
                                     </li>
                                   ))}
                                 </ul>
                               </div>
                             )}
                           </div>
                         )}
                       </div>
                     )}
                   </div>
                 </div>
               </div>
            )}
          
          <div className="chat-content">
            <div className="chat-messages" ref={chatMessagesRef}>
              {chatMessages.map((message) => (
                <div 
                  key={message.id} 
                  className={`chat-message ${message.role}`}
                >
                  <div className={`message-bubble ${(message.type === 'marking_original' || message.type === 'marking_annotated') ? 'marking-message' : ''}`}>
                    {message.role === 'assistant' ? (
                      <div>
                        <div className="assistant-header">intellimark</div>
                        <MarkdownMathRenderer 
                          content={message.content}
                          className="chat-message-renderer"
                        />
                        
                        {/* Handle marking messages with annotated images */}
                        {message.type === 'marking_annotated' && (message.imageLink || message.imageData) && (
                          <div className="homework-annotated-image">
                            <h4>✅ Marked Homework Image</h4>
                            <img 
                              src={message.imageLink || message.imageData}
                              alt="Marked homework"
                              className="annotated-image"
                            />
                            
                            {/* Display marking data if available */}
                            {message.markingData && (
                              <div className="marking-data-display">
                                <h5>📊 Marking Details</h5>
                                {message.markingData.ocrResult?.extractedText && (
                                  <div className="extracted-text">
                                    <strong>Extracted Text:</strong>
                                    <div className="text-content">{message.markingData.ocrResult.extractedText}</div>
                                  </div>
                                )}
                                {message.markingData.markingInstructions?.annotations?.length > 0 && (
                                  <div className="annotations-list">
                                    <strong>Annotations:</strong>
                                    <ul>
                                      {message.markingData.markingInstructions.annotations.map((annotation, index) => (
                                        <li key={index}>
                                          <span className="annotation-action">{annotation.action}:</span>
                                          {annotation.text && <span className="annotation-text">{annotation.text}</span>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Historical marking data display */}
                        {message.isHistorical && message.historicalData && (
                          <div className="historical-marking-data">
                            <div className="historical-header">
                              <h4>Marking Instructions</h4>
                              <div className="historical-meta">
                                <span>Model: {message.historicalData.model}</span>
                                <span>Date: {new Date(message.historicalData.createdAt?.toDate?.() || message.historicalData.createdAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                            
                            {message.historicalData.markingInstructions?.annotations?.length > 0 && (
                              <div className="marking-annotations">
                                <h5>Annotations:</h5>
                                <ul>
                                  {message.historicalData.markingInstructions.annotations.map((annotation, index) => (
                                    <li key={index}>
                                      <strong>{annotation.action}:</strong> {annotation.comment || annotation.text || 'No comment'}
                                      {annotation.bbox && (
                                        <span className="bbox-info">
                                          (Position: {annotation.bbox.join(', ')})
                                        </span>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            
                            {message.historicalData.ocrResult?.ocrText && (
                              <div className="historical-ocr">
                                <h5>Extracted Text:</h5>
                                <div className="ocr-text">
                                  {message.historicalData.ocrResult.ocrText}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        
                        <button 
                          className="raw-toggle-btn"
                          onClick={() => {
                            // const rawContent = message.rawContent || message.content; // Removed - not used
                            if (message.showRaw) {
                              message.showRaw = false;
                            } else {
                              message.showRaw = true;
                            }
                            setChatMessages([...chatMessages]);
                          }}
                          style={{marginTop: '8px', fontSize: '12px'}}
                        >
                          {message.showRaw ? 'Hide Raw' : 'Show Raw'}
                        </button>
                        {message.showRaw && (
                          <div className="raw-response">
                            <div className="raw-header">Raw Response</div>
                            <div className="raw-content">
                              {message.rawContent || message.content}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {/* Handle marking messages with images */}
                        {message.type === 'marking_original' && (message.imageLink || message.imageData) && (
                          <div className={`homework-annotated-image ${message.detectedQuestion ? 'with-header' : ''}`}>
                            {/* Question Header */}
                            {message.detectedQuestion && (
                              <div className="question-header">
                                <div className="exam-meta">
                                  <h3>📚 {message.detectedQuestion.examDetails?.board || 'Exam'} - {message.detectedQuestion.examDetails?.qualification || 'Question'}</h3>
                                  <div className="question-meta">
                                    <span className="paper-code">{message.detectedQuestion.examDetails?.paperCode || 'N/A'}</span>
                                    <span className="question-number">Question {message.detectedQuestion.questionNumber || 'N/A'}</span>
                                  </div>
                                </div>
                                {message.detectedQuestion.questionText && (
                                  <div className="question-text">
                                    <strong>Question:</strong> {message.detectedQuestion.questionText}
                                  </div>
                                )}
                              </div>
                            )}
                            <h4>📷 Original Homework Image</h4>
                            <img 
                              src={message.imageLink || message.imageData}
                              alt="Original homework"
                              className="annotated-image"
                            />
                          </div>
                        )}
                        
                        {/* Handle marking messages with annotated images */}
                        {message.type === 'marking_annotated' && (message.imageLink || message.imageData) && (
                          <div className={`homework-annotated-image ${message.detectedQuestion ? 'with-header' : ''}`}>
                            {/* Question Header */}
                            {message.detectedQuestion && (
                              <div className="question-header">
                                <div className="exam-meta">
                                  <h3>📚 {message.detectedQuestion.examDetails?.board || 'Exam'} - {message.detectedQuestion.examDetails?.qualification || 'Question'}</h3>
                                  <div className="question-meta">
                                    <span className="paper-code">{message.detectedQuestion.examDetails?.paperCode || 'N/A'}</span>
                                    <span className="question-number">Question {message.detectedQuestion.questionNumber || 'N/A'}</span>
                                  </div>
                                </div>
                                {message.detectedQuestion.questionText && (
                                  <div className="question-text">
                                     <strong>Question:</strong> {message.detectedQuestion.questionText}
                                   </div>
                                 )}
                               </div>
                             )}
                             <h4>✅ Marked Homework Image</h4>
                             <img 
                               src={message.imageLink || message.imageData}
                               alt="Marked homework"
                               className="annotated-image"
                             />
                           </div>
                         )}
                         
                         {/* Handle question-only messages with images */}
                         {message.type === 'question_original' && (message.imageLink || message.imageData) && (
                           <div className={`homework-annotated-image ${message.detectedQuestion ? 'with-header' : ''}`}>
                             {/* Question Header */}
                             {message.detectedQuestion && (
                               <div className="question-header">
                                 <div className="exam-meta">
                                   <h3>📚 {message.detectedQuestion.examDetails?.board || 'Exam'} - {message.detectedQuestion.examDetails?.qualification || 'Question'}</h3>
                                   <div className="question-meta">
                                     <span className="paper-code">{message.detectedQuestion.examDetails?.paperCode || 'N/A'}</span>
                                     <span className="question-number">Question {message.detectedQuestion.questionNumber || 'N/A'}</span>
                                   </div>
                                 </div>
                                 {message.detectedQuestion.questionText && (
                                   <div className="question-text">
                                     <strong>Question:</strong> {message.detectedQuestion.questionText}
                                   </div>
                                 )}
                               </div>
                             )}
                             <h4>📷 Question Image</h4>
                             <img 
                               src={message.imageLink || message.imageData}
                               alt="Question image"
                               className="annotated-image"
                             />
                           </div>
                         )}
                         
                         {/* Handle regular image context */}
                         {message.isImageContext && !message.type && (message.imageData || message.imageLink) && (
                           <div className="homework-annotated-image">
                             <img 
                               src={message.imageLink || message.imageData}
                               alt="Uploaded homework"
                               className="annotated-image"
                             />
                           </div>
                         )}
                         
                         {/* Handle text-only messages */}
                         {!message.isImageContext && !message.type && (
                           <div className="message-text">{message.content}</div>
                         )}
                       </div>
                     )}
                     <div className="message-timestamp">
                       {message.timestamp}
                     </div>
                   </div>
                 </div>
               ))}
               
               {/* AI Thinking Loading Animation */}
               {isProcessing && (
                 <div className="chat-message assistant">
                   <div className={`message-bubble ai-thinking ${showExpandedThinking ? 'expanded' : ''}`}>
                     <div className="thinking-indicator">
                       <div className="thinking-dots">
                         <div className="thinking-dot"></div>
                         <div className="thinking-dot"></div>
                         <div className="thinking-dot"></div>
                       </div>
                       <div className="thinking-text">
                         {showExpandedThinking ? 'AI is working on a detailed response...' : 'AI is analyzing your question...'}
                       </div>
                       {showExpandedThinking && (
                         <div className="progress-indicator">
                           <div className="progress-bar">
                             <div className="progress-fill"></div>
                           </div>
                           <div className="progress-text">Processing...</div>
                         </div>
                       )}
                     </div>
                   </div>
                 </div>
               )}
               

             </div>
          </div>
          
          {/* Bottom Input Bar */}
          <div className="chat-input-bar">
            <div className={`chat-input ${isProcessing ? 'processing' : ''}`}>
              {/* Model Selector */}
              <div className="model-selector">
                <select className="model-dropdown" disabled={isProcessing}>
                  <option value="chatgpt-4o">GPT-4o</option>
                  <option value="chatgpt-4">GPT-4</option>
                  <option value="claude-3">Claude 3</option>
                </select>
              </div>
              
              {/* Main Input Area */}
              <div className="input-container">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={isProcessing ? "AI is thinking..." : "Ask me anything about your homework..."}
                  onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                  disabled={isProcessing}
                />
              </div>
              
              {/* Action Buttons */}
              <div className="action-buttons">
                <button 
                  className="upload-btn"
                  onClick={() => document.getElementById('file-input').click()}
                  disabled={isProcessing}
                  title="Upload image"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                </button>
                
                <button 
                  className="send-btn"
                  onClick={handleSendMessage}
                  disabled={isProcessing || !chatInput.trim()}
                >
                  {isProcessing ? (
                    <div className="send-spinner"></div>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13"/>
                      <polygon points="22,2 15,22 11,13 2,9 22,2"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : (
    <div className="mark-homework-page upload-mode">
      {/* Main Content */}
      <div className="upload-main-content">
        <div className="upload-title-section">
          <div className="title-content">
            <h1>intellimark</h1>
            <p>Upload your homework images and get instant AI-powered feedback, explanations, and corrections</p>
          </div>
          <button 
            className={`title-upload-btn ${selectedFile && previewUrl ? 'has-image' : ''}`}
            onClick={() => document.getElementById('top-file-input').click()}
            style={selectedFile && previewUrl ? {
              backgroundImage: `url(${previewUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat'
            } : {}}
          >
            {selectedFile && previewUrl ? (
              <span className="change-image-text">Change Image</span>
            ) : (
              <>
                <Upload size={20} />
                Upload Homework
              </>
            )}
          </button>
        </div>

        {/* Hidden file input for top button */}
        <input
          id="top-file-input"
          type="file"
          accept="image/*"
          onChange={handleFileInput}
          style={{ display: 'none' }}
        />

      </div>

      {/* Loading Bar */}
      {isProcessing && (
        <div className="upload-loading-bar">
          <div className="loading-content">
            <div className="loading-text">Processing your homework...</div>
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${loadingProgress}%` }}
              ></div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Chat Input Bar */}
      <div className="upload-chat-input-bar">
        <div className="upload-chat-input">
          {/* Model Selector */}
          <div className="model-selector">
            <select className="model-dropdown" disabled={isProcessing}>
              <option value="chatgpt-4o">ChatGPT-4o</option>
              <option value="chatgpt-4">GPT-4</option>
              <option value="claude-3">Claude 3</option>
            </select>
          </div>
          
          {/* Main Input Area */}
          <div className="input-container">
            <textarea
              placeholder={isProcessing ? "AI is processing your homework..." : "Ask me anything about your homework..."}
              disabled={isProcessing}
            />
          </div>
          
          {/* Send/Analyze Button */}
          <button 
            className={`send-btn ${selectedFile ? 'analyze-mode' : ''}`}
            disabled={isProcessing || (!selectedFile && !chatInput.trim())}
            onClick={selectedFile ? handleAnalyzeImage : undefined}
          >
            {isProcessing ? (
              <div className="send-spinner"></div>
            ) : selectedFile ? (
              <span className="btn-text">Analyze</span>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13"/>
                <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
              </svg>
            )}
          </button>
        </div>
      </div>

    </div>
      )}
    </>
  );
};

export default MarkHomeworkPage;
