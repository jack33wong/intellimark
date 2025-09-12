/**
 * MarkHomeworkPage - Refactored Version
 * 
 * This refactored version separates UI from business logic using:
 * - Custom hooks for state management
 * - Service layer for API calls
 * - Smaller, focused components
 * - Clear separation of concerns
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Custom hooks
import { useImageUpload } from '../hooks/useImageUpload';
import { useChat } from '../hooks/useChat';
import { useMarkHomework } from '../hooks/useMarkHomework';
import { useSession } from '../hooks/useSession';
import { useSubscriptionDelay } from '../hooks/useSubscriptionDelay';

// Components
import ImageUploadForm from './markHomework/ImageUploadForm';
import ChatInterface from './markHomework/ChatInterface';
import SessionHeader from './markHomework/SessionHeader';

// Services
import MarkHomeworkService from '../services/markHomeworkService';

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
  
  const [pageMode, setPageMode] = useState('upload'); // 'upload' | 'chat'
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showInfoDropdown, setShowInfoDropdown] = useState(false);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');
  
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
    currentSessionId,
    sessionTitle,
    setSessionTitle,
    sendMessage,
    loadMessages,
    clearChat,
    chatContainerRef,
    scrollToBottom
  } = useChat();
  
  // Mark homework functionality
  const {
    isProcessing: isMarkProcessing,
    classificationResult,
    markingResult,
    error: markError,
    loadingProgress,
    analyzeImage,
    clearResults,
    getImageSrc,
    setMarkingResult
  } = useMarkHomework();
  
  // Session management
  const {
    isFavorite,
    rating,
    hoveredRating,
    setHoveredRating,
    loadSessionData,
    handleFavoriteToggle,
    handleRatingChange,
    clearSession
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
      // Load session data
      loadSessionData(selectedMarkingResult);
      
      // Load messages if available
      if (selectedMarkingResult.messages && selectedMarkingResult.messages.length > 0) {
        loadMessages(selectedMarkingResult);
        setPageMode('chat');
      }
      
      // Set marking result for display
      if (selectedMarkingResult.instructions || selectedMarkingResult.annotatedImage) {
        setMarkingResult(selectedMarkingResult);
      }
    }
  }, [selectedMarkingResult, loadSessionData, loadMessages, setMarkingResult]);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    if (chatContainerRef.current) {
      const container = chatContainerRef.current;
      const { scrollTop, scrollHeight, clientHeight } = container;
      
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isAtBottom = distanceFromBottom <= 10;
      const shouldShowButton = !isAtBottom && chatMessages.length > 0;
      setShowScrollButton(shouldShowButton);
    }
  }, [chatMessages.length]);

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
        // Create initial user message
        const initialUserMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          content: 'I have a question about this image. Can you help me understand it?',
          timestamp: new Date().toISOString(),
          type: 'question_original',
          imageData: imageData,
          fileName: selectedFile.name,
          detectedQuestion: {
            examDetails: result.questionDetection?.match?.markingScheme?.examDetails || result.questionDetection?.match?.examDetails || {},
            questionNumber: result.questionDetection?.match?.questionNumber || 'Unknown',
            questionText: result.questionDetection?.match?.questionText || result.classification?.extractedQuestionText || '',
            confidence: result.questionDetection?.match?.markingScheme?.confidence || result.questionDetection?.match?.confidence || 0
          }
        };
        
        // Send to chat API for AI response
        await sendMessage('I have a question about this image. Can you help me understand it?', {
          imageData: imageData,
          model: selectedModel,
          sessionId: result.sessionId,
          mode: 'question'
        });
        
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
        
        // Create messages for marking result
        const userMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          content: 'I have a question about this image. Can you help me understand it?',
          timestamp: new Date().toISOString(),
          type: 'marking_original',
          imageData: imageData,
          fileName: selectedFile.name
        };
        
        const aiMessage = {
          id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'assistant',
          content: result.message || 'Question marked successfully with burned annotations',
          timestamp: new Date().toISOString(),
          type: 'marking_annotated',
          model: selectedModel,
          apiUsed: result.apiUsed,
          markingData: {
            instructions: result.instructions,
            annotatedImage: result.annotatedImage,
            classification: result.classification
          },
          detectedQuestion: result.questionDetection,
          metadata: {
            processingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
            tokens: result.metadata?.tokens || [0, 0],
            confidence: result.metadata?.confidence || 0,
            totalAnnotations: result.metadata?.totalAnnotations || 0,
            imageSize: result.metadata?.imageSize || 0,
            ocrMethod: result.ocrMethod || 'Enhanced OCR Processing',
            classificationResult: result.classification
          }
        };
        
        // Load messages and switch to chat
        loadMessages({
          id: result.sessionId,
          title: result.sessionTitle,
          messages: [userMessage, aiMessage]
        });
        setPageMode('chat');
      }
      
      // Clear file selection
      clearFile();
      
    } catch (error) {
      console.error('Error analyzing image:', error);
    }
  }, [selectedFile, selectedModel, processImage, analyzeImage, sendMessage, setMarkingResult, loadMessages, clearFile]);
  
  // Handle sending chat message
  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim() || !canMakeRequest()) return;
    
    updateLastRequestTime();
    
    // Determine if this is the first message
    const isFirstMessage = chatMessages.length === 0;
    const imageData = isFirstMessage && selectedFile ? await processImage(selectedFile) : null;
    const mode = isFirstMessage ? (classificationResult?.isQuestionOnly ? 'question' : 'qa') : undefined;
    
    await sendMessage(chatInput.trim(), {
      imageData: imageData,
      model: selectedModel,
      sessionId: currentSessionId,
      mode: mode
    });
  }, [chatInput, canMakeRequest, updateLastRequestTime, chatMessages.length, selectedFile, processImage, classificationResult, sendMessage, selectedModel, currentSessionId]);
  
  // Handle key press in chat input
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }, [handleSendMessage]);
  
  // Handle clear result
  const handleClearResult = useCallback(() => {
    clearResults();
    clearChat();
    clearSession();
    setPageMode('upload');
    if (onClearSelectedResult) {
      onClearSelectedResult();
    }
  }, [clearResults, clearChat, clearSession, onClearSelectedResult]);
  
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
            onModelChange={setSelectedModel}
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
              showInfoDropdown={showInfoDropdown}
              onToggleInfoDropdown={() => setShowInfoDropdown(!showInfoDropdown)}
            />
            
            <ChatInterface
              messages={chatMessages}
              chatInput={chatInput}
              onInputChange={setChatInput}
              onSendMessage={handleSendMessage}
              onKeyPress={handleKeyPress}
              isProcessing={isProcessing}
              showScrollButton={showScrollButton}
              onScrollToBottom={scrollToBottom}
              markingResult={markingResult}
              getImageSrc={getImageSrc}
            />
          </div>
          
          <div className="chat-actions">
            <button 
              className="clear-btn"
              onClick={handleClearResult}
              title="Start new session"
            >
              Clear & Start New
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default MarkHomeworkPageRefactored;
