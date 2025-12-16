/**
 * Focused ChatMessage Component (TypeScript)
 * This is the definitive version with fixes for all rendering and state bugs.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './ChatMessage.css';
import YourWorkSection from './YourWorkSection';
import { Brain } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
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
import QuestionNavigator from '../marking/QuestionNavigator';


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
  selectedModel?: string; // Selected AI model for follow-up requests
  onEnterSplitMode?: (images: any[], index: number) => void; // Handler for Split Mode
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
  startAIThinking,
  selectedModel = 'gemini-2.0-flash', // Default to Gemini 2.0 Flash
  onEnterSplitMode
}) => {
  const [imageError, setImageError] = useState<boolean>(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isImageModeOpen, setIsImageModeOpen] = useState<boolean>(false);
  const { getAuthToken, user } = useAuth();
  const { activeQuestionId, setActiveQuestionId, setQuestionTableVisibility } = useMarkingPage();
  const tableObserverRef = useRef<HTMLDivElement | null>(null);

  // Observe table visibility to show/hide ribbon
  useEffect(() => {
    const observerTarget = tableObserverRef.current;
    if (!observerTarget) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setQuestionTableVisibility(entry.isIntersecting);
        });
      },
      { threshold: 0.1, rootMargin: '-50px 0px 0px 0px' }
    );

    observer.observe(observerTarget);
    return () => observer.disconnect();
  }, [setQuestionTableVisibility]);


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

    // Check if this is a PDF message - if so, open the PDF from pdfContexts instead of image
    if ((message as any)?.originalFileType === 'pdf' && (message as any)?.pdfContexts?.length > 0) {
      const pdfContexts = (message as any).pdfContexts;
      const pdfContext = pdfContexts[index];
      if (pdfContext && pdfContext.url) {
        window.open(pdfContext.url, '_blank');
        return;
      }
    }

    if (imageDataArray.length > 0) {
      // Logic update: Ensure we use GLOBAL session images if available, so badges and navigation (Page 1..N) work correctly.
      if (onEnterSplitMode && session) {
        try {
          // 1. Get all session images (Pages 1..N)
          const sessionImages = getSessionImages(session);

          // 2. Find where THIS message's images start in the global list
          // We look for the first image that has this message ID
          // Note: findImageIndex finds the FIRST match.
          const startOffset = findImageIndex(sessionImages, message.id);

          if (startOffset >= 0) {
            // 3. The clicked image is at startOffset + index (clicked index in grid)
            const targetIndex = startOffset + index;

            // 4. Enter split mode with FULL context
            onEnterSplitMode(sessionImages, targetIndex);
            return;
          }
        } catch (e) {
          console.error("Error mapping grid image to session:", e);
        }
      }

      // Fallback: Use local images if session mapping failed
      // Convert image data array to SessionImage format
      const sessionImages = imageDataArray.map((item: any, idx: number) => {
        const src = typeof item === 'string' ? item : item?.url;
        const originalFileName = typeof item === 'string' ? `File ${idx + 1}` : item?.originalFileName || `File ${idx + 1}`;
        const fileName = `annotated-${originalFileName}`;

        return {
          id: `multi-${message.id}-${idx}`,
          src: src,
          filename: fileName,
          alt: fileName,
          type: 'uploaded' as const
        };
      });

      if (onEnterSplitMode) {
        // This path uses LOCAL images (badges might be wrong/missing if they depend on global index)
        onEnterSplitMode(sessionImages, index);
      } else {
        // Fallback to local modal
        setIsImageModeOpen(true);
        (window as any).__currentSessionImages = sessionImages;
        (window as any).__currentImageIndex = index;
      }
    }
  }, [message.id, getMultiImageData, message, onEnterSplitMode]);


  const handleImageClick = useCallback(() => {
    if ((hasImage(message) || (message as any)?.imageDataArray?.length > 0) && !imageError) {
      // For unified pipeline results with imageDataArray, use multi-image click handler
      if ((message as any)?.imageDataArray?.length > 0) {
        handleMultiImageClick(0); // Click on first image
      } else {
        // For single image results
        if (onEnterSplitMode && session) {
          // Use session-wide images for navigation context
          const sessionImages = getSessionImages(session);
          const index = findImageIndex(sessionImages, message.id);
          onEnterSplitMode(sessionImages, index >= 0 ? index : 0);
        } else {
          // Fallback to local modal
          setIsImageModeOpen(true);
        }
      }
    }

  }, [message, imageError, handleMultiImageClick, onEnterSplitMode, session]);

  // Smart Navigation Handler
  const handleSmartNavigation = useCallback((questionNumber: string, sourceImageIndex: number) => {
    // Set active question for highlighting

    setActiveQuestionId(questionNumber);


    // 1. Enter Split Mode with specific image
    // Prefer session-level images to ensure we have the full document context (Pages 1-N)
    // This ensures sourceImageIndex (which is usually a page index) maps correctly.

    let targetImages: any[] = [];

    if (session) {
      targetImages = getSessionImages(session);
    } else {
      // Fallback to message images if session not available (rare)
      const images = (message as any)?.imageDataArray || [];
      if (images.length > 0) {
        targetImages = images.map((item: any, idx: number) => {
          const src = typeof item === 'string' ? item : item?.url;
          const originalFileName = typeof item === 'string' ? `File ${idx + 1}` : item?.originalFileName || `File ${idx + 1}`;
          const fileName = `annotated-${originalFileName}`;
          return {
            id: `multi-${message.id}-${idx}`,
            src: src,
            filename: fileName,
            alt: fileName,
            type: 'uploaded' as const
          };
        });
      }
    }

    if (targetImages.length > 0) {
      if (onEnterSplitMode) {
        // Ensure index is within bounds
        const safeIndex = Math.min(Math.max(0, sourceImageIndex), targetImages.length - 1);
        onEnterSplitMode(targetImages, safeIndex);
      } else {
        console.error('[SmartNav] onEnterSplitMode prop is missing!');
      }
    } else {
      console.error('[SmartNav] No target images found for navigation');
    }

    // 2. Scroll Chat to Question Header
    setTimeout(() => {
      const elementId = `question-${questionNumber}`;
      let attempts = 0;
      const maxAttempts = 10;

      const attemptScroll = () => {
        const el = document.getElementById(elementId);
        if (el) {
          // Find the chat container
          const chatContainer = document.querySelector('.chat-container') as HTMLElement;
          if (chatContainer) {
            const elRect = el.getBoundingClientRect();
            const containerRect = chatContainer.getBoundingClientRect();
            const offset = 100;
            const targetScrollTop = chatContainer.scrollTop + (elRect.top - containerRect.top) - offset;
            // Use smooth scroll like scrollToBottom
            chatContainer.scrollTo({
              top: targetScrollTop,
              behavior: 'smooth'
            });
          }
        } else {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(attemptScroll, 100);
          }
        }
      };

      attemptScroll();
    }, 600);
  }, [message, onEnterSplitMode, session]);

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
      // For unauthenticated users, pass detectedQuestion directly since it's not in Firestore
      const requestBody: any = {
        message: suggestion,
        sessionId: session?.id,
        model: selectedModel || 'gemini-2.0-flash', // Use selected model from props, fallback to gemini-2.0-flash
        mode: mode,
        sourceMessageId: message.id  // Pass the specific message ID that triggered this follow-up
      };

      // Only send detectedQuestion for unauthenticated users (authenticated users have it in Firestore)
      if (!user && message.detectedQuestion) {
        requestBody.detectedQuestion = message.detectedQuestion;
      }

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
        simpleSessionService.handleTextChatComplete(result, selectedModel || 'gemini-2.0-flash');
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
                            <path d="M6 9l6 6 6-6" />
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
              grade={(message as any).grade || null}
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

          {!isUser && content && ensureStringContent(content).trim() !== '' && (() => {
            // Preprocess content to:
            // 1. Remove sub-question parts from headers (e.g., "Question 8(a, b, c)" → "Question 8")
            // 2. Calculate total marks from [B2], [M1], [A1] tags and add to header in green
            let processedContent = ensureStringContent(content);


            // Split content by question headers to process each question separately
            const questionSections = processedContent.split(/^(###\s+Question\s+\d+[^\n]*)/gim);

            for (let i = 1; i < questionSections.length; i += 2) {
              const header = questionSections[i];
              const questionContent = questionSections[i + 1] || '';

              // Extract all mark tags like [B2], [M1], [A1], etc.
              const markMatches = questionContent.match(/\[([A-Z])(\d+)\]/g) || [];
              let totalMarks = 0;

              markMatches.forEach(tag => {
                const match = tag.match(/\[([A-Z])(\d+)\]/);
                if (match) {
                  totalMarks += parseInt(match[2], 10);
                }
              });

              // Clean the header: remove (a, b, c) suffixes
              let cleanedHeader = header.replace(/\s*\([^)]+\)/, '');

              // Add marks if found
              if (totalMarks > 0) {
                cleanedHeader += ` <span class="question-marks">(${totalMarks} ${totalMarks === 1 ? 'mark' : 'marks'})</span>`;
              }

              questionSections[i] = cleanedHeader;
            }

            processedContent = questionSections.join('');

            // Callback ref to inject IDs into question headers after render
            const handleContentRef = (element: HTMLDivElement | null) => {
              if (!element) return;

              // Find all question headers in the rendered DOM
              const headers = element.querySelectorAll('p strong, h3');

              headers.forEach((header) => {
                const text = header.textContent || '';
                const match = text.match(/Question\s+(\d+)/i);

                if (match) {
                  const questionNum = match[1];
                  const questionId = `question-${questionNum}`;

                  // Add ID to the parent element (p or h3)
                  const parent = header.parentElement;
                  if (parent && !parent.id) {
                    parent.id = questionId;
                    parent.style.scrollMarginTop = '100px';
                  }
                }
              });
            };

            // Extract :::your-work section only
            const yourWorkMatch = processedContent.match(/(:::your-work[\s\S]*?:::)/);

            if (yourWorkMatch) {
              // Split content: before, yourWork, after
              const parts = processedContent.split(/(:::your-work[\s\S]*?:::)/);

              return (
                <div ref={handleContentRef}>
                  {parts.map((part, idx) => {
                    if (part.startsWith(':::your-work')) {
                      return <YourWorkSection key={idx} content={part} />;
                    } else if (part.trim()) {
                      return (
                        <MarkdownMathRenderer
                          key={idx}
                          content={part}
                          className="chat-message-renderer"
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              );
            }

            // Just render as markdown - no custom components
            return (
              <div ref={handleContentRef}>
                <MarkdownMathRenderer
                  content={processedContent}
                  className="chat-message-renderer"
                />
              </div>
            );
          })()}

          {/* Display multi-image annotated results + Navigator side-by-sides */}
          {!isUser && isMultiImageMessage() && (message as any)?.imageDataArray && Array.isArray((message as any).imageDataArray) && (message as any).imageDataArray.length > 1 && !isPdfMessage() && (() => {
            return (
              <div className="gallery-navigator-container" style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                <div className="gallery-side" style={{ flex: '1', minWidth: '0' }}>
                  <SimpleImageGallery
                    images={(message as any).imageDataArray}
                    onImageClick={handleMultiImageClick}
                    className="multi-image-gallery"
                  />
                </div>
                {message.detectedQuestion && message.detectedQuestion.found && (
                  <div className="navigator-side" ref={tableObserverRef}>
                    <QuestionNavigator
                      detectedQuestion={message.detectedQuestion}
                      markingContext={(message as any).markingContext}
                      studentScore={message.studentScore}
                      mode="table"
                      idPrefix={`table-${message.id}`}
                      onNavigate={handleSmartNavigation}
                      activeQuestionId={activeQuestionId}
                    />
                  </div>
                )}
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
              // BYPASS: Force PDF display for PDF messages (single or multiple)
              const isPdf = isPdfMessage();
              if (isPdf && (message as any)?.pdfContexts && (message as any).pdfContexts.length >= 1) {
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
                          // Use simplified structure: pdfContext.url (consolidates originalPdfDataUrl and originalPdfLink)
                          const pdfUrl = pdfContext.url;
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

