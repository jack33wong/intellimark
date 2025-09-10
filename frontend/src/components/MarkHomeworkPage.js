import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
// import { useNavigate } from 'react-router-dom'; // Removed unused import
import { Upload, Bot, ChevronDown } from 'lucide-react';
import './MarkHomeworkPage.css';
import API_CONFIG from '../config/api';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { useAuth } from '../contexts/AuthContext';

const MarkHomeworkPage = ({ selectedMarkingResult, onClearSelectedResult, onMarkingResultSaved, onPageModeChange }) => {
  // === NAVIGATION ===
  // const navigate = useNavigate(); // Removed unused import
  const { getAuthToken } = useAuth();
  // const { user } = useAuth(); // Removed unused variable
  
  // Helper function to handle Firebase Storage URLs
  const getImageSrc = (imageData) => {
    if (!imageData) return null;
    
    // If it's already a data URL (base64), return as is
    if (imageData.startsWith('data:')) {
      return imageData;
    }
    
    // If it's a Firebase Storage URL, we need to handle it differently
    // For now, return the URL as is - the browser should handle it
    // In production, you might want to add authentication headers
    return imageData;
  };
  
  // === AUTH ===
  // const { user } = useAuth(); // Removed unused variable
  
  // === CORE STATE ===
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  const [showScrollButton, setShowScrollButton] = useState(false);
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
  const [, setError] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [, setApiResponse] = useState(null);
  const [classificationResult, setClassificationResult] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [lastUploadedImageData, setLastUploadedImageData] = useState(null);
  
  // === CHAT MODE STATE ===
  const [chatMessages, setChatMessages] = useState([]);

  // Helper function to deduplicate messages by ID
  const deduplicateMessages = (messages) => {
    const seen = new Set();
    return messages.filter(message => {
      if (seen.has(message.id)) {
        return false;
      }
      seen.add(message.id);
      return true;
    });
  };
  const [chatInput, setChatInput] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [, setLastScrollTop] = useState(0);
  const [showExpandedThinking, setShowExpandedThinking] = useState(false);
  const [showMarkingSchemeDetails, setShowMarkingSchemeDetails] = useState(false);
  const [showInfoDropdown, setShowInfoDropdown] = useState(false);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  
  // Subscription type for delay calculation (can be made dynamic later)
  const [subscriptionType, setSubscriptionType] = useState('free'); // 'free', 'pro', 'enterprise'
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [isDelayActive, setIsDelayActive] = useState(false);
  const [delayCountdown, setDelayCountdown] = useState(0);
  
  // Subscription delay configuration (in milliseconds) - configurable via .env.local
  const subscriptionDelays = useMemo(() => ({
    free: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_FREE) || 3000,      // 3 seconds default
    pro: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_PRO) || 1000,        // 1 second default
    enterprise: parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_ENTERPRISE) || 0    // 0 seconds default
  }), []);
  
  // Get delay for current subscription
  const getCurrentDelay = useCallback(() => subscriptionDelays[subscriptionType] || parseInt(process.env.REACT_APP_SUBSCRIPTION_DELAY_DEFAULT) || 3000, [subscriptionType, subscriptionDelays]);
  
  // Check if enough time has passed since last request
  const canMakeRequest = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const requiredDelay = getCurrentDelay();
    return timeSinceLastRequest >= requiredDelay;
  }, [lastRequestTime, getCurrentDelay]);
  
  // Get remaining delay time
  const getRemainingDelay = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    const requiredDelay = getCurrentDelay();
    return Math.max(0, requiredDelay - timeSinceLastRequest);
  }, [lastRequestTime, getCurrentDelay]);
  
  // Create ref for chat container
  const chatContainerRef = useRef(null);

  // Auto-scroll to bottom function
  const scrollToBottom = useCallback(() => {
    // Use ref instead of querySelector for more reliable targeting
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, []);
  
  // Auto-scroll when processing starts (thinking animation appears)
  useEffect(() => {
    if (isProcessing) {
      scrollToBottom();
    }
  }, [isProcessing, scrollToBottom]);

  // Auto-scroll when new messages are added
  useEffect(() => {
    if (chatMessages.length > 0) {
      scrollToBottom();
    }
  }, [chatMessages.length, scrollToBottom]);

  // Auto-scroll when switching to chat mode
  useEffect(() => {
    if (pageMode === 'chat' && chatMessages.length > 0) {
      scrollToBottom();
    }
  }, [pageMode, chatMessages.length, scrollToBottom]);

  // Handle scroll events with enhanced debugging - match test-scroll page logic
  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      const { scrollTop, scrollHeight, clientHeight } = container;
      
      // Check if we're at the bottom (within 10px tolerance) - more reliable calculation
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isAtBottom = distanceFromBottom <= 10;
      
      // Check if scroll button should be shown - match MarkHomeworkPage logic
      const shouldShowButton = !isAtBottom && chatMessages.length > 0;
      setShowScrollButton(shouldShowButton);
    }
  }, [chatMessages.length]);

  // Show/hide scroll button based on scroll position
  useEffect(() => {
    // Show button if there are messages and content is scrollable - match MarkHomeworkPage logic
    if (chatMessages.length > 0) {
      if (chatContainerRef.current) {
        const container = chatContainerRef.current;
        const isScrollable = container.scrollHeight > container.clientHeight;
        setShowScrollButton(isScrollable);
      }
    } else {
      setShowScrollButton(false);
    }

    // Add scroll event listener
    const container = chatContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      handleScroll(); // Check initial state
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);
  
  // Handle delay countdown timer
  useEffect(() => {
    let interval;
    
    if (lastRequestTime > 0 && !canMakeRequest()) {
      setIsDelayActive(true);
      
      interval = setInterval(() => {
        const remaining = getRemainingDelay();
        setDelayCountdown(Math.ceil(remaining / 1000));
        
        if (remaining <= 0) {
          setIsDelayActive(false);
          setDelayCountdown(0);
          clearInterval(interval);
        }
      }, 100);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [lastRequestTime, subscriptionType, canMakeRequest, getRemainingDelay]);
  
  // Refresh sidebar when switching to chat mode (for question-only mode only)
  useEffect(() => {
    if (pageMode === 'chat' && currentSessionId && onMarkingResultSaved && classificationResult?.isQuestionOnly) {
      // Small delay to ensure session is fully created before refreshing sidebar
      const timer = setTimeout(() => {
        onMarkingResultSaved();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pageMode, currentSessionId, onMarkingResultSaved, classificationResult?.isQuestionOnly]);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showInfoDropdown && !event.target.closest('.info-dropdown') && !event.target.closest('.info-btn')) {
        setShowInfoDropdown(false);
      }
      if (isModelDropdownOpen && !event.target.closest('.ai-model-dropdown') && !event.target.closest('.ai-model-button')) {
        setIsModelDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showInfoDropdown, isModelDropdownOpen]);
  
  // === REFS ===
  // const fileInputRef = useRef(null); // Removed - not used
  // const chatMessagesRef = useRef(null); // Removed - using chatContainerRef instead

  // const models = [
  //   { id: 'chatgpt-4o', name: 'ChatGPT-4o', description: 'Latest OpenAI model' },
  //   { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google\'s advanced model' },
  //   { id: 'chatgpt-5', name: 'ChatGPT-5', description: 'Next generation AI' }
  // ];

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

  // Listen for session deletion events to reset to upload mode
  useEffect(() => {
    const handleSessionDeleted = () => {
      setPageMode('upload');
      setChatMessages([]);
      setChatInput('');
      setCurrentSessionId(null);
      setSelectedFile(null);
      setPreviewUrl(null);
      setClassificationResult(null);
      setLastUploadedImageData(null);
      setShowExpandedThinking(false);
      setShowMarkingSchemeDetails(false);
      setLoadingProgress(0);
      // Clear localStorage
      localStorage.removeItem('chatSessionId');
      localStorage.removeItem('chatMessages');
      localStorage.setItem('isChatMode', 'false');
    };

    const handleSessionsCleared = () => {
      setPageMode('upload');
      setChatMessages([]);
      setChatInput('');
      setCurrentSessionId(null);
      setSelectedFile(null);
      setPreviewUrl(null);
      setClassificationResult(null);
      setLastUploadedImageData(null);
      setShowExpandedThinking(false);
      setShowMarkingSchemeDetails(false);
      setLoadingProgress(0);
      // Clear localStorage
      localStorage.removeItem('chatSessionId');
      localStorage.removeItem('chatMessages');
      localStorage.setItem('isChatMode', 'false');
    };

    window.addEventListener('sessionDeleted', handleSessionDeleted);
    window.addEventListener('sessionsCleared', handleSessionsCleared);
    
    return () => {
      window.removeEventListener('sessionDeleted', handleSessionDeleted);
      window.removeEventListener('sessionsCleared', handleSessionsCleared);
    };
  }, []);
  
  // Handle selected marking result from sidebar
  useEffect(() => {
    if (selectedMarkingResult) {
      // Load the session messages into chat first
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
        
        // Set messages first, then switch to chat mode
        setChatMessages(deduplicateMessages(formattedMessages));
        setCurrentSessionId(selectedMarkingResult.id);
        
        // Switch to chat mode after messages are set
        setPageMode('chat');
        
        // Scroll to bottom of chat after a delay to ensure DOM is updated
        setTimeout(() => {
          scrollToBottom();
        }, 200);
      } else {
        // Still switch to chat mode even if no messages
        setPageMode('chat');
      }
      
      // Clear the selected result after processing with a longer delay
      if (onClearSelectedResult) {
        setTimeout(() => {
          onClearSelectedResult();
        }, 500);
      }
    }
  }, [selectedMarkingResult, onClearSelectedResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load session from localStorage on component mount
  useEffect(() => {
    // Don't load from localStorage if we have a selected marking result
    if (selectedMarkingResult) {
      return;
    }
    
    const savedSessionId = localStorage.getItem('chatSessionId');
    const savedChatMessages = localStorage.getItem('chatMessages');
    const savedChatMode = localStorage.getItem('isChatMode');
    
    if (savedSessionId) {
      setCurrentSessionId(savedSessionId);
    }
    
    if (savedChatMessages) {
      try {
        const messages = JSON.parse(savedChatMessages);
        setChatMessages(deduplicateMessages(messages));
      } catch (error) {
        console.error('❌ Failed to parse saved chat messages:', error);
      }
    }
    
    if (savedChatMode === 'true' && pageMode === 'upload') {
      setPageMode('chat');
    }
  }, [pageMode, selectedMarkingResult]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-scroll to bottom when new messages arrive (handled by main scrollToBottom function)
  // Removed duplicate scroll logic - using chatContainerRef instead

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

  // const handleDragOver = useCallback((e) => {
  //   e.preventDefault();
  //   e.currentTarget.classList.add('dragover');
  // }, []);

  // const handleDragLeave = useCallback((e) => {
  //   e.preventDefault();
  //   e.currentTarget.classList.remove('dragover');
  // }, []);

  // const handleDrop = useCallback((e) => {
  //   e.preventDefault();
  //   e.currentTarget.classList.remove('dragover');
  //   
  //   const files = e.dataTransfer.files;
  //   if (files.length > 0) {
  //     handleFileSelect(files[0]);
  //   }
  // }, [handleFileSelect]);

  const handleFileInput = useCallback((e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleModelToggle = () => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  };

  const handleModelSelect = (model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  };

  // Send initial chat message when switching to chat mode
  // const sendInitialChatMessage = useCallback(async (imageData, model, mode, sessionId = null) => {
  //   setIsProcessing(true);
  //   
  //   try {
  //     // Use the provided session ID, current session ID, or let the API create a new one
  //     const sessionIdToUse = sessionId || currentSessionId || null;
  //     
  //     const authToken = await getAuthToken();
  //     const headers = {
  //       'Content-Type': 'application/json',
  //     };
  //     if (authToken) {
  //       headers['Authorization'] = `Bearer ${authToken}`;
  //     }
  //     
  //     const response = await fetch('/api/chat/', {
  //       method: 'POST',
  //       headers,
  //       body: JSON.stringify({
  //         message: 'I have a question about this image. Can you help me understand it?',
  //         imageData: imageData,
  //         model: model,
  //         sessionId: sessionIdToUse,
  //         ...(mode ? { mode } : {})
  //       }),
  //     });

  //     const data = await response.json();

  //     if (data.success) {
  //       // Update session ID if we got a new one
  //       if (data.sessionId && data.sessionId !== currentSessionId) {
  //         setCurrentSessionId(data.sessionId);
  //       }
  //       
  //       // Add AI response to chat
  //       const aiResponse = {
  //         id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  //         role: 'assistant',
  //         content: data.response,
  //         rawContent: data.response, // Store raw content for toggle
  //         timestamp: new Date().toLocaleTimeString(),
  //         apiUsed: data.apiUsed,
  //         showRaw: false // Track raw toggle state
  //       };
  //       
  //       setChatMessages(prev => deduplicateMessages([...prev, aiResponse]));
  //     } else {
  //       console.error('🔍 Initial chat failed:', data.error);
  //       
  //       // Add error message to chat
  //       const errorResponse = {
  //         id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  //         role: 'assistant',
  //         content: 'Sorry, I encountered an error while processing your image. Please try again.',
  //         timestamp: new Date().toLocaleTimeString()
  //       };
  //       
  //       setChatMessages(prev => deduplicateMessages([...prev, errorResponse]));
  //     }
  //   } catch (error) {
  //     console.error('🔍 Initial chat network error:', error);
  //     
  //     // Add error message to chat
  //     const errorResponse = {
  //       id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  //       role: 'assistant',
  //       content: 'Sorry, I encountered a network error. Please check your connection and try again.',
  //       timestamp: new Date().toLocaleTimeString()
  //     };
  //     
  //     setChatMessages(prev => deduplicateMessages([...prev, errorResponse]));
  //   } finally {
  //     setIsProcessing(false);
  //   }
  // }, [currentSessionId, onMarkingResultSaved]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const authToken = await getAuthToken();
      
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
        
        // Log session message content before redirecting to chat
        
        // Set the session ID from the response
        setCurrentSessionId(result.sessionId);
        
        // Add initial user message with the image
        const initialUserMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          content: 'I have a question about this image. Can you help me understand it?',
          timestamp: new Date().toLocaleTimeString(),
          type: 'question_original',
          imageData: imageData,
          fileName: selectedFile.name,
          detectedQuestion: { // Add exam metadata for display
            examDetails: result.questionDetection?.match?.markingScheme?.examDetails || result.questionDetection?.match?.examDetails || {},
            questionNumber: result.questionDetection?.match?.questionNumber || 'Unknown',
            questionText: result.questionDetection?.match?.questionText || result.classification?.extractedQuestionText || '',
            confidence: result.questionDetection?.match?.markingScheme?.confidence || result.questionDetection?.match?.confidence || 0
          }
        };
        
        // Wait for AI response before redirecting (same as marking mode)
        if (result.sessionId) {
          try {
            const authToken = await getAuthToken();
            const headers = {
              'Content-Type': 'application/json',
            };
            if (authToken) {
              headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            // Send original image to backend and get AI response
            const response = await fetch('/api/chat/', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                message: 'I have a question about this image. Can you help me understand it?',
                imageData: imageData, // Use original image
                model: selectedModel,
                sessionId: result.sessionId,
                mode: 'question',
                examMetadata: { // Add exam metadata
                  examDetails: result.questionDetection?.match?.markingScheme?.examDetails || result.questionDetection?.match?.examDetails || {},
                  questionMarks: result.questionDetection?.match?.markingScheme?.questionMarks || result.questionDetection?.match?.questionMarks || {},
                  confidence: result.questionDetection?.match?.markingScheme?.confidence || result.questionDetection?.match?.confidence || 0
                }
              }),
            });

            if (response.ok) {
              const data = await response.json();
              
              // Create AI response message
              const aiResponseMessage = {
                id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                role: 'assistant',
                content: data.response,
                timestamp: new Date().toLocaleTimeString(),
                type: 'question_response'
              };
              
              // Set both user and AI messages (both ready)
              setChatMessages(deduplicateMessages([initialUserMessage, aiResponseMessage]));
            } else {
              console.error('❌ Failed to get AI response:', response.status);
              // Fallback - just show user message
              setChatMessages(deduplicateMessages([initialUserMessage]));
            }
          } catch (error) {
            console.error('❌ Failed to send original image message to backend:', error);
            // Fallback - just show user message
            setChatMessages(deduplicateMessages([initialUserMessage]));
          }
        } else {
          // No sessionId - just show user message
          setChatMessages([initialUserMessage]);
        }
        
        // Set processing to false after AI response is ready
        setIsProcessing(false);
        
        // Switch to chat mode after AI response is ready
        setPageMode('chat');
        
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


      // Switch to chat mode with the marked homework
      setPageMode('chat');
      
      // Set the session ID from the response
      setCurrentSessionId(result.sessionId);
      
      // Add the original image message first, then the marked homework message
      const originalImageMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, // Ensure it comes before the marked message
        role: 'user',
        content: 'Original question image',
        timestamp: new Date().toLocaleTimeString(),
        type: 'marking_original',
        imageData: imageData, // Original image
        fileName: selectedFile.name,
        detectedQuestion: {
          examDetails: result.questionDetection?.match?.markingScheme?.examDetails || result.questionDetection?.match?.examDetails || {},
          questionNumber: result.questionDetection?.match?.questionNumber || 'Unknown',
          questionText: result.questionDetection?.match?.questionText || result.classification?.extractedQuestionText || '',
          confidence: result.questionDetection?.match?.markingScheme?.confidence || result.questionDetection?.match?.confidence || 0
        }
      };
      
      const markedMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: 'Marking completed with annotations',
        timestamp: new Date().toLocaleTimeString(),
        type: 'marking_annotated',
        imageData: result.annotatedImage,
        markingData: {
          examDetails: result.questionDetection.match?.markingScheme?.examDetails || result.questionDetection.match?.examDetails || {},
          questionMarks: result.questionDetection.match?.markingScheme?.questionMarks || result.questionDetection.match?.questionMarks || {},
          confidence: result.questionDetection.match?.markingScheme?.confidence || result.questionDetection.match?.confidence || 0,
          markingInstructions: result.instructions || null // Include the marking instructions with feedback
        }
      };
      
      
      setChatMessages(deduplicateMessages([originalImageMessage, markedMessage]));
      
      // Set processing to false since we have the messages ready
      setIsProcessing(false);
      
      // Send messages to backend for session persistence (without AI response)
      if (result.sessionId) {
        try {
          const authToken = await getAuthToken();
          const headers = {
            'Content-Type': 'application/json',
          };
          if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
          }
          
          // Send original image to backend for session persistence
          await fetch('/api/chat/', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: 'Original question image',
              imageData: imageData, // Original image as base64
              model: selectedModel,
              sessionId: result.sessionId,
              mode: 'marking',
              examMetadata: {
                examDetails: result.questionDetection?.match?.markingScheme?.examDetails || result.questionDetection?.match?.examDetails || {},
                questionNumber: result.questionDetection?.match?.questionNumber || 'Unknown',
                questionText: result.questionDetection?.match?.questionText || result.classification?.extractedQuestionText || '',
                confidence: result.questionDetection?.match?.markingScheme?.confidence || result.questionDetection?.match?.confidence || 0
              }
            }),
          });
          
          // Send annotated image to backend for session persistence
          await fetch('/api/chat/', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              message: 'Annotated image with marking feedback',
              imageData: result.annotatedImage,
              model: selectedModel,
              sessionId: result.sessionId,
              mode: 'marking',
              markingData: {
                examDetails: result.questionDetection.match?.markingScheme?.examDetails || result.questionDetection.match?.examDetails || {},
                questionMarks: result.questionDetection.match?.markingScheme?.questionMarks || result.questionDetection.match?.questionMarks || {},
                confidence: result.questionDetection.match?.markingScheme?.confidence || result.questionDetection.match?.confidence || 0,
                markingInstructions: result.instructions || null,
                ocrResult: result.ocrResult || null
              }
            }),
          });
          
          // Refresh messages from backend
          setTimeout(async () => {
            try {
              const sessionResponse = await fetch(`/api/chat/session/${result.sessionId}`, {
                headers: {
                  'Authorization': `Bearer ${authToken}`
                }
              });
              
              if (sessionResponse.ok) {
                const sessionData = await sessionResponse.json();
                if (sessionData.success && sessionData.session.messages) {
                  // Format messages for frontend display
                  const formattedMessages = sessionData.session.messages.map((msg, index) => {
                    // Find the corresponding local message to preserve marking data
                    const localMessage = chatMessages.find(localMsg => localMsg.id === (msg.id || `msg-${index}`));
                    
                    return {
                      id: msg.id || `msg-${index}`,
                      role: msg.role,
                      content: msg.content,
                      rawContent: msg.rawContent || msg.content,
                      timestamp: msg.timestamp || new Date().toLocaleTimeString(),
                      type: msg.type,
                      imageData: msg.imageData,
                      imageLink: msg.imageLink,
                      // Preserve marking data from local message if backend doesn't have it
                      markingData: msg.markingData || (localMessage ? localMessage.markingData : null),
                      model: msg.model,
                      detectedQuestion: msg.detectedQuestion,
                      apiUsed: msg.apiUsed,
                      showRaw: msg.showRaw || false,
                      isImageContext: msg.isImageContext || false,
                      historicalData: msg.historicalData
                    };
                  });
                  
                  setChatMessages(deduplicateMessages(formattedMessages));
                  
                  // Refresh sidebar after backend persistence is complete
                  if (onMarkingResultSaved) {
                    onMarkingResultSaved();
                  }
                }
              }
            } catch (error) {
              console.error('❌ Failed to refresh messages from backend:', error);
            }
          }, 1000); // Wait 1 second for backend to process
          
        } catch (error) {
          console.error('❌ Failed to send messages to backend for persistence:', error);
        }
      }
      
    } catch (error) {
      console.error('❌ Upload error:', error);
      setError(`Failed to process the image: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, selectedModel, onMarkingResultSaved, chatMessages, getAuthToken]);




   const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    
    // Check if enough time has passed since last request
    if (!canMakeRequest()) {
      const remainingDelay = getRemainingDelay();
      console.log(`⏱️ Please wait ${Math.ceil(remainingDelay / 1000)} seconds before sending another message`);
      return;
    }

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: chatInput,
      timestamp: new Date().toLocaleTimeString()
    };

    setChatMessages(prev => deduplicateMessages([...prev, userMessage]));
    setChatInput('');
    setIsProcessing(true);
    
    // Update last request time
    setLastRequestTime(Date.now());
    
    // Scroll to bottom when user sends message
    scrollToBottom();

    try {
      
      // For follow-up messages, don't send image data again
      // Only send image data if this is the first message in a new session
      const isFirstMessage = chatMessages.length === 0;
      const imageData = isFirstMessage ? lastUploadedImageData : undefined;
      
      // Use the current session ID if available, otherwise let the API create a new one
      const sessionIdToUse = currentSessionId || null;
      
      // For follow-up messages, don't send mode parameter to avoid incorrect type assignment
      // Only send mode for the first message in a new session
      const mode = isFirstMessage ? (classificationResult?.isQuestionOnly ? 'question' : 'qa') : undefined;
      
      const authToken = await getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch('/api/chat/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: chatInput.trim(),
          imageData: imageData,
          model: selectedModel,
          sessionId: sessionIdToUse,
          mode: mode
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
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'assistant',
          content: data.response,
          rawContent: data.response, // Store raw content for toggle
          timestamp: new Date().toLocaleTimeString(),
          apiUsed: data.apiUsed,
          showRaw: false // Track raw toggle state
        };
        
        setChatMessages(prev => deduplicateMessages([...prev, aiResponse]));
        
        // Scroll to bottom when AI response is received
        scrollToBottom();
      } else {
        console.error('🔍 Chat failed:', data.error);
        
        // Add error message to chat
        const errorResponse = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'assistant',
          content: 'Sorry, I encountered an error while processing your message. Please try again.',
          timestamp: new Date().toLocaleTimeString()
        };
        
        setChatMessages(prev => deduplicateMessages([...prev, errorResponse]));
        
        // Scroll to bottom when error response is received
        scrollToBottom();
      }
    } catch (error) {
      console.error('🔍 Chat network error:', error);
      
      // Add error message to chat
      const errorResponse = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: 'Sorry, I encountered a network error. Please check your connection and try again.',
        timestamp: new Date().toLocaleTimeString()
      };
      
      setChatMessages(prev => deduplicateMessages([...prev, errorResponse]));
      
      // Scroll to bottom when network error response is received
      scrollToBottom();
    } finally {
      setIsProcessing(false);
    }
  }, [chatInput, selectedModel, chatMessages, lastUploadedImageData, currentSessionId, classificationResult, scrollToBottom, canMakeRequest, getAuthToken, getRemainingDelay]);

  return (
    <>
      {pageMode === 'chat' ? (
        <div className="mark-homework-page chat-mode">
          <div className="chat-container" ref={chatContainerRef}>
            <div className="chat-header">
              <div className="chat-header-content">
                <div className="chat-header-left">
                  <h1>force and friction</h1>
                </div>
                <div className="chat-header-right">
                <button 
                  className="header-btn info-btn"
                  onClick={() => {
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
          
          <div className="chat-messages">
              {chatMessages.map((message, index) => (
                <div 
                  key={`${message.id}-${index}`} 
                  className={`chat-message ${message.role}`}
                >
                  <div className={`message-bubble ${(message.type === 'marking_original' || message.type === 'marking_annotated') ? 'marking-message' : ''}`}>
                    {message.role === 'assistant' ? (
                      <div>
                        <div className="assistant-header">intellimark</div>
                        
                        {/* Only show content for regular chat messages, not marking messages */}
                        {message.type !== 'marking_annotated' && message.type !== 'marking_original' && message.content && message.content.trim() !== '' && (
                          <MarkdownMathRenderer 
                            content={message.content}
                            className="chat-message-renderer"
                          />
                        )}
                        
                        {/* Handle marking messages with annotated images */}
                        {message.type === 'marking_annotated' && (message.imageLink || message.imageData) && (
                          <div className="homework-annotated-image">
                            <h4>✅ Marked Homework Image</h4>
                            <img 
                              src={getImageSrc(message.imageLink || message.imageData)}
                              alt="Marked homework"
                              className="annotated-image"
                              onError={(e) => {
                                console.warn('Failed to load image:', message.imageLink || message.imageData);
                                e.target.style.display = 'none';
                              }}
                            />
                            
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
                            setChatMessages(prev => prev.map(msg => 
                              msg.id === message.id 
                                ? { ...msg, showRaw: !msg.showRaw }
                                : msg
                            ));
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
                              src={getImageSrc(message.imageLink || message.imageData)}
                              alt="Original homework"
                              className="annotated-image"
                              onError={(e) => {
                                console.warn('Failed to load image:', message.imageLink || message.imageData);
                                e.target.style.display = 'none';
                              }}
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
                               src={getImageSrc(message.imageLink || message.imageData)}
                               alt="Marked homework"
                               className="annotated-image"
                               onError={(e) => {
                                 console.warn('Failed to load image:', message.imageLink || message.imageData);
                                 e.target.style.display = 'none';
                               }}
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
                               src={getImageSrc(message.imageLink || message.imageData)}
                               alt="Question"
                               className="annotated-image"
                               onError={(e) => {
                                 console.warn('Failed to load image:', message.imageLink || message.imageData);
                                 e.target.style.display = 'none';
                               }}
                             />
                           </div>
                         )}
                         
                         {/* Handle regular image context */}
                         {message.isImageContext && !message.type && (message.imageData || message.imageLink) && (
                           <div className="homework-annotated-image">
                             <img 
                               src={getImageSrc(message.imageLink || message.imageData)}
                               alt="Uploaded homework"
                               className="annotated-image"
                               onError={(e) => {
                                 console.warn('Failed to load image:', message.imageLink || message.imageData);
                                 e.target.style.display = 'none';
                               }}
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
               
               {/* Scroll to Bottom Button */}
               <div className={`scroll-to-bottom-container ${showScrollButton ? 'show' : 'hidden'}`}>
                 <button 
                   className="scroll-to-bottom-btn"
                   onClick={scrollToBottom}
                   title="Scroll to bottom"
                 >
                   <ChevronDown size={20} />
                 </button>
               </div>
               
               
               
               
            </div>
          </div>
          
          {/* Bottom Input Bar - chat input bar (bottom aligned) */}
          <div className="input-bar">
            <div className="upload-chat-input">
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

              {/* Model Selector with Upload Image and Send Button */}
              <div className="model-selector">
                <div className="left-controls">
                  <div className="ai-model-dropdown">
                    <button 
                      className="ai-model-button" 
                      onClick={handleModelToggle}
                      disabled={isProcessing}
                    >
                      <Bot size={16} />
                      <span>ai model</span>
                      <ChevronDown size={14} className={isModelDropdownOpen ? 'rotated' : ''} />
                    </button>
                    {isModelDropdownOpen && (
                      <div className="ai-model-dropdown-menu">
                        <button 
                          className={`ai-model-option ${selectedModel === 'chatgpt-4o' ? 'selected' : ''}`}
                          onClick={() => handleModelSelect('chatgpt-4o')}
                        >
                          GPT-4o
                        </button>
                        <button 
                          className={`ai-model-option ${selectedModel === 'chatgpt-4' ? 'selected' : ''}`}
                          onClick={() => handleModelSelect('chatgpt-4')}
                        >
                          GPT-4
                        </button>
                        <button 
                          className={`ai-model-option ${selectedModel === 'claude-3' ? 'selected' : ''}`}
                          onClick={() => handleModelSelect('claude-3')}
                        >
                          Claude 3
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Subscription Type Selector */}
                  <div className="subscription-selector">
                    <select 
                      value={subscriptionType} 
                      onChange={(e) => setSubscriptionType(e.target.value)}
                      disabled={isProcessing || isDelayActive}
                      className="subscription-select"
                    >
                      <option value="free">Free ({subscriptionDelays.free / 1000}s delay)</option>
                      <option value="pro">Pro ({subscriptionDelays.pro / 1000}s delay)</option>
                      <option value="enterprise">Enterprise ({subscriptionDelays.enterprise / 1000}s delay)</option>
                    </select>
                  </div>
                  
                  {/* Upload Image Button */}
                  <button 
                    className="upload-btn"
                    onClick={() => document.getElementById('chat-file-input')?.click()}
                    disabled={isProcessing}
                    title="Upload image"
                  >
                    <Upload size={18} />
                  </button>
                  <input
                    id="chat-file-input"
                    type="file"
                    accept="image/*"
                    onChange={handleFileInput}
                    style={{ display: 'none' }}
                  />
                </div>
                <button 
                  className="send-btn"
                  onClick={handleSendMessage}
                  disabled={isProcessing || !chatInput.trim() || isDelayActive}
                >
                  {isProcessing ? (
                    <div className="send-spinner"></div>
                  ) : isDelayActive ? (
                    <span className="delay-countdown">{delayCountdown}s</span>
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

      {/* Bottom Chat Input Bar */}
      <div className="upload-chat-input-bar">
        <div className="upload-chat-input">
          {/* Main Input Area */}
          <div className="input-container">
            <textarea
              placeholder={isProcessing ? "AI is processing your homework..." : "Ask me anything about your homework..."}
              disabled={isProcessing}
            />
          </div>
          
          {/* Model Selector with Send Button */}
          <div className="model-selector">
            <div className="left-controls">
              <div className="ai-model-dropdown">
                <button 
                  className="ai-model-button" 
                  onClick={handleModelToggle}
                  disabled={isProcessing}
                >
                  <Bot size={16} />
                  <span>ai model</span>
                  <ChevronDown size={14} className={isModelDropdownOpen ? 'rotated' : ''} />
                </button>
                
                {isModelDropdownOpen && (
                  <div className="ai-model-dropdown-menu">
                    <button 
                      className={`ai-model-option ${selectedModel === 'chatgpt-4o' ? 'selected' : ''}`}
                      onClick={() => handleModelSelect('chatgpt-4o')}
                    >
                      GPT-4o
                    </button>
                    <button 
                      className={`ai-model-option ${selectedModel === 'chatgpt-4' ? 'selected' : ''}`}
                      onClick={() => handleModelSelect('chatgpt-4')}
                    >
                      GPT-4
                    </button>
                    <button 
                      className={`ai-model-option ${selectedModel === 'claude-3' ? 'selected' : ''}`}
                      onClick={() => handleModelSelect('claude-3')}
                    >
                      Claude 3
                    </button>
                  </div>
                )}
              </div>
            </div>
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
        {isProcessing && (
          <div className="upload-loading-bar inside-input">
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
      </div>

    </div>
      )}
    </>
  );
};

export default MarkHomeworkPage;
