/**
 * MarkHomeworkPage - Refactored Version
 * 
 * This refactored version separates UI from business logic using:
 * - Custom hooks for state management
 * - Service layer for API calls
 * - Smaller, focused components
 * - Clear separation of concerns
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Custom hooks
import { useImageUpload } from '../hooks/useImageUpload';
import { useChat } from '../hooks/useChat';
import { useMarkHomework } from '../hooks/useMarkHomework';
import { useSession } from '../hooks/useSession';
import { useSubscriptionDelay } from '../hooks/useSubscriptionDelay';
import { usePageState } from '../hooks/usePageState';

// Components
import ImageUploadForm from './markHomework/ImageUploadForm';
import SessionHeader from './markHomework/SessionHeader';
import MarkdownMathRenderer from './MarkdownMathRenderer';
import FollowUpChatInput from './chat/FollowUpChatInput';
import { ChatMessage } from './focused';

// Utils
import { ensureStringContent } from '../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';

// Icons
import { ChevronDown, Brain } from 'lucide-react';

// Services
// import MarkHomeworkService from '../services/markHomeworkService';

// Styles
import './MarkHomeworkPage.css';

const MarkHomeworkPageRefactored = ({ 
  selectedMarkingResult, 
  onClearSelectedResult, 
  onMarkingResultSaved, 
  onPageModeChange 
}) => {
  const { user } = useAuth();
  
  // ============================================================================
  // CORE STATE
  // ============================================================================
  
  // Page state management
  const {
    pageMode,
    showScrollButton,
    showInfoDropdown,
    selectedModel,
    setPageMode,
    setScrollButton,
    setInfoDropdown,
    setModel
  } = usePageState();
  
  // ============================================================================
  // CUSTOM HOOKS
  // ============================================================================
  
  // Image upload functionality
  const {
    selectedFile,
    previewUrl,
    isProcessing: isImageProcessing,
    handleFileSelect,
    clearFile,
    processImage
  } = useImageUpload();
  
  // Chat functionality
  const {
    chatMessages,
    setChatMessages,
    chatInput,
    setChatInput,
    isProcessing: isChatProcessing,
    currentSessionData,
    sendMessage,
    loadMessages,
    chatContainerRef,
    scrollToBottom,
    handleImageLoad
  } = useChat();
  
  // Mark homework functionality
  const {
    isProcessing: isMarkProcessing,
    classificationResult,
    markingResult,
    error: markError,
    loadingProgress,
    analyzeImage,
    processAIResponse,
    getImageSrc,
    setMarkingResult
  } = useMarkHomework();
  
  // State for waiting for 2nd AI response
  const [isWaitingForAI, setIsWaitingForAI] = useState(false);
  
  // Session management
  const {
    currentSessionId,
    sessionTitle,
    isFavorite,
    rating,
    hoveredRating,
    setHoveredRating,
    loadSessionData,
    handleFavoriteToggle,
    handleRatingChange
  } = useSession();
  
  // Subscription delay management
  const {
    canMakeRequest,
    updateLastRequestTime
  } = useSubscriptionDelay();
  
  // ============================================================================
  // COMPUTED STATE
  // ============================================================================
  
  const isProcessing = isImageProcessing || isChatProcessing || isMarkProcessing;
  
  // ============================================================================
  // EFFECTS
  // ============================================================================
  
  // Notify parent of page mode changes
  useEffect(() => {
    if (onPageModeChange) {
      onPageModeChange(pageMode);
    }
  }, [pageMode, onPageModeChange]);

  // Handle selected marking result from sidebar
  useEffect(() => {
    if (selectedMarkingResult) {
      // Load session data first
      loadSessionData(selectedMarkingResult);
      
      // Set marking result for display
      if (selectedMarkingResult.instructions || selectedMarkingResult.annotatedImage) {
        setMarkingResult(selectedMarkingResult);
      }
      
      // Load messages if available
      if (selectedMarkingResult.messages && selectedMarkingResult.messages.length > 0) {
        setPageMode('chat'); // This will trigger the next useEffect
      }
    }
  }, [selectedMarkingResult, loadSessionData, setMarkingResult, setPageMode]);

  // Load messages when page mode changes to chat
  useEffect(() => {
    if (pageMode === 'chat' && selectedMarkingResult?.messages?.length > 0) {
      loadMessages(selectedMarkingResult);
    }
  }, [pageMode, selectedMarkingResult, loadMessages, setPageMode]);



  // Handle scroll events using centralized logic
  const handleScrollChange = useCallback((isNearBottom) => {
    setScrollButton(!isNearBottom && chatMessages.length > 0);
  }, [chatMessages.length, setScrollButton]);

  // Show/hide scroll button based on scroll position and content
  useEffect(() => {
    if (chatMessages.length > 0) {
      const container = chatContainerRef.current;
      if (container) {
        const isScrollable = container.scrollHeight > container.clientHeight;
        setScrollButton(isScrollable);
      }
    } else {
      setScrollButton(false);
    }

    // Add scroll event listener using centralized handler
    const container = chatContainerRef.current;
    if (container) {
      const scrollHandler = () => {
        const { scrollTop, scrollHeight, clientHeight } = container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const isNearBottom = distanceFromBottom <= 10;
        handleScrollChange(isNearBottom);
      };
      
      container.addEventListener('scroll', scrollHandler);
      scrollHandler(); // Check initial state
      return () => container.removeEventListener('scroll', scrollHandler);
    }
  }, [handleScrollChange, chatContainerRef, chatMessages.length, setScrollButton]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================
  
  // Common function to handle image processing and display
  const processImageWithImmediateDisplay = useCallback(async (file, isFollowUp = false) => {
    if (!file) return;
    
    try {
      // Convert image to base64
      const imageData = await processImage(file);
      
      if (isFollowUp) {
        // For follow-up: Use the same mark-homework API but with existing sessionId
        const result = await analyzeImage(imageData, selectedModel, currentSessionId);
        
        if (result.responseType === 'original_image') {
          // Response 1: Original image from database - add to existing chat
          setChatMessages(prev => [...prev, result.userMessage]);
          
          // Process AI response in background
          setTimeout(async () => {
            try {
              // Show AI thinking animation
              setIsWaitingForAI(true);
              
              const aiResult = await processAIResponse(imageData, selectedModel, result.sessionId);
              
              if (aiResult.responseType === 'ai_response') {
                // Response 2: AI response
                setChatMessages(prev => [...prev, aiResult.aiMessage]);
                
                // Notify sidebar to refresh
                EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
                  sessionId: result.sessionId, 
                  type: aiResult.isQuestionOnly ? 'question' : 'marking' 
                });
              }
            } catch (error) {
              console.error('Error processing AI response:', error);
            } finally {
              // Hide AI thinking animation
              setIsWaitingForAI(false);
            }
          }, 1000); // Small delay to show processing indicator
          
        } else {
          // Legacy format - handle as before
          console.warn('Unexpected response format for follow-up image');
        }
      } else {
        // Send to backend for processing (creates new session)
        const result = await analyzeImage(imageData, selectedModel);
        
        
        // Check if this is the new 2-response format (both authenticated and unauthenticated users)
        if (result.responseType === 'original_image') {
          // Response 1: Original image from database - show this immediately
          setChatMessages(prev => [...prev, result.userMessage]);
          
          // Switch to chat mode to show the image from database
          setPageMode('chat');
          
          // Update session data
          loadSessionData({
            id: result.sessionId,
            title: result.sessionTitle
          });
          
          // Process AI response in background
          (async () => {
            try {
              // Show AI thinking animation
              setIsWaitingForAI(true);
              
              const aiResult = await processAIResponse(imageData, selectedModel, result.sessionId);
              
              if (aiResult && aiResult.responseType === 'ai_response') {
                // Response 2: AI response
                setChatMessages(prev => {
                  const newMessages = [...prev, aiResult.aiMessage];
                  return newMessages;
                });
                
                // Notify sidebar to refresh
                EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
                  sessionId: result.sessionId, 
                  type: aiResult.isQuestionOnly ? 'question' : 'marking' 
                });
              }
            } catch (error) {
              console.error('Error processing AI response:', error);
            } finally {
              // Hide AI thinking animation
              setIsWaitingForAI(false);
            }
          })();
          
        } else {
          // Legacy format fallback (should not happen with new implementation)
          console.warn('Unexpected response format for main upload');
        }
        
        // Clear file selection for main upload
        clearFile();
      }
      
    } catch (error) {
      console.error('Error processing image:', error);
    }
  }, [selectedModel, processImage, analyzeImage, currentSessionId, loadSessionData, clearFile, setChatMessages, processAIResponse, setPageMode, setIsWaitingForAI]);

  // Handle main image analysis
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    
    // Process image to base64
    const imageData = await processImage(selectedFile);
    
    // Clear file selection immediately
    clearFile();
    
    // Process the image and wait for Response 1
    try {
      const result = await analyzeImage(imageData, selectedModel);
      
      // Check if this is the new 2-response format (both authenticated and unauthenticated users)
      if (result.responseType === 'original_image') {
        // Response 1: Original image from database - show this immediately
        setChatMessages(prev => [...prev, result.userMessage]);
        
        // Switch to chat mode to show the image from database
        setPageMode('chat');
        
        // Update session data
        loadSessionData({
          id: result.sessionId,
          title: result.sessionTitle
        });
        
        // Process AI response in background
        setTimeout(async () => {
          try {
            // Show AI thinking animation
            setIsWaitingForAI(true);
            
            const aiResult = await processAIResponse(imageData, selectedModel, result.sessionId);
            
            if (aiResult.responseType === 'ai_response') {
              // Response 2: AI response
              setChatMessages(prev => {
                const newMessages = [...prev, aiResult.aiMessage];
                return newMessages;
              });
              
              // Notify sidebar to refresh
              EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
                sessionId: result.sessionId, 
                type: aiResult.isQuestionOnly ? 'question' : 'marking' 
              });
            }
          } catch (error) {
            console.error('Error processing AI response:', error);
          } finally {
            // Hide AI thinking animation
            setIsWaitingForAI(false);
          }
        }, 1000); // Small delay to show processing indicator
        
      } else {
        // Legacy format (unauthenticated users) - wait for complete response
        if (result.isQuestionOnly) {
          // Question-only sessions
          if (result.session && result.session.messages) {
            // Update session data in useSession hook
            loadSessionData({
              id: result.session.id,
              title: result.session.title
            });
            
            // Load messages in useChat hook  
            loadMessages({
              id: result.session.id,
              title: result.session.title,
              messages: result.session.messages
            });
            
            // Switch to chat mode after loading messages
            setPageMode('chat');
            
            // Notify sidebar to refresh when new session is created
            EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
              sessionId: result.session.id, 
              type: 'question' 
            });
          }
        } else {
          // Marking result - set marking data
          setMarkingResult({
            instructions: result.instructions,
            annotatedImage: result.annotatedImage,
            classification: result.classification,
            metadata: result.metadata,
            apiUsed: result.apiUsed,
            ocrMethod: result.ocrMethod
          });
          
          // Load messages from backend response (contains proper imageLink)
          if (result.session && result.session.messages) {
            // Update session data in useSession hook
            loadSessionData({
              id: result.session.id,
              title: result.session.title
            });
            
            // Load messages in useChat hook
            loadMessages({
              id: result.session.id,
              title: result.session.title,
              messages: result.session.messages
            });
            
            // Switch to chat mode after loading messages
            setPageMode('chat');
            
            // Notify sidebar to refresh when new session is created
            EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
              sessionId: result.session.id, 
              type: 'marking' 
            });
          }
        }
      }
    } catch (error) {
      console.error('Error processing image:', error);
    }
  }, [selectedFile, processImage, setChatMessages, setPageMode, clearFile, analyzeImage, processAIResponse, selectedModel, loadSessionData, loadMessages, setMarkingResult, setIsWaitingForAI]);

  // Handle follow-up image analysis (for existing chat sessions)
  const handleFollowUpImage = useCallback(async (file) => {
    await processImageWithImmediateDisplay(file, true);
  }, [processImageWithImmediateDisplay]);
  
  // Handle sending chat message
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !canMakeRequest()) return;
    
    updateLastRequestTime();
    
    // Store the message text before clearing
    const messageText = chatInput.trim();
    
    // Clear input immediately after sending
    setChatInput('');
    
    // Determine if this is the first message
    const isFirstMessage = chatMessages.length === 0;
    const imageData = isFirstMessage && selectedFile ? await processImage(selectedFile) : null;
    const mode = isFirstMessage ? (classificationResult?.isQuestionOnly ? 'question' : 'qa') : undefined;
    
    await sendMessage(messageText, {
      imageData: imageData,
      model: selectedModel,
      sessionId: currentSessionId,
      mode: mode
    });
  }, [chatInput, canMakeRequest, updateLastRequestTime, chatMessages.length, selectedFile, processImage, classificationResult, sendMessage, selectedModel, currentSessionId, setChatInput]);
  
  // Handle key press in chat input
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);
  
  // Handle model selection
  const handleModelSelect = useCallback((model) => {
    setModel(model);
  }, [setModel]);
  
  // Handle clear result - removed as not used in current implementation
  
  // ============================================================================
  // RENDER
  // ============================================================================
  
  return (
    <>
      {pageMode === 'upload' ? (
        <div className="mark-homework-page upload-mode">
          <ImageUploadForm
            selectedFile={selectedFile}
            previewUrl={previewUrl}
            isProcessing={isProcessing}
            onFileSelect={handleFileSelect}
            onAnalyzeImage={handleAnalyzeImage}
            onClearFile={clearFile}
            selectedModel={selectedModel}
            onModelChange={setModel}
            loadingProgress={loadingProgress}
            showExpandedThinking={isProcessing}
          />
          
          {markError && (
            <div className="error-message">
              <p>{markError}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mark-homework-page chat-mode">
          <div className="chat-container" ref={chatContainerRef}>
            <SessionHeader
              sessionTitle={sessionTitle}
              isFavorite={isFavorite}
              onFavoriteToggle={handleFavoriteToggle}
              rating={rating}
              onRatingChange={handleRatingChange}
              hoveredRating={hoveredRating}
              onRatingHover={setHoveredRating}
              user={user}
              markingResult={markingResult}
              sessionData={currentSessionData}
              showInfoDropdown={showInfoDropdown}
              onToggleInfoDropdown={() => setInfoDropdown(!showInfoDropdown)}
            />
            
            <div className="chat-messages">
              {chatMessages.map((message, index) => (
                <ChatMessage
                  key={`${message.id}-${index}`}
                  message={message}
                  onImageLoad={handleImageLoad}
                  getImageSrc={getImageSrc}
                  MarkdownMathRenderer={MarkdownMathRenderer}
                  ensureStringContent={ensureStringContent}
                />
              ))}
              
              {/* Processing indicator */}
              {(isProcessing || isWaitingForAI) && (
                <div className="chat-message assistant">
                  <div className="message-bubble">
                    <div className="assistant-header">
                      <Brain size={20} className="assistant-brain-icon" />
                    </div>
                    <div className="thinking-indicator">
                      <div className="thinking-dots">
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                      </div>
                      <div className="thinking-text">
                        {isWaitingForAI ? 'AI is processing your image...' : 'AI is thinking...'}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            
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
          
          {/* Follow-up Chat Input Bar */}
          <FollowUpChatInput
            chatInput={chatInput}
            setChatInput={setChatInput}
            selectedModel={selectedModel}
            setSelectedModel={handleModelSelect}
            isProcessing={isProcessing}
            onSendMessage={handleSendMessage}
            onAnalyzeImage={handleAnalyzeImage}
            onFollowUpImage={handleFollowUpImage}
            onKeyPress={handleKeyPress}
            onUploadClick={handleFileSelect}
          />
        </div>
      )}
    </>
  );
};

export default MarkHomeworkPageRefactored;
