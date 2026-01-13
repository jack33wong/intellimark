/**
 * Focused ChatMessage Component (TypeScript)
 * This is the definitive version with fixes for all rendering and state bugs.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './ChatMessage.css';
import YourWorkSection from './YourWorkSection';
import { Brain, ChevronDown, ChevronUp } from 'lucide-react';
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
  onEnterSplitMode?: (images: any[], index: number, isGlobal?: boolean) => void; // Handler for Split Mode
  onNavigate?: (qNum: string | number, imgIdx: number, source: 'ribbon' | 'image' | 'scroll') => void;
  isSyncingRef?: React.MutableRefObject<boolean>;
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
  onEnterSplitMode,
  onNavigate,
  isSyncingRef
}) => {
  const [imageError, setImageError] = useState<boolean>(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isImageModeOpen, setIsImageModeOpen] = useState<boolean>(false);
  const { getAuthToken, user } = useAuth();
  const { activeQuestionId, setActiveQuestionId, isContextFilterActive, isNegative, setShowCreditsModal } = useMarkingPage();

  // Inline function to avoid Jest import issues
  const shouldRenderMessage = (message: UnifiedMessage): boolean => {
    if (message.role === 'user') {
      return true; // Always render user messages
    }
    if (message.role !== 'assistant') {
      return false;
    }
    const hasContent = message.content && message.content.trim() !== '';
    const isProcessing = message.isProcessing === true;
    const hasProgressData = !!message.progressData;
    return hasContent || isProcessing || hasProgressData;
  };

  const { showProgressDetails, toggleDropdown } = useDropdownState(message.id);

  const handleProgressToggle = useCallback(() => {
    toggleDropdown(scrollToBottom);
  }, [toggleDropdown, scrollToBottom]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  const getMultiImageData = useCallback(() => {
    const imageDataArray = (message as any)?.imageDataArray;
    if (imageDataArray && Array.isArray(imageDataArray) && imageDataArray.length > 0) {
      // Fix for legacy data: if single item has no URL but message has imageLink, use it
      if (imageDataArray.length === 1 && !imageDataArray[0]?.url && (message as any)?.imageLink) {
        return [{
          ...imageDataArray[0],
          url: (message as any).imageLink
        }];
      }
      return imageDataArray;
    }
    // Fallback for legacy/single image messages
    if ((message as any)?.imageLink) {
      return [(message as any).imageLink];
    }
    if ((message as any)?.imageData) {
      return [(message as any).imageData];
    }
    return [];
  }, [message]);

  const getImageSourceFromArray = useCallback((imageDataArray: any[], index: number) => {
    if (!imageDataArray || !Array.isArray(imageDataArray) || index >= imageDataArray.length) {
      return null;
    }
    const item = imageDataArray[index];
    // Prioritize item.url, then item as string, then fallback to message.imageLink if single item and url missing
    if (typeof item === 'string') return item;
    if (item?.url) return item.url;

    // Fallback: if this is the only item and it has no URL, check if message has imageLink
    if (imageDataArray.length === 1 && (message as any)?.imageLink) {
      return (message as any).imageLink;
    }

    return null;
  }, [message]);

  const formatFileSize = useCallback((fileSize: number | string) => {
    if (!fileSize) return 'Unknown size';
    if (typeof fileSize === 'string') return fileSize;
    if (fileSize < 1024) return `${fileSize} B`;
    if (fileSize < 1024 * 1024) return `${Math.round(fileSize / 1024)} KB`;
    return `${Math.round(fileSize / (1024 * 1024))} MB`;
  }, []);

  const handleMultiImageClick = useCallback((index: number) => {
    const imageDataArray = getMultiImageData();
    if ((message as any)?.originalFileType === 'pdf' && (message as any)?.pdfContexts?.length > 0) {
      const pdfContext = (message as any).pdfContexts[index];
      if (pdfContext?.url) {
        window.open(pdfContext.url, '_blank');
        return;
      }
    }

    if (imageDataArray.length > 0) {
      const isUserUpload = message.role === 'user';
      const sessionImages = imageDataArray.map((item: any, idx: number) => {
        const src = typeof item === 'string' ? item : item?.url;
        const originalFileName = typeof item === 'string' ? `File ${idx + 1}` : item?.originalFileName || `File ${idx + 1}`;

        // Remove 'annotated-' prefix for user uploads
        const prefix = isUserUpload ? '' : 'annotated-';
        const typeLabel = isUserUpload ? 'Original' : 'Annotated';

        return {
          id: `multi-${message.id}-${idx}`,
          src: src,
          filename: `${prefix}${originalFileName}`,
          alt: `${typeLabel} ${originalFileName}`,
          type: 'uploaded' as const,
          messageId: message.id,
          messageRole: message.role,
          messageType: message.type || 'unknown'
        };
      });

      if (onEnterSplitMode) {
        // Pass false for isGlobal to indicate this is a message-specific view
        onEnterSplitMode(sessionImages, index, false);
      } else {
        setIsImageModeOpen(true);
        (window as any).__currentSessionImages = sessionImages;
        (window as any).__currentImageIndex = index;
      }
    }
  }, [message.id, getMultiImageData, message, onEnterSplitMode, session]);

  const handleImageClick = useCallback(() => {
    if ((hasImage(message) || (message as any)?.imageDataArray?.length > 0) && !imageError) {
      if ((message as any)?.imageDataArray?.length > 0) {
        handleMultiImageClick(0);
      } else {
        const src = getImageSrc(message);
        if (src) {
          const isUserUpload = message.role === 'user';
          const prefix = isUserUpload ? '' : 'annotated-';
          const originalFileName = (message as any)?.originalFileName || `image-${message.id}`;

          const sessionImages = [{
            id: `img-${message.id}`,
            src,
            filename: `${prefix}${originalFileName}`,
            alt: `Image from ${message.role}`,
            type: 'uploaded' as const,
            messageId: message.id,
            messageRole: message.role,
            messageType: message.type || 'unknown'
          }];

          if (onEnterSplitMode) {
            onEnterSplitMode(sessionImages, 0, false);
          } else {
            setIsImageModeOpen(true);
            (window as any).__currentSessionImages = sessionImages;
            (window as any).__currentImageIndex = 0;
          }
        }
      }
    }
  }, [message, imageError, handleMultiImageClick, onEnterSplitMode, session]);

  const handleSmartNavigation = useCallback((questionNumber: string, sourceImageIndex: number) => {
    if (onNavigate) {
      onNavigate(questionNumber, sourceImageIndex, 'ribbon'); // Treat as explicit jump
      return;
    }

    setActiveQuestionId(questionNumber);
    let targetImages: any[] = [];
    if (session) {
      targetImages = getSessionImages(session);
    } else {
      const images = (message as any)?.imageDataArray || [];
      targetImages = images.map((item: any, idx: number) => ({
        id: `multi-${message.id}-${idx}`,
        src: typeof item === 'string' ? item : item?.url,
        filename: `annotated-${idx + 1}`,
        type: 'uploaded' as const
      }));
    }

    if (targetImages.length > 0 && onEnterSplitMode) {
      const safeIndex = Math.min(Math.max(0, sourceImageIndex), targetImages.length - 1);
      onEnterSplitMode(targetImages, safeIndex);
    }

    setTimeout(() => {
      const el = document.getElementById(`question-${questionNumber}`);
      if (el) {
        // Native scroll with the CSS/inline scroll-margin-top handles the offset
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }, [session, onEnterSplitMode, setActiveQuestionId, message, onNavigate]);

  const handleFollowUpClick = useCallback(async (suggestion: string, mode: string = 'chat') => {
    // Credit check
    if (user && isNegative) {
      setShowCreditsModal(true);
      return;
    }

    try {
      if (addMessage) {
        addMessage({
          id: `user-${Date.now()}`,
          role: 'user',
          content: suggestion,
          timestamp: new Date().toISOString(),
          type: 'chat',
          contextQuestionId: message.contextQuestionId
        });
      }

      if (startAIThinking) {
        startAIThinking({
          isComplete: false,
          currentStepDescription: 'AI is thinking...',
          allSteps: ['AI is thinking...'],
          currentStepIndex: 0,
        }, `ai-${Date.now()}`);
      }

      const requestBody: any = {
        message: suggestion,
        sessionId: session?.id,
        model: selectedModel || 'gemini-2.0-flash',
        mode: mode,
        sourceMessageId: message.id,
        contextQuestionId: message.contextQuestionId
      };

      if (!user && message.detectedQuestion) {
        requestBody.detectedQuestion = message.detectedQuestion;
      }

      const authToken = await getAuthToken();
      const response = await fetch('/api/messages/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify(requestBody)
      });

      const result = await response.json();
      if (result.success) {
        const { simpleSessionService } = await import('../../services/markingApiService.js');
        simpleSessionService.handleTextChatComplete(result, selectedModel || 'gemini-2.0-flash');
      }
    } catch (error) {
      console.error('❌ [FOLLOW-UP] Unexpected error:', error);
    }
  }, [session?.id, addMessage, startAIThinking, getAuthToken, message.id, selectedModel, user, message.detectedQuestion, message.contextQuestionId]);

  const isUser = isUserMessage(message);
  const content = getMessageDisplayText(message);
  const getOriginalFileName = () => (message as any)?.originalFileName || (message as any)?.fileName || 'PDF';
  const truncateFileName = (fileName: string, maxLength: number = 10) => {
    if (fileName.length <= maxLength) return fileName;
    return fileName.substring(0, maxLength) + '...';
  };

  const isPdfMessage = () => {
    if ((message as any)?.originalFileType === 'pdf') return true;
    if ((message as any)?.pdfContexts?.length > 0) return true;
    const name = getOriginalFileName();
    return typeof name === 'string' && name.toLowerCase().endsWith('.pdf');
  };

  const isMultiFileMessage = () => {
    if ((message as any)?.isMultiImage === true && (message as any)?.fileCount > 1) return true;
    if (message.role === 'user' && (message as any)?.imageDataArray?.length > 1) return true;
    if (message.role === 'user' && (message as any)?.pdfContexts?.length > 1) return true;
    if (message.role === 'assistant' && (message as any)?.imageDataArray?.length > 0) {
      // Don't treat as multi-image message if it's still processing (we show skeletons instead)
      if (message.isProcessing) return false;
      return true;
    }
    return false;
  };

  const isMultiImageMessage = () => isMultiFileMessage();
  const isAnyMessageProcessing = session?.messages?.some((msg: any) => msg.isProcessing === true) || false;
  const timestamp = getMessageTimestamp(message);
  const imageSrc = getImageSrc(message);

  if (!shouldRenderMessage(message)) return null;

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'} ${message.type === 'question_response' ? 'question-mode-response' : ''}`} data-message-id={message.id}>
      <div className="chat-message-content">

        <div className="chat-message-bubble">
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
                    <div className="thinking-text" onClick={handleProgressToggle}>
                      {message.progressData.isComplete ? 'Show thinking' : (message.progressData.currentStepDescription || 'Processing...')}
                    </div>
                    <button className="progress-toggle-button" onClick={handleProgressToggle}>
                      {showProgressDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showProgressDetails && message.progressData?.allSteps && (
            <div className="progress-details-container">
              <div className="step-list-container">
                {message.progressData.allSteps.slice(0, (message.progressData.currentStepIndex || 0) + 1).map((step: any, index: number) => {
                  const stepText = typeof step === 'string' ? step : (step.description || 'Step');
                  const isCompleted = message.progressData!.isComplete || index < message.progressData!.currentStepIndex!;
                  const isCurrent = !message.progressData!.isComplete && index === message.progressData!.currentStepIndex;
                  return (
                    <div key={index} className={`step-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                      <div className="step-indicator">{isCompleted ? '✓' : isCurrent ? '●' : '○'}</div>
                      <div className="step-description">{stepText}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isUser && content && ensureStringContent(content).trim() !== '' && (() => {
            let processedContent = ensureStringContent(content);
            const questionSections = processedContent.split(/^(###\s+Question\s+\d+[^\n]*)/gim);

            for (let i = 1; i < questionSections.length; i += 2) {
              const header = questionSections[i];
              const questionContent = questionSections[i + 1] || '';
              const markMatches = questionContent.match(/\[([A-Z])(\d+)\]/g) || [];
              let totalMarks = 0;

              // PRIORITY: Use metadata from backend if available (most accurate)
              if (message.detectedQuestion) {
                // Try individual question marks first, then total marks
                // Check if this specific question matches one in the detectedQuestion list
                const qNumMatch = header.match(/Question\s+(\d+[a-z]*)/i);
                if (qNumMatch && message.detectedQuestion.examPapers) { // Check examPapers instead of questions
                  // Flatten questions from all exam papers to find the match
                  const allQuestions = message.detectedQuestion.examPapers.flatMap((ep: any) => ep.questions || []);
                  const matchedQ = allQuestions.find((q: any) => q.questionNumber === qNumMatch[1]);
                  if (matchedQ) {
                    totalMarks = matchedQ.marks;
                  }
                }

                // Fallback to totalMarks if 0 or not found
                if (totalMarks === 0 && message.detectedQuestion.totalMarks) {
                  totalMarks = message.detectedQuestion.totalMarks;
                }
              }

              // Fallback: Calculate from regex tags [M1], [A1] only if metadata missing
              if (totalMarks === 0) {
                markMatches.forEach(tag => {
                  const match = tag.match(/\[([A-Z])(\d+)\]/);
                  if (match) totalMarks += parseInt(match[2], 10);
                });
              }

              let cleanedHeader = header.replace(/\s*\([^)]+\)/, '');
              if (totalMarks > 0) {
                cleanedHeader += ` <span class="question-marks">(${totalMarks} ${totalMarks === 1 ? 'mark' : 'marks'})</span>`;
              }
              questionSections[i] = cleanedHeader;
            }
            processedContent = questionSections.join('');

            const handleContentRef = (element: HTMLDivElement | null) => {
              if (!element) return;
              const headers = element.querySelectorAll('p strong, h3, h2, h4, strong');
              headers.forEach((header) => {
                const text = header.textContent || '';
                const match = text.match(/Question\s+(\d+[a-z]*)/i);
                if (match) {
                  const targetElement = (header.tagName === 'STRONG' && header.parentElement?.tagName === 'P')
                    ? header.parentElement
                    : (header as HTMLElement);
                  if (targetElement) {
                    const qNum = match[1].toLowerCase();
                    targetElement.id = `question-${qNum}`;
                    targetElement.style.scrollMarginTop = '120px';
                    targetElement.style.cursor = 'pointer';
                    targetElement.classList.add('clickable-question-header');
                  }
                }
              });

              // Add a click listener to the entire content block to catch links and headers
              const handleContainerClick = (e: MouseEvent) => {
                const target = e.target as HTMLElement;

                // 1. Handle Anchor Links (e.g. [Question 1](#question-1))
                const link = target.closest('a');
                if (link && link.getAttribute('href')?.startsWith('#question-')) {
                  e.preventDefault();
                  const qNum = link.getAttribute('href')!.replace('#question-', '');
                  onNavigate?.(qNum, -1, 'ribbon');
                  return;
                }

                // 2. Handle Question Headers (the ones we just tagged)
                const header = target.closest('.clickable-question-header') as HTMLElement;
                if (header && header.id.startsWith('question-')) {
                  const qNum = header.id.replace('question-', '');
                  onNavigate?.(qNum, -1, 'ribbon');
                }
              };

              element.onclick = handleContainerClick;
            };

            return (
              <div ref={handleContentRef}>
                {/* Render overall performance summary if available */}
                {(message as any).performanceSummary && (
                  <div className="ai-performance-summary">
                    <div className="ai-performance-summary-content">
                      {(message as any).performanceSummary}
                    </div>
                    <hr className="summary-separator" />
                  </div>
                )}
                {/* Render main assistant content (Unified) */}
                <MarkdownMathRenderer
                  content={processedContent}
                  className="chat-message-renderer"
                  YourWorkSection={YourWorkSection}
                />
              </div>
            );
          })()}

          {/* Processing Skeletons - ONLY show if no real images/content yet */}
          {message.isProcessing &&
            !message.progressData?.isComplete &&
            (message as any).imageDataArray?.length > 0 &&
            !content &&
            !isAnnotatedImageMessage(message) && (
              <div className="skeleton-gallery-wrapper">
                <div className="skeleton-gallery thumbnail-horizontal">
                  {(message as any).imageDataArray.map((imgItem: any, idx: number) => {
                    const src = typeof imgItem === 'string' ? imgItem : imgItem?.url;
                    return (
                      <div key={idx} className="skeleton-item">
                        {src ? (
                          <img src={src} alt={`Processing page ${idx + 1}`} className="skeleton-image-preview" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                        ) : (
                          <div className="skeleton-shimmer"></div>
                        )}
                        <div className="skeleton-overlay">
                          <span className="skeleton-label">Analyzing Page {idx + 1}...</span>
                        </div>
                        {src && <div className="skeleton-shimmer" style={{ opacity: 0.3 }}></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {/* Galleries and Images - Only show when NOT processing/thinking (skeletons show then) */}
          {!isUser && isMultiImageMessage() && (message as any)?.imageDataArray?.length > 1 && !isPdfMessage() && (!message.isProcessing || message.progressData?.isComplete) && (
            <div className="gallery-side"><SimpleImageGallery key={`${session?.id}-${message.id}-multi`} images={(message as any).imageDataArray} onImageClick={handleMultiImageClick} onImageLoad={onImageLoad} /></div>
          )}

          {!isUser && (message as any)?.imageDataArray?.length === 1 && !isPdfMessage() && (!message.isProcessing || message.progressData?.isComplete) && (
            <div className="homework-annotated-image" onClick={handleImageClick}>
              <img src={getImageSourceFromArray((message as any).imageDataArray, 0) || ''} alt="Marked homework" className="annotated-image" onLoad={onImageLoad} onError={handleImageError} key={`${session?.id}-${message.id}-single`} />
            </div>
          )}

          {/* Legacy fallback - Only if imageDataArray is empty */}
          {!isUser && isAnnotatedImageMessage(message) && imageSrc && !imageError && (!(message as any)?.imageDataArray || (message as any)?.imageDataArray.length === 0) && (
            <div className="homework-annotated-image" onClick={handleImageClick}>
              <img src={imageSrc} alt="Marked homework" className="annotated-image" onLoad={onImageLoad} onError={handleImageError} key={`${session?.id}-${message.id}-legacy`} />
            </div>
          )}

          {!isUser && message.detectedQuestion?.found && message.suggestedFollowUps && message.suggestedFollowUps.length > 0 && (
            <SuggestedFollowUpButtons suggestions={message.suggestedFollowUps as string[]} onSuggestionClick={handleFollowUpClick} disabled={isAnyMessageProcessing} />
          )}

          {isUser && content && <div className="message-text">{ensureStringContent(content)}</div>}
        </div>

        {/* User uploads (Images/PDFs) */}
        {isUser && hasImage(message) && !imageError && (
          <div className="chat-message-image">
            {isPdfMessage() ? (
              <div className="pdf-files-container">
                {(message as any).pdfContexts?.map((pdf: any, idx: number) => (
                  <div key={idx} className="chat-message-file-card" onClick={() => pdf.url && window.open(pdf.url, '_blank')}>
                    <div className="pdf-file-info">
                      <span className="small-pdf-file-name">{truncateFileName(pdf.originalFileName || 'PDF')}</span>
                      <span className="pdf-file-size">PDF · {formatFileSize(pdf.fileSize)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <SimpleImageGallery key={`${session?.id}-${message.id}-user`} images={getMultiImageData()} onImageClick={handleMultiImageClick} onImageLoad={onImageLoad} />
            )}
          </div>
        )}

        {timestamp && (isUser || !message.isProcessing) && <div className="chat-message-timestamp">{timestamp}</div>}
      </div>

      {isImageModeOpen && (
        <ImageModeModal
          isOpen={isImageModeOpen}
          onClose={() => setIsImageModeOpen(false)}
          images={isMultiImageMessage() ? (window as any).__currentSessionImages || [] : session ? getSessionImages(session) : []}
          initialImageIndex={isMultiImageMessage() ? (window as any).__currentImageIndex || 0 : session ? findImageIndex(getSessionImages(session), message.id) : 0}
        />
      )}
    </div>
  );
});

export default ChatMessage;
