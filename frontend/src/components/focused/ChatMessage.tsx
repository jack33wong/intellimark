/**
 * Focused ChatMessage Component (TypeScript)
 * This is the definitive version with fixes for all rendering and state bugs.
 */
import React, { useCallback, useState } from 'react';
import { Brain } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { 
  isUserMessage, 
  hasImage, 
  getMessageDisplayText,
  getMessageTimestamp
} from '../../utils/messageUtils.js';
import { 
  isAnnotatedImageMessage
} from '../../utils/sessionUtils';
import { useDropdownState } from '../../hooks/useDropdownState';
import ExamPaperTab from '../marking/ExamPaperTab';
import SuggestedFollowUpButtons from '../marking/SuggestedFollowUpButtons';
import ImageModeModal from '../common/ImageModeModal';
import SimpleImageGallery from '../common/SimpleImageGallery';
import { getSessionImages, findImageIndex } from '../../utils/imageCollectionUtils';
import './ChatMessage.css';
import '../common/SimpleImageGallery.css';
import type { UnifiedMessage } from '../../types';


interface ChatMessageProps {
  message: UnifiedMessage;
  onImageLoad?: () => void;
  getImageSrc: (message: UnifiedMessage) => string | null;
  MarkdownMathRenderer: React.ElementType;
  ensureStringContent: (content: any) => string;
  scrollToBottom?: () => void;
  session?: any; // Session data to access isPastPaper
  addMessage?: (message: any) => void; // Function to add messages to chat
  startAIThinking?: (progressData: any, aiMessageId?: string) => void;
}

