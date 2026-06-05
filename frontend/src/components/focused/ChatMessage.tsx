/**
 * Focused ChatMessage Component (TypeScript)
 * This is the definitive version with fixes for all rendering and state bugs.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './ChatMessage.css';
import YourWorkSection from './YourWorkSection';
import { Brain, ChevronDown, ChevronUp, Lock } from 'lucide-react';
import EventManager, { EVENT_TYPES } from '../../utils/eventManager';
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
  selectedModel = 'thinking', // Default to Gemini 2.0 Flash
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
        model: selectedModel || 'thinking',
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
        simpleSessionService.handleTextChatComplete(result, selectedModel || 'thinking');
      }
    } catch (error) {
      console.error('❌ [FOLLOW-UP] Unexpected error:', error);
    }
  }, [session?.id, addMessage, startAIThinking, getAuthToken, message.id, selectedModel, user, message.detectedQuestion, message.contextQuestionId]);


  const handleSignup = useCallback(() => {
    EventManager.dispatch(EVENT_TYPES.OPEN_AUTH_MODAL, { mode: 'signup' });
  }, []);

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

  const hasYourWork = (typeof content === 'string' && (content.includes(':::your-work') || content.includes('model-answer-block') || content.includes('step-title'))) ||
    message.type === 'question_response' ||
    !!(message as any).contextQuestionId;

  return (
    <div className={`chat-message ${isUser ? 'user' : 'assistant'} ${message.type === 'question_response' ? 'question-mode-response' : ''}`} data-message-id={message.id}>
      <div className="chat-message-content">
        <div className={`chat-message-bubble ${hasYourWork ? 'has-your-work' : ''}`}>
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

              if (message.detectedQuestion) {
                const qNumMatch = header.match(/Question\s+(\d+[a-z]*)/i);
                if (qNumMatch && message.detectedQuestion.examPapers) {
                  const allQuestions = message.detectedQuestion.examPapers.flatMap((ep: any) => ep.questions || []);
                  const matchedQ = allQuestions.find((q: any) => q.questionNumber === qNumMatch[1]);
                  if (matchedQ) {
                    totalMarks = matchedQ.marks;
                  }
                }
                if (totalMarks === 0 && message.detectedQuestion.totalMarks) {
                  totalMarks = message.detectedQuestion.totalMarks;
                }
              }

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

              const handleContainerClick = (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                const link = target.closest('a');
                if (link && link.getAttribute('href')?.startsWith('#question-')) {
                  e.preventDefault();
                  const qNum = link.getAttribute('href')!.replace('#question-', '');
                  onNavigate?.(qNum, -1, 'ribbon');
                  return;
                }
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
                {(message as any).performanceSummary && (
                  <div className="ai-performance-summary">
                    <div className="ai-performance-summary-content">
                      <MarkdownMathRenderer
                        content={(message as any).performanceSummary}
                        className="chat-message-renderer"
                        options={{
                          throwOnError: false,
                          errorColor: '#cc0000',
                        }}
                      />
                    </div>
                    <hr className="summary-separator" />
                  </div>
                )}
                {hasYourWork ? (
                  <div className="has-your-work-outer-container">
                    <div className={(message.detectedQuestion as any)?.isGuest ? 'guest-blur-enabled' : ''} style={{ position: 'relative' }}>
                      <MarkdownMathRenderer
                        content={processedContent}
                        className="chat-message-renderer has-your-work"
                        options={{
                          throwOnError: false,
                          errorColor: '#cc0000',
                        }}
                        YourWorkSection={YourWorkSection}
                        isYourWork={true}
                      />
                      {((message.detectedQuestion as any)?.isGuest && processedContent.includes('paywall-blur')) && (
                        <div className="paywall-cta-inline">
                          <h4 className="paywall-inline-title">Sign up to see more answers</h4>
                          <button className="paywall-unlock-btn" onClick={handleSignup}>
                            <Lock size={18} />
                            Unlock Full Paper for Free
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={(message.detectedQuestion as any)?.isGuest ? 'guest-blur-enabled' : ''} style={{ position: 'relative' }}>
                    <MarkdownMathRenderer
                      content={processedContent}
                      className="chat-message-renderer"
                      options={{
                        throwOnError: false,
                        errorColor: '#cc0000',
                      }}
                      YourWorkSection={YourWorkSection}
                      isYourWork={false}
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Processing Skeletons */}
          {message.isProcessing &&
            !message.progressData?.isComplete &&
            (message as any).imageDataArray?.length > 0 &&
            !content &&
            !isAnnotatedImageMessage(message) && (
              <div className={`skeleton-gallery-wrapper ${hasYourWork ? 'has-your-work' : ''}`}>
                <div className="skeleton-gallery thumbnail-horizontal">
                  {(message as any).imageDataArray.map((imgItem: any, idx: number) => {
                    const src = typeof imgItem === 'string' ? imgItem : imgItem?.url;
                    const isPdf = isPdfMessage() || (imgItem?.originalFileName && imgItem.originalFileName.toLowerCase().endsWith('.pdf')) || (typeof imgItem === 'string' && imgItem.toLowerCase().endsWith('.pdf'));
                    const validImageSrc = isPdf ? null : src;
                    
                    return (
                      <div key={idx} className="skeleton-item">
                        {validImageSrc ? (
                          <img src={validImageSrc} alt={`Processing page ${idx + 1}`} className="skeleton-image-preview" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.5 }} />
                        ) : (
                          <div className="skeleton-shimmer"></div>
                        )}
                        <div className="skeleton-overlay">
                          <span className="skeleton-label">Analyzing Page {idx + 1}...</span>
                        </div>
                        {validImageSrc && <div className="skeleton-shimmer" style={{ opacity: 0.3 }}></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {/* Assistant Galleries and Images */}
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

          {/* Suggested Follow-ups */}
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
                    <div className="pdf-icon-wrapper">
                      <div className="pdf-icon" style={{ backgroundColor: 'rgb(250, 66, 62)' }}>
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="pdf-icon-svg">
                          <path fillRule="evenodd" clipRule="evenodd" d="M11.2598 2.25191C11.8396 2.25191 12.2381 2.24808 12.6201 2.33981L12.8594 2.40719C13.0957 2.48399 13.3228 2.5886 13.5352 2.71871L13.6582 2.79879C13.9416 2.99641 14.1998 3.25938 14.5586 3.61813L15.5488 4.60836L15.833 4.89449C16.0955 5.16136 16.2943 5.38072 16.4482 5.6318L16.5703 5.84957C16.6829 6.07074 16.7691 6.30495 16.8271 6.54684L16.8574 6.69137C16.918 7.0314 16.915 7.39998 16.915 7.90719V13.0839C16.915 13.7728 16.9157 14.3301 16.8789 14.7802C16.8461 15.1808 16.781 15.5417 16.6367 15.8779L16.5703 16.0205C16.3049 16.5413 15.9008 16.9772 15.4053 17.2812L15.1865 17.4033C14.8099 17.5951 14.4041 17.6745 13.9463 17.7119C13.4961 17.7487 12.9391 17.749 12.25 17.749H7.75C7.06092 17.749 6.50395 17.7487 6.05371 17.7119C5.65317 17.6791 5.29227 17.6148 4.95606 17.4707L4.81348 17.4033C4.29235 17.1378 3.85586 16.7341 3.55176 16.2382L3.42969 16.0205C3.23787 15.6439 3.15854 15.2379 3.12109 14.7802C3.08432 14.3301 3.08496 13.7728 3.08496 13.0839V6.91695C3.08496 6.228 3.08433 5.67086 3.12109 5.22066C3.1585 4.76296 3.23797 4.35698 3.42969 3.98043C3.73311 3.38494 4.218 2.90008 4.81348 2.59664C5.19009 2.40484 5.59593 2.32546 6.05371 2.28805C6.50395 2.25126 7.06091 2.25191 7.75 2.25191H11.2598ZM7.75 3.58199C7.03896 3.58199 6.54563 3.58288 6.16211 3.61422C5.78642 3.64492 5.575 3.70168 5.41699 3.78219C5.0718 3.95811 4.79114 4.23874 4.61524 4.58395C4.53479 4.74193 4.47795 4.95354 4.44727 5.32906C4.41595 5.71254 4.41504 6.20609 4.41504 6.91695V13.0839C4.41504 13.7947 4.41594 14.2884 4.44727 14.6718C4.47798 15.0472 4.53477 15.259 4.61524 15.417L4.68555 15.5429C4.86186 15.8304 5.11487 16.0648 5.41699 16.2187L5.54688 16.2744C5.69065 16.3258 5.88016 16.3636 6.16211 16.3867C6.54563 16.418 7.03898 16.4189 7.75 16.4189H12.25C12.961 16.4189 13.4544 16.418 13.8379 16.3867C14.2135 16.356 14.425 16.2992 14.583 16.2187L14.709 16.1474C14.9963 15.9712 15.2308 15.7189 15.3848 15.417L15.4414 15.2861C15.4927 15.1425 15.5297 14.953 15.5527 14.6718C15.5841 14.2884 15.585 13.7947 15.585 13.0839V8.55758L13.3506 8.30953C12.2572 8.18804 11.3976 7.31827 11.2881 6.22359L11.0234 3.58199H7.75ZM12.6113 6.09176C12.6584 6.56193 13.0275 6.93498 13.4971 6.98727L15.5762 7.21871C15.5727 7.13752 15.5686 7.07109 15.5615 7.01266L15.5342 6.85738C15.5005 6.7171 15.4501 6.58135 15.3848 6.45309L15.3145 6.32711C15.2625 6.24233 15.1995 6.16135 15.0928 6.04488L14.6084 5.54879L13.6182 4.55856C13.2769 4.21733 13.1049 4.04904 12.9688 3.94234L12.8398 3.8525C12.7167 3.77705 12.5853 3.71637 12.4482 3.67184L12.3672 3.6484L12.6113 6.09176Z"></path>
                        </svg>
                      </div>
                    </div>
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
