import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload } from 'lucide-react';
import './MarkHomeworkPage.css';
import API_CONFIG from '../config/api';
import MarkdownMathRenderer from './MarkdownMathRenderer';

const MarkHomeworkPage = ({ selectedMarkingResult, onClearSelectedResult, onMarkingResultSaved }) => {
  // === CORE STATE ===
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  // const [isShowingHistoricalData, setIsShowingHistoricalData] = useState(false); // Removed - not used
  
  // === UPLOAD MODE STATE ===
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [apiResponse, setApiResponse] = useState(null);
  const [classificationResult, setClassificationResult] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  
  // === CHAT MODE STATE ===
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showChatHeader, setShowChatHeader] = useState(true);
  const [lastScrollTop, setLastScrollTop] = useState(0);
  const [showExpandedThinking, setShowExpandedThinking] = useState(false);
  const [showMarkingSchemeDetails, setShowMarkingSchemeDetails] = useState(false);
  
  // === REFS ===
  // const fileInputRef = useRef(null); // Removed - not used
  const chatMessagesRef = useRef(null);

  const models = [
    { id: 'chatgpt-4o', name: 'ChatGPT-4o', description: 'Latest OpenAI model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced model' },
    { id: 'chatgpt-5', name: 'ChatGPT-5', description: 'Next generation AI' }
  ];

  // === MODE MANAGEMENT ===
  
  // Handle selected marking result from sidebar
  useEffect(() => {
    if (selectedMarkingResult) {
      // Stay in upload mode but show historical data as "Analysis Results"
      setPageMode('upload');
      
      // Set image preview if available
      if (selectedMarkingResult.imageData) {
        setPreviewUrl(`data:image/jpeg;base64,${selectedMarkingResult.imageData}`);
      }
      
      // Set classification result if available
      if (selectedMarkingResult.classification) {
        setClassificationResult(selectedMarkingResult.classification);
      }
      
      // Create API response format from historical data (same as upload mode results)
      const historicalApiResponse = {
        annotatedImage: selectedMarkingResult.annotatedImage,
        instructions: selectedMarkingResult.markingInstructions,
        classificationResult: selectedMarkingResult.classification,
        questionDetection: selectedMarkingResult.questionDetection,
        isHistorical: true,
        historicalData: selectedMarkingResult
      };
      
      setApiResponse(historicalApiResponse);
      
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

  // Handle chat header visibility based on scroll with sustained scroll up detection
  useEffect(() => {
    let scrollUpTimer = null;
    let isCurrentlyScrollingUp = false;
    let cleanupFunction = null;

    const handleScroll = () => {
      if (chatMessagesRef.current) {
        const scrollTop = chatMessagesRef.current.scrollTop;
        const isScrollingUp = scrollTop < lastScrollTop;
        const isAtTop = scrollTop <= 10; // Show header when within 10px of top
        
        // Clear any existing timer
        if (scrollUpTimer) {
          clearTimeout(scrollUpTimer);
          scrollUpTimer = null;
        }
        
        // If at top, show header immediately
        if (isAtTop) {
          setShowChatHeader(true);
          isCurrentlyScrollingUp = false;
        }
        // If scrolling up, start a timer
        else if (isScrollingUp && !isCurrentlyScrollingUp) {
          isCurrentlyScrollingUp = true;
          scrollUpTimer = setTimeout(() => {
            setShowChatHeader(true);
            isCurrentlyScrollingUp = false;
          }, 500); // 0.5 second delay
        }
        // If scrolling down, hide header immediately
        else if (!isScrollingUp && scrollTop > 70) {
          setShowChatHeader(false);
          isCurrentlyScrollingUp = false;
        }
        
        setLastScrollTop(scrollTop);
      }
    };

    // Wait for the next tick to ensure the ref is available
    const timer = setTimeout(() => {
      const chatMessagesElement = chatMessagesRef.current;
      if (chatMessagesElement) {
        chatMessagesElement.addEventListener('scroll', handleScroll);
        
        // Store cleanup function
        cleanupFunction = () => {
          chatMessagesElement.removeEventListener('scroll', handleScroll);
          if (scrollUpTimer) {
            clearTimeout(scrollUpTimer);
          }
        };
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (scrollUpTimer) {
        clearTimeout(scrollUpTimer);
      }
      if (cleanupFunction) {
        cleanupFunction();
      }
    };
  }, [lastScrollTop, pageMode]);

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
  const sendInitialChatMessage = useCallback(async (imageData, model) => {
    setIsProcessing(true);
    
    try {
      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'chat-image-context',
          imageData: imageData,
          model: model,
          sessionId: currentSessionId
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
         
         // Add initial user message with the image
         const initialUserMessage = {
           id: Date.now(),
           role: 'user',
           content: 'chat-image-context',
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
       
       // Refresh mark history in sidebar
       if (onMarkingResultSaved) {

         onMarkingResultSaved();
       }
      
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
  }, [chatInput, selectedModel, chatMessages, selectedFile, currentSessionId]);

  if (pageMode === 'chat') {
    return (
      <div className="mark-homework-page chat-mode">
        <div className="chat-container">
        <div className={`chat-header ${!showChatHeader ? 'hidden' : ''}`}>
             <div className="chat-header-left">
               <h1>AI Homework Assistant</h1>
               <button 
                 className="back-btn"
                 onClick={() => {
                   setPageMode('upload');
                   setChatMessages([]);
                   setChatInput('');
                   setClassificationResult(null);
                   setApiResponse(null);
                   setCurrentSessionId(null);
                   // Clear localStorage
                   localStorage.removeItem('chatSessionId');
                   localStorage.removeItem('chatMessages');
                   localStorage.setItem('isChatMode', 'false');
                 }}
               >
                 ← Back to Upload
                 </button>
               </div>
             </div>
          
          <div className={`chat-content ${!showChatHeader ? 'header-hidden' : ''}`}>
                                                   <div className="chat-messages" ref={chatMessagesRef}>
                {/* Classification Info at the top */}
                {classificationResult?.isQuestionOnly && (
                 <div className="classification-info-chat">
                   <p><strong>Question Mode:</strong> {classificationResult.reasoning}</p>

                   {/* Exam Paper Detection for Chat Mode */}
                   {classificationResult.questionDetection && classificationResult.questionDetection.found && (
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
                           <h6 style={{margin: '0 0 12px 0', color: 'var(--primary-text)', fontSize: '16px', fontWeight: '600'}}>
                             📋 Marking Scheme Details
                           </h6>

                           {/* Exam Details */}
                           <div style={{marginBottom: '12px'}}>
                             <strong style={{color: 'var(--primary-text)'}}>Exam Information:</strong>
                             <div style={{marginTop: '4px', paddingLeft: '12px'}}>
                               <div style={{color: 'var(--secondary-text)'}}>Board: {classificationResult.questionDetection.match.markingScheme.examDetails?.board || 'N/A'}</div>
                               <div style={{color: 'var(--secondary-text)'}}>Qualification: {classificationResult.questionDetection.match.markingScheme.examDetails?.qualification || 'N/A'}</div>
                               <div style={{color: 'var(--secondary-text)'}}>Paper Code: {classificationResult.questionDetection.match.markingScheme.examDetails?.paperCode || 'N/A'}</div>
                               <div style={{color: 'var(--secondary-text)'}}>Year: {classificationResult.questionDetection.match.markingScheme.examDetails?.year || 'N/A'}</div>
                             </div>
                           </div>

                           {/* Summary Stats */}
                           <div style={{marginBottom: '12px'}}>
                             <strong style={{color: 'var(--primary-text)'}}>Summary:</strong>
                             <div style={{marginTop: '4px', paddingLeft: '12px'}}>
                               <div style={{color: 'var(--secondary-text)'}}>Total Questions: {classificationResult.questionDetection.match.markingScheme.totalQuestions || 'N/A'}</div>
                               <div style={{color: 'var(--secondary-text)'}}>Total Marks: {classificationResult.questionDetection.match.markingScheme.totalMarks || 'N/A'}</div>
                               <div style={{color: 'var(--secondary-text)'}}>Match Confidence: {Math.round((classificationResult.questionDetection.match.markingScheme.confidence || 0) * 100)}%</div>
                             </div>
                           </div>

                           {/* Question Marks */}
                           {classificationResult.questionDetection.match.markingScheme.questionMarks && (
                             <div>
                               <strong style={{color: 'var(--primary-text)'}}>Question Marks:</strong>
                               <div style={{marginTop: '4px', paddingLeft: '12px', maxHeight: '200px', overflowY: 'auto'}}>
                                 {(() => {
                                   try {
                                     return Object.entries(classificationResult.questionDetection.match.markingScheme.questionMarks)
                                       .sort(([a], [b]) => {
                                         const numA = parseInt(a.replace(/\D/g, '')) || 0;
                                         const numB = parseInt(b.replace(/\D/g, '')) || 0;
                                         return numA - numB;
                                       })
                                       .map(([questionKey, marksData]) => {
                                         // Handle both simple number format and complex object format
                                         const marks = typeof marksData === 'number' ? marksData : marksData?.mark || marksData;
                                         const answer = marksData?.answer;
                                         const comments = marksData?.comments;
                                         const guidance = marksData?.guidance;

                                         // Helper function to safely render nested objects
                                         const renderValue = (value) => {
                                           if (typeof value === 'object' && value !== null) {
                                             return JSON.stringify(value, null, 2);
                                           }
                                           return String(value);
                                         };

                                         return (
                                           <div key={questionKey} style={{
                                             marginBottom: '8px', 
                                             padding: '12px', 
                                             background: '#2a2a2a', 
                                             borderRadius: '12px', 
                                             border: '1px solid #404040',
                                             boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                                             transition: 'all 0.2s ease',
                                             color: 'white'
                                           }}>
                                             <div style={{fontWeight: 'bold', marginBottom: '6px', color: 'white'}}>
                                               {questionKey}: {renderValue(marks)} mark{marks !== 1 ? 's' : ''}
                                             </div>
                                             {answer && (
                                               <div style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)', marginBottom: '4px'}}>
                                                 <strong>Answer:</strong> {renderValue(answer)}
                                               </div>
                                             )}
                                             {comments && (
                                               <div style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)', marginBottom: '4px'}}>
                                                 <strong>Comments:</strong> {renderValue(comments)}
                                               </div>
                                             )}
                                             {guidance && (
                                               <div style={{fontSize: '12px', color: 'rgba(255, 255, 255, 0.9)'}}>
                                                 <strong>Guidance:</strong> {renderValue(guidance)}
                                               </div>
                                             )}
                                           </div>
                                         );
                                       });
                                   } catch (error) {
                                     return (
                                       <div style={{color: 'red', padding: '8px'}}>
                                         Error rendering question marks: {String(error.message)}
                                       </div>
                                     );
                                   }
                                 })()}
                               </div>
                             </div>
                           )}
                         </div>
                       )}
                     </div>
                   )}
                 </div>
               )}
               {chatMessages.map((message) => (
                 <div 
                   key={message.id} 
                   className={`chat-message ${message.role}`}
                 >
                   <div className="message-bubble">
                     {message.role === 'assistant' ? (
                       <div>
                         <MarkdownMathRenderer 
                           content={message.content}
                           className="chat-message-renderer"
                         />
                         
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
                         {message.isImageContext ? (
                           <div className="homework-annotated-image">
                             <img 
                               src={message.imageData}
                               alt="Uploaded homework"
                               className="annotated-image"
                             />
                           </div>
                         ) : (
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
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={isProcessing ? "AI is thinking..." : "Ask me anything about your homework..."}
                onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                disabled={isProcessing}
              />
              <button 
                className="send-btn"
                onClick={handleSendMessage}
                disabled={isProcessing || !chatInput.trim()}
              >
                {isProcessing ? (
                  <div className="send-spinner"></div>
                ) : (
                  'Send'
                )}
              </button>
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
          {/* Upload Section - Show at top if no response, at bottom if response exists */}
          {!apiResponse && (
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
                      <div className="upload-spinner"></div>
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Upload />
                      Upload & Analyze
                    </>
                  )}
                </button>
                
                {/* Fake Loading Progress Bar */}
                {isProcessing && (
                  <div className="loading-progress-container">
                    <div className="loading-progress-bar">
                      <div 
                        className="loading-progress-fill"
                        style={{ width: `${loadingProgress}%` }}
                      ></div>
                    </div>
                    <div className="loading-progress-text">
                      {loadingProgress < 30 && "Initializing analysis..."}
                      {loadingProgress >= 30 && loadingProgress < 60 && "Processing image content..."}
                      {loadingProgress >= 60 && loadingProgress < 90 && "Generating AI annotations..."}
                      {loadingProgress >= 90 && "Finalizing results..."}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

                      {/* Results Section */}
            {apiResponse && (
              <div className="results-section">
                <div className="results-header">
                  <h3>Analysis Results</h3>
                  {apiResponse.isHistorical && (
                    <button 
                      className="back-to-upload-btn"
                      onClick={() => {
                        setApiResponse(null);
                        setClassificationResult(null);
                        setPreviewUrl(null);
                        // setIsShowingHistoricalData(false); // Removed - not used
                        setPageMode('upload');
                      }}
                    >
                      ← Back to Upload
                    </button>
                  )}
                </div>
              
              {/* Exam Paper Detection Header */}
              {apiResponse.questionDetection && apiResponse.questionDetection.found && (
                <div className="exam-paper-header">
                  <div className="exam-paper-info">
                    <h4>📄 Detected Exam Paper</h4>
                    <div className="exam-paper-details">
                      <span className="exam-board">{apiResponse.questionDetection.match.board}</span>
                      <span className="exam-qualification">{apiResponse.questionDetection.match.qualification}</span>
                      <span className="exam-paper-code">{apiResponse.questionDetection.match.paperCode}</span>
                      <span className="exam-year">{apiResponse.questionDetection.match.year}</span>
                      {apiResponse.questionDetection.match.questionNumber && (
                        <span className="question-number">Question {apiResponse.questionDetection.match.questionNumber}</span>
                      )}
                    </div>
                    {apiResponse.questionDetection.match.confidence && (
                      <div className="confidence-score">
                        Confidence: {Math.round(apiResponse.questionDetection.match.confidence * 100)}%
                      </div>
                    )}
                  </div>
                </div>
              )}
              
                             {classificationResult && (
                 <div className="result-card">
                   <h4>Classification</h4>
                   <p><strong>Subject:</strong> {classificationResult.subject}</p>
                   <p><strong>Grade Level:</strong> {classificationResult.gradeLevel}</p>
                   <p><strong>Topic:</strong> {classificationResult.topic}</p>
                 </div>
               )}

               {apiResponse.annotatedImage && (
                 <div className="result-card">
                   <h4>Annotated Image</h4>
                   <div className="annotated-image">
                     <img 
                       src={apiResponse.annotatedImage} 
                       alt="Annotated homework with burned overlays" 
                       className="base-image"
                       style={{ maxWidth: '100%', height: 'auto' }}
                     />
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
            </div>
          )}

          {/* Upload Section - Show at bottom when response exists, but not when showing historical data */}
          {!apiResponse && (
            <div className="upload-section bottom-upload">
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

              {previewUrl && (
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
                      <div className="upload-spinner"></div>
                      Analyzing...
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
          )}
        </div>
      </div>


    </div>
  );
};

export default MarkHomeworkPage;
