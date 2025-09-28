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

  // Scroll button state - declare early to avoid hoisting issues
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasNewResponse, setHasNewResponse] = useState(false);
  const [newResponseMessageId, setNewResponseMessageId] = useState(null);

  // Auto scroll functionality
  const {
    containerRef: chatContainerRef,
    scrollToBottom,
    smartScrollToBottom,
    handleImageLoad,
    handleScroll
  } = useAutoScroll(chatMessages);

  // Auto-scroll for text-only submissions - ensure it works for both Enter key and Send button
  useEffect(() => {
    if (isTextOnlySubmission && chatMessages.length > 0) {
      // Small delay to ensure the message is rendered
      setTimeout(() => {
        scrollToBottom();
      }, 100);
    }
  }, [isTextOnlySubmission, chatMessages.length, scrollToBottom]);

  // Force auto-scroll when new messages are added (for both Enter key and Send button)
  useEffect(() => {
    if (chatMessages.length > 0) {
      // Check if this is a new message (not just a re-render)
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage && lastMessage.timestamp) {
        const messageTime = new Date(lastMessage.timestamp).getTime();
        const now = Date.now();
        // If message is very recent (within last 2 seconds), smart scroll
        if (now - messageTime < 2000) {
          setTimeout(() => {
            smartScrollToBottom(hasNewResponse);
          }, 50);
        }
      }
    }
  }, [chatMessages.length, smartScrollToBottom, hasNewResponse]);

  // Auto-scroll when AI thinking stops (AI response completed)
  useEffect(() => {
    if (!isAIThinking && chatMessages.length > 0) {
      // Check if this is a new AI response
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content && !lastMessage.isProcessing) {
        // This is a completed AI response - show new response button instead of auto-scroll
        setHasNewResponse(true);
        setNewResponseMessageId(lastMessage.id || lastMessage.timestamp);
      } else {
        // Not a new AI response, use smart scroll
        setTimeout(() => {
          smartScrollToBottom(false); // Pass false since we know there's no new response
        }, 100);
      }
    }
  }, [isAIThinking, chatMessages.length, smartScrollToBottom]);

  // Auto-scroll when message content changes (for AI response updates)
  useEffect(() => {
    if (chatMessages.length > 0) {
      // Check if the last message is an assistant message with content
      const lastMessage = chatMessages[chatMessages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant' && lastMessage.content && !lastMessage.isProcessing) {
        // This is a completed AI response, but don't auto-scroll if new response button is active
        if (!hasNewResponse) {
          setTimeout(() => {
            smartScrollToBottom(false); // Pass false since we're checking hasNewResponse above
          }, 50);
        }
      }
    }
  }, [chatMessages, smartScrollToBottom, hasNewResponse]);


  // Scroll to new response function
  const scrollToNewResponse = useCallback(() => {
    if (chatContainerRef.current && newResponseMessageId) {
      // Find the new response message element
      const messageElements = chatContainerRef.current.querySelectorAll('.chat-message[data-message-id]');
      let newResponseElement = null;
      
      for (let element of messageElements) {
        const messageId = element.getAttribute('data-message-id');
        if (messageId === newResponseMessageId.toString()) {
          newResponseElement = element;
          break;
        }
      }
      
      if (newResponseElement) {
        // Scroll to the top of the new response minus 100px
        const elementTop = newResponseElement.offsetTop;
        const scrollPosition = Math.max(0, elementTop - 100);
        chatContainerRef.current.scrollTop = scrollPosition;
        
        // Clear new response state
        setHasNewResponse(false);
        setNewResponseMessageId(null);
      } else {
        // Fallback to scroll to bottom
        scrollToBottom();
        setHasNewResponse(false);
        setNewResponseMessageId(null);
      }
    }
  }, [chatContainerRef, newResponseMessageId, scrollToBottom, hasNewResponse]);
  
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
        handleScroll((shouldShow) => {
          setShowScrollButton(shouldShow);
          
          // If user scrolls near bottom and new response button is active, clear it
          if (hasNewResponse && !shouldShow) {
            setHasNewResponse(false);
            setNewResponseMessageId(null);
          }
        });
      };
      
      container.addEventListener('scroll', handleScrollEvent);
      
      // Initial check to set scroll button visibility
      handleScrollEvent();
      
      return () => {
        container.removeEventListener('scroll', handleScrollEvent);
      };
    }
  }, [chatContainerRef, handleScroll, chatMessages.length, hasNewResponse]);

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
          
          // OPTIMISTIC UPDATE: Update UI immediately for instant feedback
          const updatedSession = {
            ...currentSession,
            favorite: newFavoriteStatus,
            updatedAt: new Date().toISOString()
          };
          
          // Update the service state immediately (optimistic update)
          simpleSessionService.setCurrentSession(updatedSession);
          simpleSessionService.updateSidebarSession(updatedSession);
          
          // Trigger event for real-time updates
          simpleSessionService.triggerSessionUpdate(updatedSession);
          
          try {
            // Update in backend (async, don't wait for it)
            simpleSessionService.updateSession(currentSession.id, {
              favorite: newFavoriteStatus,
              updatedAt: new Date().toISOString()
            }).catch(error => {
              console.error('❌ Failed to update favorite status in backend:', error);
              // Optionally revert the optimistic update on error
              // For now, we'll keep the optimistic update even if backend fails
            });
          } catch (error) {
            console.error('❌ Failed to update favorite status:', error);
          }
        }
      }}
      onRatingChange={async (rating) => {
        if (currentSession) {
          // OPTIMISTIC UPDATE: Update UI immediately for instant feedback
          const updatedSession = {
            ...currentSession,
            rating: rating,
            updatedAt: new Date().toISOString()
          };
          
          // Update the service state immediately (optimistic update)
          simpleSessionService.setCurrentSession(updatedSession);
          simpleSessionService.updateSidebarSession(updatedSession);
          
          // Trigger event for real-time updates
          simpleSessionService.triggerSessionUpdate(updatedSession);
          
          try {
            // Update in backend (async, don't wait for it)
            simpleSessionService.updateSession(currentSession.id, {
              rating: rating,
              updatedAt: new Date().toISOString()
            }).catch(error => {
              console.error('❌ Failed to update rating in backend:', error);
              // Optionally revert the optimistic update on error
              // For now, we'll keep the optimistic update even if backend fails
            });
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
      hasNewResponse={hasNewResponse}
      scrollToNewResponse={scrollToNewResponse}
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
