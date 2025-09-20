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
import { useSubscriptionDelay } from '../../hooks/useSubscriptionDelay';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import MainLayout from './MainLayout';
import { ensureStringContent } from '../../utils/contentUtils';

const MarkHomeworkPageConsolidated = ({
  selectedMarkingResult,
  onClearSelectedResult,
  onMarkingResultSaved,
  onPageModeChange
}) => {

  // ============================================================================
  // HOOKS
  // ============================================================================

  // Image upload state
  const {
    selectedFile,
    previewUrl,
    processImage,
    clearFile,
    handleFileSelect
  } = useImageUpload();

  // Consolidated mark homework state - SINGLE SOURCE OF TRUTH
  const {
    // State
    currentSession,
    chatMessages,
    sessionTitle,
    isFavorite,
    rating,
    pageMode,
    processingState,
    error,
    
    // Computed properties - simplified
    isIdle,
    isProcessing,
    isComplete,
    isError,
    
    // Actions - simplified
    startProcessing,
    completeProcessing,
    reset,
    setPageMode,
    handleError,
    
    // Session management
    clearSession,
    addMessage,
    processImageAPI,
    loadSession
  } = useMarkHomework();

  // Auto scroll functionality
  const {
    containerRef: chatContainerRef,
    scrollToBottom,
    handleImageLoad,
    handleScroll
  } = useAutoScroll(chatMessages);

  // Scroll button state
  const [showScrollButton, setShowScrollButton] = useState(false);

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
      if (onPageModeChange) {
        onPageModeChange('chat');
      }
    } else {
      // Clear session and switch to upload mode
      clearSession();
      setPageMode('upload');
      
      // Notify parent component about page mode change
      if (onPageModeChange) {
        onPageModeChange('upload');
      }
    }
  }, [selectedMarkingResult, loadSession, setPageMode, clearSession, onPageModeChange]);

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
  }, [chatContainerRef, handleScroll]);
  
  // Subscription delay state
  const {
    isDelayed,
    delayRemaining,
    checkSubscriptionDelay
  } = useSubscriptionDelay();


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
  const handleImageAnalysis = useCallback(async (file = null) => {
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
      
      // 2. Switch to chat mode (upload area moves to bottom)
      setPageMode('chat');
      
      // 3. Convert image to base64 and show image immediately
      const imageData = await processImage(targetFile);
      
      // 4. Determine if this is initial upload or follow-up
      const isInitialUpload = !file; // If no file parameter, it's initial upload
      
      // 5. Show user message immediately ONLY for initial uploads
      // For follow-up messages, the backend will handle user message creation
      if (isInitialUpload) {
        const userMessage = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: 'I have a question about this image. Can you help me understand it?',
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
      
      // 6. Call API (this will show AI thinking animation)
      // Backend processes image and creates session
      // Backend generates marking instructions
      // Creates annotated image
      // AI response appears in chat
      await processImageAPI(imageData, 'auto', 'marking');
      
      // ========================================
      // PHASE 3: Complete
      // ========================================
      
      // 7. Reset state (ready for next interaction)
      reset();
      
      // 8. Clean up
      if (!file) {
        clearFile();
      }
      handleClearPreview();
      
      
    } catch (error) {
      console.error('❌ Error in image analysis:', error);
      handleError(error);
    }
  }, [selectedFile, processImage, processImageAPI, addMessage, clearFile, startProcessing, reset, handleError, handleClearPreview, setPageMode]);

  // Handle follow-up image (legacy compatibility)
  const handleFollowUpImage = useCallback((file) => handleImageAnalysis(file), [handleImageAnalysis]);

  // Handle analyze image (legacy compatibility)
  const handleAnalyzeImage = useCallback(() => {
    return handleImageAnalysis();
  }, [handleImageAnalysis, selectedFile]);

  // Handle send message
  const sendMessage = useCallback(async (message) => {
    // For now, just log the message
  }, []);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <MainLayout
      // Page mode
      pageMode={pageMode}
      
      // Image upload props
      selectedFile={selectedFile}
      previewUrl={previewUrl}
      onFileSelect={handleFileSelect}
      onAnalyzeImage={handleImageAnalysis}
      onClearFile={clearFile}
      selectedModel={'auto'}
      
      // Session props
      currentSession={currentSession}
      chatMessages={chatMessages}
      sessionTitle={sessionTitle}
      isFavorite={isFavorite}
      rating={rating}
      sidebarSessions={[]}
      isLoading={false}
      isProcessing={isProcessing}
      isAIThinking={isProcessing} // Simplified: AI thinking is same as processing
      
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
      chatInput={''}
      setChatInput={() => {}}
      onSendMessage={sendMessage}
      onFollowUpImage={handleFollowUpImage}
      onKeyPress={() => {}}
      onUploadClick={handleFileSelect}
      onClearPreview={handleClearPreview}
    />
  );
};

export default MarkHomeworkPageConsolidated;
