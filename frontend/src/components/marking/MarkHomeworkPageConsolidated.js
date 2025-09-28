/**
 * MarkHomeworkPageConsolidated Component
 * 
 * Consolidated version with single image handler function
 * - Removes duplicate handleAnalyzeImage and handleFollowUpImage
 * - Single handleImageAnalysis function for both initial and follow-up uploads
 * - Clear session management
 * - Simplified state flow
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useImageUpload } from '../../hooks/useImageUpload';
import { useMarkHomework } from '../../hooks/useMarkHomework';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { useAuth } from '../../contexts/AuthContext';
import { simpleSessionService } from '../../services/simpleSessionService';
import MainLayout from './MainLayout';

const MarkHomeworkPageConsolidated = ({
  selectedMarkingResult,
  onClearSelectedResult,
  onMarkingResultSaved
}) => {
  // ============================================================================
  // HOOKS
  // ============================================================================

  // Authentication context
  const { user } = useAuth();

  // Image upload state
  const {
    selectedFile,
    processImage,
    clearFile,
    handleFileSelect
  } = useImageUpload();

  // Consolidated mark homework state - SINGLE SOURCE OF TRUTH
  const {
    // UI State
    pageMode,
    isProcessing,
    isAIThinking,
    error,
    
    // Session data from service
    currentSession,
    chatMessages,
    sessionTitle,
    isFavorite,
    rating,
    
    // Chat input state
    chatInput,
    
    // Progress state
    loadingProgress,
    loadingStep,
    loadingTotalSteps,
    loadingMessage,
    progressData,
    stepList,
    completedSteps,
    showProgressDetails,
    
    // Actions - simplified
    startProcessing,
    stopProcessing,
    startAIThinking,
    stopAIThinking,
    setPageMode,
    handleError,
    
    // Chat input management
    setChatInput,
    onSendMessage,
    onKeyPress,
    setShowProgressDetails,
    
    // Session management
    clearSession,
    addMessage,
    processImageAPI,
    loadSession,
    
    // Text-only submission tracking
    isTextOnlySubmission
  } = useMarkHomework();

  // Model selection state
  const [selectedModel, setSelectedModel] = useState('auto');
  
  
  // Handle model change
  const handleModelChange = useCallback((model) => {
    setSelectedModel(model);
  }, []);

  // Auto scroll functionality
  const {
    containerRef: chatContainerRef,
    scrollToBottom,
    handleImageLoad,
    handleScroll
  } = useAutoScroll(chatMessages);

  // Auto-scroll for text-only submissions
  useEffect(() => {
    if (isTextOnlySubmission && chatMessages.length > 0) {
      // Small delay to ensure the message is rendered
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  }, [isTextOnlySubmission, chatMessages.length, scrollToBottom]);

  // Scroll button state
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  // Session management state
  const [showInfoDropdown, setShowInfoDropdown] = useState(false);
  const [hoveredRating, setHoveredRating] = useState(0);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Load selected session when selectedMarkingResult changes
  useEffect(() => {
    if (selectedMarkingResult) {
      // Load the session into the hook
      if (loadSession) {
        loadSession(selectedMarkingResult);
      }
      
      // Switch to chat mode to show the messages
      setPageMode('chat');
      
      // Notify parent component about page mode change
    } else {
      // Clear session and switch to upload mode
      clearSession();
      setPageMode('upload');
      
      // Notify parent component about page mode change
    }
  }, [selectedMarkingResult, loadSession, clearSession, setPageMode]);

  // Handle scroll events to show/hide scroll button
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      const handleScrollEvent = () => {
        handleScroll(setShowScrollButton);
      };
      
      container.addEventListener('scroll', handleScrollEvent);
      
      // Initial check to set scroll button visibility
      handleScrollEvent();
      
      return () => {
        container.removeEventListener('scroll', handleScrollEvent);
      };
    }
  }, [chatContainerRef, handleScroll, chatMessages.length]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  // Handle clear preview
  const handleClearPreview = useCallback((clearPreviewFn) => {
    if (clearPreviewFn) {
      clearPreviewFn();
    }
  }, []);

  // ============================================================================
  // UNIFIED IMAGE HANDLER
  // ============================================================================

  // Handle image analysis - PHASE-SEPARATED VERSION
  const handleImageAnalysis = useCallback(async (file = null, customText = null) => {
    try {
      const targetFile = file || selectedFile;
      if (!targetFile) {
        return;
      }
      
      // ========================================
      // PHASE 1: Upload & User Message (200-500ms)
      // ========================================
      
      // 1. Set state to PROCESSING
      startProcessing();
      
      // 2. Convert image to base64 and show image immediately
      const imageData = await processImage(targetFile);
      
      // 4. Determine if this is initial upload or follow-up
      const isInitialUpload = !file; // If no file parameter, it's initial upload
      
      // 5. Show user message immediately ONLY for initial uploads
      // For follow-up messages, the backend will handle user message creation to avoid duplicates
      if (isInitialUpload) {
        const userMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: customText || 'I have a question about this image. Can you help me understand it?',
          timestamp: new Date().toISOString(),
          type: 'marking_original',
          imageData: imageData,
          fileName: targetFile.name
        };
        
        await addMessage(userMessage);
      }
      
      // ========================================
      // PHASE 2: AI Processing (??? ms)
      // ========================================
      
      // 6. Switch to chat mode to show AI thinking animation
      setPageMode('chat');
      
      // 7. Start AI thinking animation
      startAIThinking();
      
      // 8. Call API (this will show AI thinking animation)
      // Backend processes image and creates session
      // Backend generates marking instructions
      // Creates annotated image
      // AI response appears in chat
      // Note: stopAIThinking() is now called inside processImageAPI()
      await processImageAPI(imageData, selectedModel, 'marking', customText);
      
      // ========================================
      // PHASE 3: Complete
      // ========================================
      
      // 7. Stop processing (ready for next interaction)
      stopProcessing();
      
      // 8. Clean up
      if (!file) {
        clearFile();
      }
      handleClearPreview();

    } catch (error) {
      console.error('❌ Error in image analysis:', error);
      stopAIThinking(); // Stop AI thinking on error
      stopProcessing(); // Stop processing on error
      handleError(error);
    }
  }, [selectedFile, selectedModel, processImage, processImageAPI, addMessage, clearFile, startProcessing, stopProcessing, handleError, handleClearPreview, setPageMode, startAIThinking, stopAIThinking]);

  // Handle follow-up image (legacy compatibility)
  const handleFollowUpImage = useCallback((file, customText = null) => handleImageAnalysis(file, customText), [handleImageAnalysis]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <MainLayout
        // Page mode
        pageMode={pageMode}
      
      // Image upload props
      selectedFile={selectedFile}
      onFileSelect={handleFileSelect}
      onAnalyzeImage={handleImageAnalysis}
      onClearFile={clearFile}
      selectedModel={selectedModel}
      onModelChange={handleModelChange}
      
      // Session props
      currentSession={currentSession}
      chatMessages={chatMessages}
      sessionTitle={sessionTitle}
      isFavorite={isFavorite}
      rating={rating}
      isProcessing={isProcessing}
      isAIThinking={isAIThinking}
      isTextOnlySubmission={isTextOnlySubmission}
      
      // Session management props
      onFavoriteToggle={async () => {
        if (currentSession) {
          // Toggle favorite status
          const newFavoriteStatus = !isFavorite;
          
          try {
            // Update in backend first
            await simpleSessionService.updateSession(currentSession.id, {
              favorite: newFavoriteStatus,
              updatedAt: new Date().toISOString()
            });
            
            // Update the session in the service (only after successful backend update)
            const updatedSession = {
              ...currentSession,
              favorite: newFavoriteStatus,
              updatedAt: new Date().toISOString()
            };
            
            // Update the service state
            simpleSessionService.setCurrentSession(updatedSession);
            simpleSessionService.updateSidebarSession(updatedSession);
            
            // Trigger event for real-time updates
            simpleSessionService.triggerSessionUpdate(updatedSession);
          } catch (error) {
            console.error('❌ Failed to update favorite status:', error);
          }
        }
      }}
      onRatingChange={async (rating) => {
        if (currentSession) {
          try {
            // Update in backend first
            await simpleSessionService.updateSession(currentSession.id, {
              rating: rating,
              updatedAt: new Date().toISOString()
            });
            
            // Update the session in the service (only after successful backend update)
            const updatedSession = {
              ...currentSession,
              rating: rating,
              updatedAt: new Date().toISOString()
            };
            
            // Update the service state
            simpleSessionService.setCurrentSession(updatedSession);
            simpleSessionService.updateSidebarSession(updatedSession);
            
            // Trigger event for real-time updates
            simpleSessionService.triggerSessionUpdate(updatedSession);
          } catch (error) {
            console.error('❌ Failed to update rating:', error);
          }
        }
      }}
      onRatingHover={setHoveredRating}
      user={user}
      markingResult={null}
      sessionData={currentSession} // Pass current session as sessionData
      showInfoDropdown={showInfoDropdown}
      onToggleInfoDropdown={() => setShowInfoDropdown(!showInfoDropdown)}
      hoveredRating={hoveredRating}
      
      // Chat scroll props
      chatContainerRef={chatContainerRef}
      showScrollButton={showScrollButton}
      scrollToBottom={scrollToBottom}
      handleImageLoad={handleImageLoad}
      getImageSrc={(message) => {
        // Handle different image source formats
        if (message?.imageLink) {
          return message.imageLink; // Firebase Storage URL
        }
        if (message?.imageData) {
          // If imageData is already a data URL, return it directly
          if (typeof message.imageData === 'string' && message.imageData.startsWith('data:')) {
            return message.imageData;
          }
          // If imageData is a base64 string without data URL prefix, add it
          if (typeof message.imageData === 'string' && !message.imageData.startsWith('data:')) {
            return `data:image/png;base64,${message.imageData}`;
          }
          return message.imageData;
        }
        return null;
      }}
      
      // Follow-up chat props
      onFollowUpImage={handleFollowUpImage}
      onUploadClick={handleFileSelect}
      onClearPreview={handleClearPreview}
      
      // Additional props
      previewUrl={null}
      loadingProgress={loadingProgress}
      loadingStep={loadingStep}
      loadingTotalSteps={loadingTotalSteps}
      loadingMessage={loadingMessage}
      progressData={progressData}
      stepList={stepList}
      completedSteps={completedSteps}
      showExpandedThinking={false}
      showProgressDetails={showProgressDetails}
      setShowProgressDetails={setShowProgressDetails}
      markError={error}
      chatInput={chatInput}
      setChatInput={setChatInput}
      onSendMessage={onSendMessage}
      onKeyPress={onKeyPress}
    />
  );
};

export default MarkHomeworkPageConsolidated;