const ChatMessage: React.FC<ChatMessageProps> = React.memo(({ 
  message, 
  onImageLoad,
  getImageSrc,
  MarkdownMathRenderer,
  ensureStringContent,
  scrollToBottom,
  session,
  addMessage,
  startAIThinking
}) => {
  const [imageError, setImageError] = useState<boolean>(false);
  const [isImageModeOpen, setIsImageModeOpen] = useState<boolean>(false);
  const { getAuthToken } = useAuth();
  
  // Inline function to avoid Jest import issues
  const shouldRenderMessage = (message: UnifiedMessage): boolean => {
    if (message.role === 'user') {
      return true; // Always render user messages
    }
    
    // For assistant messages, check if it's not a ghost message
    if (message.role !== 'assistant') {
      return false;
    }
    
    // Keep assistant messages that have content or are processing
    const hasContent = message.content && message.content.trim() !== '';
    const isProcessing = message.isProcessing === true;
    const hasProgressData = !!message.progressData;
    
    // Filter out empty assistant messages that are not processing
    return hasContent || isProcessing || hasProgressData;
  };
  
  // Use custom hook for dropdown state management
  const { showProgressDetails, toggleDropdown } = useDropdownState(message.id);

  const handleProgressToggle = useCallback(() => {
    toggleDropdown(scrollToBottom);
  }, [toggleDropdown, scrollToBottom]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  const getMultiImageData = useCallback(() => {
    return (message as any)?.imageDataArray || [];
  }, [message]);

  // Helper function to get image source from structured imageDataArray
  const getImageSourceFromArray = useCallback((imageDataArray: any[], index: number) => {
    if (!imageDataArray || !Array.isArray(imageDataArray) || index >= imageDataArray.length) {
      return null;
    }
    const item = imageDataArray[index];
    // Handle both old format (string) and new format (object with url property)
    return typeof item === 'string' ? item : item?.url;
  }, []);


  // Helper function to format file size
  const formatFileSize = useCallback((fileSize: number | string) => {
    if (!fileSize) return 'Unknown size';
    
    // If it's already a formatted string (like "0.78 MB"), return it as-is
    if (typeof fileSize === 'string') {
      return fileSize;
    }
    
    // If it's a number (bytes), format it
    if (fileSize < 1024) return `${fileSize} B`;
    if (fileSize < 1024 * 1024) return `${Math.round(fileSize / 1024)} KB`;
    return `${Math.round(fileSize / (1024 * 1024))} MB`;
  }, []);


  const handleMultiImageClick = useCallback((index: number) => {
    const imageDataArray = getMultiImageData();
    if (imageDataArray.length > 0) {
      // Convert image data array to SessionImage format for ImageModeModal
      const sessionImages = imageDataArray.map((item: any, idx: number) => {
        const src = typeof item === 'string' ? item : item?.url;
        const fileName = typeof item === 'string' ? `File ${idx + 1}` : item?.originalFileName || `File ${idx + 1}`;
        return {
          id: `multi-${message.id}-${idx}`,
          src: src,
          alt: fileName,
          type: 'uploaded' as const
        };
      });
      
      // Open ImageModeModal with the selected image
      setIsImageModeOpen(true);
      // Store the images and initial index for the modal
      (window as any).__currentSessionImages = sessionImages;
      (window as any).__currentImageIndex = index;
    }
  }, [message.id, getMultiImageData]);

  const handleImageClick = useCallback(() => {
    if ((hasImage(message) || (message as any)?.imageDataArray?.length > 0) && !imageError) {
      // For unified pipeline results with imageDataArray, use multi-image click handler
      if ((message as any)?.imageDataArray?.length > 0) {
        handleMultiImageClick(0); // Click on first image
      } else {
        // For single image results, use the original logic
      setIsImageModeOpen(true);
      }
    }
  }, [message, imageError, handleMultiImageClick]);

  const handleFollowUpClick = useCallback(async (suggestion: string, mode: string = 'chat') => {
    try {
      // Mode is now passed directly from SuggestedFollowUpButtons
      
      // Add user message immediately (same as text mode chat)
      if (addMessage) {
        addMessage({
          id: `user-${Date.now()}`,
          role: 'user',
          content: suggestion,
          timestamp: new Date().toISOString(),
          type: 'chat'
        });
      }
      
      // Start AI thinking state (same as text mode chat)
      const textProgressData = {
        isComplete: false,
        currentStepDescription: 'AI is thinking...',
        allSteps: ['AI is thinking...'],
        currentStepIndex: 0,
      };
      
      // Generate a predictable AI message ID
      const aiMessageId = `ai-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Start AI thinking if function is available
      if (startAIThinking) {
        startAIThinking(textProgressData, aiMessageId);
      }
      
      // Send to backend via chat endpoint with mode parameter and source message ID
      const requestBody = {
        message: suggestion,
        sessionId: session?.id,
        model: 'auto',
        mode: mode,
        sourceMessageId: message.id  // Pass the specific message ID that triggered this follow-up
      };
      
      // Get auth token for authentication
      const authToken = await getAuthToken();
      const headers: { 'Content-Type': string; 'Authorization'?: string } = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      
      if (result.success) {
        // Use the standardized completion handler (same as text mode chat)
        const { simpleSessionService } = await import('../../services/markingApiService.js');
        simpleSessionService.handleTextChatComplete(result, 'auto');
      } else {
        console.error('❌ [FOLLOW-UP] Failed:', result.error);
        alert(`Action failed: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ [FOLLOW-UP] Unexpected error:', error);
    }
  }, [session?.id, addMessage, startAIThinking, getAuthToken, message.id]);

  const isUser = isUserMessage(message);
  const content = getMessageDisplayText(message);
  const getOriginalFileName = () => (message as any)?.originalFileName || (message as any)?.fileName || 'PDF';
  const truncateFileName = (fileName: string, maxLength: number = 10) => {
    if (fileName.length <= maxLength) return fileName;
    return fileName.substring(0, maxLength) + '...';
  };
  const isPdfMessage = () => {
    // Check for explicit PDF type first
    if ((message as any)?.originalFileType === 'pdf') {
      
      // Log warning if PDF but no pdfContexts, but don't throw exception
      if (!(message as any)?.pdfContexts || !Array.isArray((message as any).pdfContexts) || (message as any).pdfContexts.length === 0) {
        console.warn(`PDF message detected but pdfContexts is empty! Message: ${message.id}, originalFileType: ${(message as any)?.originalFileType}, pdfContexts: ${JSON.stringify((message as any)?.pdfContexts)}`);
      }
      return true;
    }
    // Check for pdfContexts array
    if ((message as any)?.pdfContexts && Array.isArray((message as any).pdfContexts) && (message as any).pdfContexts.length > 0) {
      return true;
    }
    // Fallback to filename detection
    const name = getOriginalFileName();
    const isPdfByName = typeof name === 'string' && name.toLowerCase().endsWith('.pdf');
    return isPdfByName;
  };

  const isMultiFileMessage = () => {
    // Check for user multi-image uploads
    if ((message as any)?.isMultiImage === true && (message as any)?.fileCount > 1) {
      return true;
    }
    // Check for user messages with imageDataArray (fallback for missing flags)
    if (message.role === 'user' && (message as any)?.imageDataArray && Array.isArray((message as any).imageDataArray) && (message as any).imageDataArray.length > 1) {
      return true;
    }
    // Check for PDF messages with multiple contexts
    if (message.role === 'user' && (message as any)?.pdfContexts && Array.isArray((message as any).pdfContexts) && (message as any).pdfContexts.length > 1) {
      return true;
    }
    // Check for AI response with annotated images array (including single images)
    if (message.role === 'assistant' && (message as any)?.imageDataArray && Array.isArray((message as any).imageDataArray) && (message as any).imageDataArray.length > 0) {
      return true;
    }
    return false;
  };

  // Keep the old function for backward compatibility
  const isMultiImageMessage = () => isMultiFileMessage();




  
  // Check if any message in the session is currently processing
  const isAnyMessageProcessing = session?.messages?.some((msg: any) => msg.isProcessing === true) || false;
  const timestamp = getMessageTimestamp(message);
  const imageSrc = getImageSrc(message);

  // Debug: Print complete message data structure

  // Don't render ghost messages
  if (!shouldRenderMessage(message)) {
    return null;
  }

  return (
    <div 
      className={`chat-message ${isUser ? 'user' : 'assistant'}`}
      data-message-id={message.id}
      aria-roledescription={isUser ? 'user-message' : 'assistant-message'}
    >
      <div className="chat-message-content">
        <div className={`chat-message-bubble`}>
          {!isUser && (
            <div className="assistant-header">
              <Brain size={20} className="assistant-brain-icon" />
              {message.progressData && (
                <div className="thinking-indicator">
                  <div className="progress-main-line">
                    {!message.progressData.isComplete && (
                      <div className="thinking-dots">
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                        <div className="thinking-dot"></div>
                      </div>
                    )}
                    <div className="thinking-text">
                      {message.progressData.isComplete ? 'Show thinking' : (message.progressData.currentStepDescription || 'Processing...')}
                    </div>
                    {message.progressData?.allSteps && message.progressData.allSteps.length > 0 && (
                      <div className="progress-toggle-container">
                                <button
                                  className="progress-toggle-button"
                                  onClick={handleProgressToggle}
                                  style={{ transform: showProgressDetails ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 9l6 6 6-6"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {!isUser && message.detectedQuestion && message.detectedQuestion.found && (
            <ExamPaperTab 
              detectedQuestion={message.detectedQuestion} 
              studentScore={message.studentScore}
            />
          )}
          
                  {showProgressDetails && message.progressData?.allSteps && (
             <div className="progress-details-container">
                <div className="step-list-container">
                  {(message.progressData.allSteps || [])
                    .slice(0, (message.progressData?.currentStepIndex || 0) + 1) // Only show steps up to current
                    .map((step: any, index: number) => {
                      const stepText = typeof step === 'string' ? step : (step.description || 'Step');
                      const currentStepIndex = message.progressData?.currentStepIndex || 0;
                      const isComplete = message.progressData?.isComplete || false;
                      
                      // If process is complete, all steps are completed
                      // Otherwise, step N is completed when currentStepIndex > N (we've moved past step N)
                      const isCompleted = isComplete || index < currentStepIndex;
                      // Step N is current when currentStepIndex === N AND process is not complete
                      const isCurrent = !isComplete && index === currentStepIndex;
                      
                      return (
                        <div key={index} className={`step-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                          <div className="step-indicator">
                            {isCompleted ? '✓' : isCurrent ? '●' : '○'}
                          </div>
                          <div className="step-description">
                            {stepText}
                          </div>
                        </div>
                      );
                  })}
                </div>
             </div>
          )}

          {!isUser && content && ensureStringContent(content).trim() !== '' && (
            <MarkdownMathRenderer 
              content={ensureStringContent(content)}
              className="chat-message-renderer"
            />
          )}
          
          {/* Display multi-image annotated results FIRST (before suggested follow-ups) - only if more than 1 image */}
          {!isUser && isMultiImageMessage() && (message as any)?.imageDataArray && Array.isArray((message as any).imageDataArray) && (message as any).imageDataArray.length > 1 && !isPdfMessage() && (() => {
            return (
              <div className="multi-image-gallery">
                <SimpleImageGallery
                  images={(message as any).imageDataArray}
                  onImageClick={handleMultiImageClick}
                  className="multi-image-gallery"
                />
              </div>
            );
          })()}
          
          {/* Display single annotated image if only 1 image - BEFORE suggested follow-ups */}
          {!isUser && (message as any)?.imageDataArray && Array.isArray((message as any).imageDataArray) && (message as any).imageDataArray.length === 1 && !isPdfMessage() && (
            <div className="homework-annotated-image" onClick={handleImageClick}>
              <img 
                src={getImageSourceFromArray((message as any).imageDataArray, 0) || ''}
                alt="Marked homework"
                className="annotated-image"
                onLoad={onImageLoad}
                onError={handleImageError}
              />
            </div>
          )}
          
          {!isUser && isAnnotatedImageMessage(message) && (hasImage(message) || (message as any)?.imageDataArray?.length > 0) && imageSrc && !imageError && (
            <>
              <div className="homework-annotated-image" onClick={handleImageClick}>
                <img 
                  src={imageSrc}
                  alt="Marked homework"
                  className="annotated-image"
                  onLoad={onImageLoad}
                  onError={handleImageError}
                />
              </div>
            </>
          )}
          
          {/* Show suggested follow-ups for any assistant message with detected question and follow-ups */}
          {!isUser && message.detectedQuestion?.found && message.suggestedFollowUps && message.suggestedFollowUps.length > 0 && (
                <SuggestedFollowUpButtons 
                  suggestions={message.suggestedFollowUps as string[]}
                  onSuggestionClick={handleFollowUpClick}
                  disabled={isAnyMessageProcessing}
                />
          )}
          
          {isUser && content && (
            <div className="message-text">
              {ensureStringContent(content)}
            </div>
          )}
        </div>
        
        {isUser && hasImage(message) && !imageError && (
          <div className="chat-message-image">
            {(() => {
              // BYPASS: Force PDF display for PDF messages
              const isPdf = isPdfMessage();
              if (isPdf && (message as any)?.pdfContexts?.length > 1) {
                return true;
              }
              return isMultiImageMessage();
            })() ? (
              // Check if this is a PDF message - show PDF file cards instead of gallery
              isPdfMessage() ? (
                <div className="pdf-files-container">
                  {/* Handle multiple PDFs from pdfContexts */}
                  {(message as any).pdfContexts?.map((pdfContext: any, index: number) => {
                    const fileName = pdfContext.originalFileName || `PDF ${index + 1}`;
                    const fileSize = formatFileSize(pdfContext.fileSize);

                    return (
                      <div 
                        key={index}
                        className="chat-message-file-card" 
                        role="button" 
                        aria-label="Uploaded PDF"
                        onClick={() => {
                          // Try originalPdfDataUrl first (blob URL), then originalPdfLink (Firebase), then url
                          const pdfUrl = pdfContext.originalPdfDataUrl || pdfContext.originalPdfLink || pdfContext.url;
                          if (pdfUrl) {
                            window.open(pdfUrl, '_blank');
                          }
                        }}
                      >
                        <div className="small-pdf-icon">
                          <svg viewBox="0 0 24 24" className="small-pdf-icon-svg">
                            <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                          </svg>
                        </div>
                        <div className="pdf-file-info">
                          <span className="small-pdf-file-name">
                            {truncateFileName(fileName)}
                          </span>
                          <span className="pdf-file-size">
                            PDF · {fileSize}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Handle single PDF without pdfContexts */}
                  {(!(message as any).pdfContexts || (message as any).pdfContexts.length === 0) && (
                    <div 
                      className="chat-message-file-card" 
                      role="button" 
                      aria-label="Uploaded PDF"
                      onClick={() => {
                        const pdfLink = (message as any)?.originalPdfLink;
                        const pdfDataUrl = (message as any)?.originalPdfDataUrl;
                        
                        if (pdfLink) {
                          window.open(pdfLink, '_blank');
                        } else if (pdfDataUrl) {
                          window.open(pdfDataUrl, '_blank');
                        } else {
                        }
                      }}
                    >
                      <div className="small-pdf-icon">
                        <svg viewBox="0 0 24 24" className="small-pdf-icon-svg">
                          <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                        </svg>
                      </div>
                      <div className="pdf-file-info">
                        <span className="small-pdf-file-name">
                          {truncateFileName(getOriginalFileName())}
                        </span>
                        <span className="pdf-file-size">
                          PDF · {formatFileSize((message as any)?.fileSize || 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                  <SimpleImageGallery
                    images={getMultiImageData()}
                    onImageClick={handleMultiImageClick}
                    className="multi-image-gallery"
                  />
              )
            ) : (
              imageSrc && (
                <div onClick={handleImageClick}>
            <img 
              src={imageSrc}
              alt="Uploaded"
              className="content-image"
              onLoad={onImageLoad}
              onError={handleImageError}
            />
                </div>
              )
            )}
          </div>
        )}
        
        {hasImage(message) && imageError && (
          isPdfMessage() ? (
            <div 
              className="chat-message-file-card" 
              role="button" 
              aria-label="Uploaded PDF"
              onClick={() => {
                const pdfLink = (message as any)?.originalPdfLink;
                const pdfDataUrl = (message as any)?.originalPdfDataUrl;
                
                if (pdfLink) {
                  // For authenticated users - open the stored PDF link
                  window.open(pdfLink, '_blank');
                } else if (pdfDataUrl) {
                  // For unauthenticated users - open the data URL
                  window.open(pdfDataUrl, '_blank');
                } else {
                  console.warn('No PDF link or data URL available for this message');
                }
              }}
            >
              <div className="small-pdf-icon">
                <svg viewBox="0 0 24 24" className="small-pdf-icon-svg">
                  <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
                </svg>
              </div>
              <div className="pdf-file-info">
                <span className="small-pdf-file-name">
                  {truncateFileName(getOriginalFileName())}
                </span>
                <span className="pdf-file-size">
                  PDF · {formatFileSize((message as any)?.fileSize || 0)}
                </span>
              </div>
            </div>
          ) : (
          <div className="chat-message-image-error">
            <span>📷 Image failed to load</span>
            </div>
          )
        )}

        {/* Show a file card for PDFs even if no image is present */}
        {!hasImage(message) && isPdfMessage() && (
          <div 
            className="chat-message-file-card" 
            role="button" 
            aria-label="Uploaded PDF"
            onClick={() => {
              const pdfLink = (message as any)?.originalPdfLink;
              const pdfDataUrl = (message as any)?.originalPdfDataUrl;
              
              if (pdfLink) {
                // For authenticated users - open the stored PDF link
                window.open(pdfLink, '_blank');
              } else if (pdfDataUrl) {
                // For unauthenticated users - open the data URL
                window.open(pdfDataUrl, '_blank');
              } else {
                console.warn('No PDF link or data URL available for this message');
              }
            }}
          >
            <div className="small-pdf-icon">
              <svg viewBox="0 0 24 24" className="small-pdf-icon-svg">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" />
              </svg>
            </div>
            <div className="pdf-file-info">
              <span className="small-pdf-file-name">
                {truncateFileName(getOriginalFileName())}
              </span>
              <span className="pdf-file-size">
                PDF · {formatFileSize((message as any)?.fileSize || 0)}
              </span>
            </div>
          </div>
        )}
        
        {timestamp && (isUser || !message.isProcessing) && (
          <div className="chat-message-timestamp">
            {timestamp}
          </div>
        )}
      </div>

      {/* Image Mode Modal */}
      {isImageModeOpen && (
        <ImageModeModal
          isOpen={isImageModeOpen}
          onClose={() => setIsImageModeOpen(false)}
          images={
            isMultiImageMessage() 
              ? (window as any).__currentSessionImages || []
              : session ? getSessionImages(session) : []
          }
          initialImageIndex={
            isMultiImageMessage()
              ? (window as any).__currentImageIndex || 0
              : session ? findImageIndex(getSessionImages(session), message.id) : 0
          }
        />
      )}
    </div>
  );
});

export default ChatMessage;

