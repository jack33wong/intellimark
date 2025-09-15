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
import SendButton from './chat/SendButton';
import ModelSelector from './chat/ModelSelector';

// Utils
import { ensureStringContent } from '../utils/contentUtils';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';

// Icons
import { Bot, ChevronDown, Brain } from 'lucide-react';

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
    getImageSrc,
    setMarkingResult
  } = useMarkHomework();
  
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
  }, [selectedMarkingResult, loadSessionData, setMarkingResult]);

  // Load messages when page mode changes to chat
  useEffect(() => {
    if (pageMode === 'chat' && selectedMarkingResult?.messages?.length > 0) {
      loadMessages(selectedMarkingResult);
    }
  }, [pageMode, selectedMarkingResult, loadMessages]);



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
  }, [handleScrollChange, chatContainerRef, chatMessages.length]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================
  
  // Handle image analysis
  const handleAnalyzeImage = useCallback(async () => {
    if (!selectedFile) return;
    
    try {
      // Convert image to base64
      const imageData = await processImage(selectedFile);
      
      // Analyze image
      const result = await analyzeImage(imageData, selectedModel);
      
      // Handle question-only case
      if (result.isQuestionOnly) {
        // Question-only sessions are now handled entirely by the mark-homework API
        // Load messages from the backend response instead of calling chat API
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
          
          // Notify sidebar to refresh when new session is created
          EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
            sessionId: result.session.id, 
            type: 'question' 
          });
        }
        
        // Switch to chat mode
        setPageMode('chat');
      } else {
        // Marking result - set marking data and switch to chat
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
          
          // Notify sidebar to refresh when new session is created
          EventManager.dispatch(EVENT_TYPES.SESSION_UPDATED, { 
            sessionId: result.session.id, 
            type: 'marking' 
          });
        }
        setPageMode('chat');
      }
      
      // Clear file selection
      clearFile();
      
    } catch (error) {
      console.error('Error analyzing image:', error);
    }
  }, [selectedFile, selectedModel, processImage, analyzeImage, setMarkingResult, loadMessages, clearFile, loadSessionData]);
  
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
                <div 
                  key={`${message.id}-${index}`} 
                  className={`chat-message ${message.role}`}
                >
                    <div className={`message-bubble ${(message.type === 'marking_original' || message.type === 'marking_annotated' || message.type === 'question_original') ? 'marking-message' : ''}`}>
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
                          {message.type === 'marking_annotated' && message.imageLink && (
                            <div className="homework-annotated-image">
                              <h4>✅ Marked Homework Image</h4>
                              <img 
                                src={getImageSrc(message.imageLink)}
                                alt="Marked homework"
                                className="annotated-image"
                                onLoad={handleImageLoad}
                                onError={(e) => {
                                  console.warn('Failed to load image:', message.imageLink);
                                  e.target.style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          {/* User message content */}
                          {message.imageLink && (
                            <div className="message-image">
                              <img 
                                src={getImageSrc(message.imageLink)}
                                alt="Uploaded"
                                className="content-image"
                                onLoad={handleImageLoad}
                                onError={(e) => {
                                  console.warn('Failed to load user image:', message.imageLink);
                                  e.target.style.display = 'none';
                                }}
                              />
                            </div>
                          )}
                          
                          <div className="message-text">
                            {typeof message.content === 'string' ? message.content : String(message.content || '')}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              ))}
              
              {/* Processing indicator */}
              {isProcessing && (
                <div className="chat-message assistant">
                  <div className="message-bubble">
                    <div className="assistant-header">
                      <Brain size={20} className="assistant-brain-icon" />
                    </div>
                    <div className="thinking-animation">
                      <div className="thinking-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                      <span className="thinking-text">AI is thinking...</span>
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
            onKeyPress={handleKeyPress}
            onUploadClick={handleFileSelect}
          />
        </div>
      )}
    </>
  );
};

export default MarkHomeworkPageRefactored;
