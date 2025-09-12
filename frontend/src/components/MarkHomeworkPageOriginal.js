import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Upload, Bot, ChevronDown, Brain } from 'lucide-react';
import './MarkHomeworkPage.css';
import API_CONFIG from '../config/api';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import { useAuth } from '../contexts/AuthContext';
import { FirestoreService } from '../services/firestoreService';
import { ensureStringContent } from '../utils/contentUtils';

const MarkHomeworkPage = ({ selectedMarkingResult, onClearSelectedResult, onMarkingResultSaved, onPageModeChange }) => {
  const { getAuthToken, user } = useAuth();
  
  // Using imported utility function
  
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
  
  // === CORE STATE ===
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  // Notify parent of page mode changes
  useEffect(() => {
    if (onPageModeChange) {
      onPageModeChange(pageMode);
    }
  }, [pageMode, onPageModeChange]);

  // Handle selected marking result from sidebar
  useEffect(() => {
    if (selectedMarkingResult) {
      // Set the marking result for task details display
      setMarkingResult(selectedMarkingResult);
      
      // Set other relevant state
      if (selectedMarkingResult.messages && selectedMarkingResult.messages.length > 0) {
        setChatMessages(selectedMarkingResult.messages);
        setPageMode('chat');
      }
      
      if (selectedMarkingResult.title) {
        setSessionTitle(selectedMarkingResult.title);
      }
      
      if (selectedMarkingResult.favorite !== undefined) {
        setIsFavorite(selectedMarkingResult.favorite);
      }
      
      if (selectedMarkingResult.rating !== undefined) {
        setRating(selectedMarkingResult.rating);
      }
      
      if (selectedMarkingResult.id) {
        setCurrentSessionId(selectedMarkingResult.id);
      }
    }
  }, [selectedMarkingResult]);
  
  // === UPLOAD MODE STATE ===
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  const [classificationResult, setClassificationResult] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [lastUploadedImageData, setLastUploadedImageData] = useState(null);
  
  // === CHAT MODE STATE ===
  const [chatMessages, setChatMessages] = useState([]);
  const [sessionTitle, setSessionTitle] = useState('Chat Session');
  const [isFavorite, setIsFavorite] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [markingResult, setMarkingResult] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);

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

  // Handle favorite toggle (only for authenticated users)
  const handleFavoriteToggle = async () => {
    if (!currentSessionId || !user?.uid) return;
    
    const newFavoriteState = !isFavorite;
    setIsFavorite(newFavoriteState);
    
    try {
      const authToken = await getAuthToken();
      await FirestoreService.updateChatSession(currentSessionId, {
        favorite: newFavoriteState
      }, authToken);
      
      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('sessionUpdated', { 
        detail: { sessionId: currentSessionId, field: 'favorite', value: newFavoriteState } 
      }));
    } catch (error) {
      console.error('Failed to update favorite status:', error);
      // Revert on error
      setIsFavorite(!newFavoriteState);
    }
  };

  // Handle rating change (only for authenticated users)
  const handleRatingChange = async (newRating) => {
    if (!currentSessionId || !user?.uid) return;
    
    const previousRating = rating;
    const numericRating = Number(newRating);
    setRating(numericRating);
    
    try {
      const authToken = await getAuthToken();
      await FirestoreService.updateChatSession(currentSessionId, {
        rating: numericRating
      }, authToken);
      
      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('sessionUpdated', { 
        detail: { sessionId: currentSessionId, field: 'rating', value: numericRating } 
      }));
    } catch (error) {
      console.error('Failed to update rating:', error);
      // Revert on error
      setRating(previousRating);
    }
  };

  // Load session data including favorite and rating
  const loadSessionData = (sessionData) => {
    if (sessionData) {
      setIsFavorite(sessionData.favorite || false);
      setRating(Number(sessionData.rating) || 0);
    }
  };
  const [chatInput, setChatInput] = useState('');
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
  }, [handleScroll, chatMessages.length]);
  
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

  // === MODE MANAGEMENT ===
  
  // Reset component state when component is mounted fresh (key change)
  useEffect(() => {
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
          content: ensureStringContent(msg.content),
          rawContent: ensureStringContent(msg.rawContent || msg.content), // Store raw content for toggle
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
          isImageContext: msg.isImageContext || false // Add image context flag
        }));
        
        // Set messages first, then switch to chat mode
        setChatMessages(deduplicateMessages(formattedMessages));
        setCurrentSessionId(selectedMarkingResult.id);
        
        // Store the session title for display
        setSessionTitle(selectedMarkingResult.title || 'Chat Session');
        
        // Load favorite and rating from session
        setIsFavorite(selectedMarkingResult.favorite || false);
        setRating(Number(selectedMarkingResult.rating) || 0);
        
        // Switch to chat mode after messages are set
        setPageMode('chat');
        
        // Scroll to bottom of chat after a delay to ensure DOM is updated
        setTimeout(() => {
          scrollToBottom();
        }, 200);
      } else {
        // Still switch to chat mode even if no messages
        setSessionTitle(selectedMarkingResult.title || 'Chat Session');
        setPageMode('chat');
      }
      
      // Clear the selected result after processing with a longer delay
      // Only clear if we're not in chat mode (to preserve session title)
      if (onClearSelectedResult && pageMode !== 'chat') {
        setTimeout(() => {
          onClearSelectedResult();
        }, 500);
      }
    }
  }, [selectedMarkingResult, onClearSelectedResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear selectedMarkingResult after switching to chat mode to prevent title reversion
  useEffect(() => {
    if (pageMode === 'chat' && selectedMarkingResult && onClearSelectedResult) {
      const timer = setTimeout(() => {
        onClearSelectedResult();
      }, 1000); // Clear after 1 second to ensure title is set
      
      return () => clearTimeout(timer);
    }
  }, [pageMode, selectedMarkingResult, onClearSelectedResult]);

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
      
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrl(e.target.result);
      };
      reader.readAsDataURL(file);
    } else {
      setSelectedFile(null);
      setPreviewUrl(null);
    }
  }, []);


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


  // Handle image analysis
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
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
                favorite: false,
                rating: 0,
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
                content: ensureStringContent(data.response),
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
        
        // Set session title for question-only mode
        if (result.sessionId) {
          // Use session title from backend (which uses the same logic as database)
          const sessionTitle = result.sessionTitle || `Question - ${new Date().toLocaleDateString()}`;
          setSessionTitle(sessionTitle);
          
          // Initialize session data with default values for new sessions
          loadSessionData({ favorite: false, rating: 0 });
        }
        
        // Switch to chat mode after AI response is ready
        setPageMode('chat');
        
        return; // Exit early for question-only mode
      }

      // Store the classification result
      setClassificationResult({
        isQuestionOnly: false,
        reasoning: result.reasoning,
        apiUsed: result.apiUsed,
        questionDetection: result.questionDetection
      });

      // Store the marking result with metadata for task details
      setMarkingResult({
        metadata: result.metadata || {},
        instructions: result.instructions,
        annotatedImage: result.annotatedImage,
        apiUsed: result.apiUsed
      });


      // Set session title for marking mode
      if (result.sessionId) {
        // Use session title from backend (which uses the same logic as database)
        const sessionTitle = result.sessionTitle || `Marking - ${new Date().toLocaleDateString()}`;
        setSessionTitle(sessionTitle);
        
        // Initialize session data with default values for new sessions
        loadSessionData({ favorite: false, rating: 0 });
      }
      
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
              favorite: false,
              rating: 0,
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
              favorite: false,
              rating: 0,
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
                      content: ensureStringContent(msg.content),
                      rawContent: ensureStringContent(msg.rawContent || msg.content),
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
                      isImageContext: msg.isImageContext || false
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
    } finally {
      setIsProcessing(false);
    }
  }, [selectedFile, selectedModel, onMarkingResultSaved, chatMessages, getAuthToken]);




   const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;
    
    // Check if enough time has passed since last request
    if (!canMakeRequest()) {
      return;
    }

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: ensureStringContent(chatInput),
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
          mode: mode,
          favorite: false,
          rating: 0
        }),
      });

      const data = await response.json();

             if (data.success) {
        
        // Update session ID if we got a new one
        if (data.sessionId && data.sessionId !== currentSessionId) {
          setCurrentSessionId(data.sessionId);
          
          // Set session title for new session
          if (data.sessionTitle) {
            setSessionTitle(data.sessionTitle);
          } else {
            // Generate a default title based on the first message
            const title = chatInput.length > 50 ? chatInput.substring(0, 50) + '...' : chatInput;
            setSessionTitle(title || 'Chat Session');
          }
        } else {
          // Even for existing sessions, update the title if provided
          if (data.sessionTitle && data.sessionTitle !== 'Chat Session') {
            setSessionTitle(data.sessionTitle);
          }
        }
        
        // Add AI response to chat
        const aiResponse = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'assistant',
          content: ensureStringContent(data.response),
          rawContent: ensureStringContent(data.response), // Store raw content for toggle
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
                  <h1>
                    {sessionTitle.length > 100 ? sessionTitle.substring(0, 100) + '...' : sessionTitle}
                  </h1>
                </div>
                <div className="chat-header-right">
                <div className="info-dropdown-container">
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
                  
                  {/* Info Dropdown */}
                  {showInfoDropdown && (
                    <div className="info-dropdown">
                      <div className="info-dropdown-content">
                        {/* Header */}
                        <div className="dropdown-header">
                          <h3>Task Details</h3>
                        </div>
                        
                        {/* Main Content */}
                        <div className="dropdown-main-content">
                          {/* Label-Value Pairs */}
                          <div className="label-value-pairs">
                            <div className="label-value-item">
                              <span className="label">Title:</span>
                              <span className="value">{sessionTitle.length > 30 ? sessionTitle.substring(0, 30) + '...' : sessionTitle}</span>
                            </div>
                            <div className="label-value-item">
                              <span className="label">Question Type:</span>
                              <span className="value">{classificationResult?.classification?.questionType || 'Math Problem'}</span>
                            </div>
                            <div className="label-value-item">
                              <span className="label">Difficulty:</span>
                              <span className="value">{classificationResult?.classification?.difficulty || 'Medium'}</span>
                            </div>
                            <div className="label-value-item">
                              <span className="label">Subject:</span>
                              <span className="value">{classificationResult?.classification?.subject || 'Mathematics'}</span>
                            </div>
                          </div>
                          
                          {/* Agent and Speed */}
                          <div className="agent-speed-section">
                            <div className="agent-info">
                              <span className="label">Agent:</span>
                              <span className="value">AI Tutor v2.1</span>
                            </div>
                            <div className="speed-info">
                              <span className="label">Speed:</span>
                              <span className="value">Fast</span>
                            </div>
                          </div>
                          
                          {/* Rating */}
                            <div className="rating-section">
                              <span className="label">Rating:</span>
                              <div 
                                className={`star-rating ${!user?.uid ? 'disabled' : ''}`}
                                onMouseLeave={() => setHoveredRating(0)}
                                title={!user?.uid ? "Login required to save ratings" : "Rate this session"}
                              >
                                {[1, 2, 3, 4, 5].map((starValue) => {
                                  const displayRating = hoveredRating || rating;
                                  const isFilled = starValue <= displayRating;
                                  return (
                                    <span 
                                      key={starValue}
                                      className={`star ${isFilled ? 'filled' : ''} ${!user?.uid ? 'disabled' : ''}`}
                                      onClick={() => user?.uid && handleRatingChange(starValue)}
                                      onMouseEnter={() => user?.uid && setHoveredRating(starValue)}
                                      style={{ cursor: user?.uid ? 'pointer' : 'not-allowed' }}
                                    >
                                      ★
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                        </div>
                        
                        {/* Footer */}
                        <div className="dropdown-footer">
                          <div className="token-count">
                            <span className="label">LLM Tokens:</span>
                            <span className="value">{markingResult?.metadata?.tokens?.[0]?.toLocaleString() || 'N/A'}</span>
                          </div>
                          <div className="mathpix-count">
                            <span className="label">Mathpix Calls:</span>
                            <span className="value">{markingResult?.metadata?.tokens?.[1] || 'N/A'}</span>
                          </div>
                          <div className="processing-time">
                            <span className="label">Processing Time:</span>
                            <span className="value">
                              {markingResult?.metadata?.totalProcessingTimeMs 
                                ? `${(markingResult.metadata.totalProcessingTimeMs / 1000).toFixed(1)}s`
                                : 'N/A'
                              }
                            </span>
                          </div>
                          <div className="last-update">
                            <span className="label">Last Update:</span>
                            <span className="value">{new Date().toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                <button 
                  className={`header-btn favorite-btn ${isFavorite ? 'favorited' : ''} ${!user?.uid ? 'disabled' : ''}`}
                  onClick={handleFavoriteToggle}
                  title={!user?.uid ? "Login required to save favorites" : (isFavorite ? "Remove from favorites" : "Add to favorites")}
                  disabled={!user?.uid}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                  </svg>
                </button>
                </div>
              </div>
            </div>
            
          
          <div className="chat-messages">
              {chatMessages.map((message, index) => (
                <div 
                  key={`${message.id}-${index}`} 
                  className={`chat-message ${message.role}`}
                >
                  <div className={`message-bubble ${(message.type === 'marking_original' || message.type === 'marking_annotated') ? 'marking-message' : ''}`}>
                    {message.role === 'assistant' ? (
                      <div>
                        <div className="assistant-header">
                          <Brain size={20} className="assistant-brain-icon" />
                        </div>
                        
                        {/* Only show content for regular chat messages, not marking messages */}
                        {message.type !== 'marking_annotated' && message.type !== 'marking_original' && 
                         message.content && 
                         ensureStringContent(message.content).trim() !== '' && (
                          <MarkdownMathRenderer 
                            content={ensureStringContent(message.content)}
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
                        
                        
                        <button 
                          className="raw-toggle-btn"
                          onClick={() => {
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
                              {ensureStringContent(message.rawContent || message.content)}
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
                        {!message.isImageContext && !message.type && message.content && ensureStringContent(message.content).trim() !== '' && (
                          <div className="message-text">{ensureStringContent(message.content)}</div>
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
          <div className="chat-history-input">
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
      <div className="main-upload-input-bar">
        <div className="main-upload-input">
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
