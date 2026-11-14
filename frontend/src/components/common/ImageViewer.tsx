/**
 * ImageViewer Component
 * 
 * Reusable full-control image viewer (Zoom, Pan, Rotate, Download)
 * Used by both ImageModeModal and SplitView
 */

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import {
    X,
    ZoomIn,
    ZoomOut,
    Download,
    RotateCw,
    Archive,
    ArrowUp,
    ArrowDown,
    AlertCircle,
    Sparkles,
    Send,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import type { SessionImage } from '../../utils/imageCollectionUtils';
import { useImageMode } from '../../hooks/useImageMode';
import { engagementTracker } from '../../utils/engagementTracker';
import './ImageModeModal.css'; // Reusing existing styles for now

export interface ActiveQuestionMeta {
    questionNumber: string;
    awardedMarks: number | null;
    totalMarks: number;
}

export interface ViewerFollowUpResponse {
    id: string;
    questionNumber?: string | null;
    content: string;
}

interface ImageViewerProps {
    images: SessionImage[];
    initialImageIndex: number;
    onClose: () => void;
    isOpen?: boolean; // Optional, defaults to true if mounted
    onImageChange?: (index: number) => void;
    lostMarkPageIndices?: number[];
    activeQuestionMeta?: ActiveQuestionMeta | null;
    isMobile?: boolean;
    onSendFollowUpMessage?: (text: string, questionNumber?: string | null) => Promise<boolean | void> | void;
    isProcessingFollowUp?: boolean;
    latestFollowUpResponse?: ViewerFollowUpResponse | null;
    hasExplanationForActiveQuestion?: boolean;
    onFocusExistingExplanation?: (questionNumber: string) => void;
    MarkdownRenderer?: React.ComponentType<any>;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
    images,
    initialImageIndex,
    onClose,
    isOpen = true,
    onImageChange,
    lostMarkPageIndices = [],
    activeQuestionMeta = null,
    isMobile = false,
    onSendFollowUpMessage,
    isProcessingFollowUp = false,
    latestFollowUpResponse = null,
    hasExplanationForActiveQuestion = false,
    onFocusExistingExplanation,
    MarkdownRenderer
}) => {
    const [currentImageIndex, setCurrentImageIndex] = useState(initialImageIndex);
    const [isMistakesFilterActive, setIsMistakesFilterActive] = useState(false);
    const [mobileInputText, setMobileInputText] = useState('');
    const [isSheetCollapsed, setIsSheetCollapsed] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const lastSeenResponseIdRef = useRef<string | null>(latestFollowUpResponse?.id || null);

    // Reset filter if mistake pages become empty
    useEffect(() => {
        if (isMistakesFilterActive && (!lostMarkPageIndices || lostMarkPageIndices.length === 0)) {
            setIsMistakesFilterActive(false);
        }
    }, [isMistakesFilterActive, lostMarkPageIndices]);

    // Auto-open bottom response sheet when a new follow-up response arrives on mobile
    useEffect(() => {
        if (latestFollowUpResponse?.id && latestFollowUpResponse.id !== lastSeenResponseIdRef.current) {
            lastSeenResponseIdRef.current = latestFollowUpResponse.id;
            setIsSheetCollapsed(false);
        }
    }, [latestFollowUpResponse?.id]);

    // Update internal state if initial prop changes (e.g. parent switching images)
    // We use a ref to track the last prop value to prevent redundant sets
    const lastPropIndexRef = useRef(initialImageIndex);
    useEffect(() => {
        if (initialImageIndex !== lastPropIndexRef.current) {
            lastPropIndexRef.current = initialImageIndex;
            setCurrentImageIndex(prev => {
                if (prev !== initialImageIndex) {
                    setIsSheetCollapsed(true);
                    engagementTracker.recordPageView(initialImageIndex);
                }
                return initialImageIndex;
            });
        }
    }, [initialImageIndex]);

    // Auto-scroll thumbnails to active image
    useEffect(() => {
        if (!isOpen || !images || images.length <= 1) return;

        const timerId = setTimeout(() => {
            const el = document.getElementById(`thumb-btn-${currentImageIndex}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
            }
        }, 100);
        return () => clearTimeout(timerId);
    }, [currentImageIndex, isOpen, images]);

    // Use single hook for all functionality
    const {
        zoomLevel,
        isDragging,
        imageError,
        isLoading,
        isDownloading,
        isZipping,
        zipProgress,
        zoomIn,
        zoomOut,
        rotate,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleTouchStart,
        handleTouchMove,
        handleTouchEnd,
        handleImageLoad,
        handleImageError,
        handleDownload,
        handleDownloadAllZip,
        calculateTransform,
        canZoomIn,
        canZoomOut
    } = useImageMode({ isOpen, currentImageIndex });

    // Fix for infinite spinner: Check if image is already loaded (cached) when index changes
    useEffect(() => {
        if (imageRef.current && imageRef.current.complete) {
            handleImageLoad();
        }
    }, [currentImageIndex, handleImageLoad]);

    const currentImage = images[currentImageIndex];

    // Navigation Handlers - these trigger the callback to parent
    const performNavigation = useCallback((newIndex: number) => {
        setCurrentImageIndex(newIndex);
        setIsSheetCollapsed(true);
        engagementTracker.recordPageView(newIndex);
        if (onImageChange) {
            onImageChange(newIndex);
        }
    }, [onImageChange]);

    const isMistakeView = isMistakesFilterActive && lostMarkPageIndices.length > 0;
    const currentMistakePosition = useMemo(() => {
        if (!isMistakeView) return -1;
        const exactIdx = lostMarkPageIndices.indexOf(currentImageIndex);
        if (exactIdx !== -1) return exactIdx + 1;
        const priorCount = lostMarkPageIndices.filter(idx => idx <= currentImageIndex).length;
        return Math.max(1, priorCount);
    }, [isMistakeView, lostMarkPageIndices, currentImageIndex]);

    const canGoPrevious = isMistakeView
        ? currentImageIndex > lostMarkPageIndices[0]
        : currentImageIndex > 0;
    const canGoNext = isMistakeView
        ? currentImageIndex < lostMarkPageIndices[lostMarkPageIndices.length - 1]
        : currentImageIndex < images.length - 1;

    const navigateToPrevious = useCallback(() => {
        if (!canGoPrevious) return;
        if (isMistakeView) {
            const prevCandidates = lostMarkPageIndices.filter(idx => idx < currentImageIndex);
            if (prevCandidates.length > 0) {
                performNavigation(prevCandidates[prevCandidates.length - 1]);
            }
            return;
        }
        if (images.length > 1) {
            performNavigation(currentImageIndex - 1);
        }
    }, [canGoPrevious, isMistakeView, lostMarkPageIndices, images.length, currentImageIndex, performNavigation]);

    const navigateToNext = useCallback(() => {
        if (!canGoNext) return;
        if (isMistakeView) {
            const nextIdx = lostMarkPageIndices.find(idx => idx > currentImageIndex);
            if (nextIdx !== undefined) {
                performNavigation(nextIdx);
            }
            return;
        }
        if (images.length > 1) {
            performNavigation(currentImageIndex + 1);
        }
    }, [canGoNext, isMistakeView, lostMarkPageIndices, images.length, currentImageIndex, performNavigation]);

    const handleToggleMistakesFilter = useCallback(() => {
        if (!lostMarkPageIndices || lostMarkPageIndices.length === 0) return;
        setIsMistakesFilterActive(prev => {
            const nextActive = !prev;
            if (nextActive && !lostMarkPageIndices.includes(currentImageIndex)) {
                const targetIdx = lostMarkPageIndices.find(idx => idx > currentImageIndex) ?? lostMarkPageIndices[0];
                performNavigation(targetIdx);
            }
            return nextActive;
        });
    }, [lostMarkPageIndices, currentImageIndex, performNavigation]);

    const handleExplainActiveQuestion = useCallback(async () => {
        if (isProcessingFollowUp) return;
        const qNum = activeQuestionMeta?.questionNumber;

        // If an explanation already exists for this question, toggle/focus it instead of firing a duplicate LLM call
        if (hasExplanationForActiveQuestion && qNum) {
            if (isMobile) {
                setIsSheetCollapsed(prev => !prev);
            } else if (onFocusExistingExplanation) {
                onFocusExistingExplanation(qNum);
            }
            return;
        }

        if (!onSendFollowUpMessage) return;
        const promptText = qNum
            ? (activeQuestionMeta?.awardedMarks !== null &&
               activeQuestionMeta?.totalMarks &&
               activeQuestionMeta.awardedMarks < activeQuestionMeta.totalMarks
                ? `Explain Question ${qNum}: first point out specifically where my working went wrong, then show step-by-step how to get full marks (${activeQuestionMeta.totalMarks}/${activeQuestionMeta.totalMarks}).`
                : `Explain Question ${qNum} step-by-step.`)
            : `Explain the marking on page ${currentImageIndex + 1} step-by-step.`;

        if (isMobile) {
            setIsSheetCollapsed(false);
        }
        await onSendFollowUpMessage(promptText, qNum || null);
    }, [
        onSendFollowUpMessage,
        isProcessingFollowUp,
        activeQuestionMeta,
        currentImageIndex,
        isMobile,
        hasExplanationForActiveQuestion,
        onFocusExistingExplanation
    ]);

    const handleMobileChatSubmit = useCallback(async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const trimmed = mobileInputText.trim();
        if (!trimmed || !onSendFollowUpMessage || isProcessingFollowUp) return;

        const qNum = activeQuestionMeta?.questionNumber || null;
        setMobileInputText('');
        setIsSheetCollapsed(false);
        await onSendFollowUpMessage(trimmed, qNum);
    }, [mobileInputText, onSendFollowUpMessage, isProcessingFollowUp, activeQuestionMeta]);

    const visibleThumbnails = useMemo(() => {
        const mapped = images.map((image, originalIndex) => ({ image, originalIndex }));
        if (isMistakesFilterActive && lostMarkPageIndices.length > 0) {
            return mapped.filter(item => lostMarkPageIndices.includes(item.originalIndex));
        }
        return mapped;
    }, [images, isMistakesFilterActive, lostMarkPageIndices]);

    const handleImageClick = useCallback((index: number) => {
        performNavigation(index);
    }, [performNavigation]);

    const onDownload = useCallback(async () => {
        if (!currentImage) return;
        await handleDownload(currentImage);
    }, [currentImage, handleDownload]);

    const onDownloadAll = useCallback(async () => {
        if (!images || images.length <= 1) return;
        const rawName = currentImage?.filename || 'annotated_homework';
        const cleanBase = rawName.replace(/_page_\d+.*|\.pdf$|\.jpe?g$|\.png$/i, '') || 'annotated_homework';
        await handleDownloadAllZip(images, cleanBase);
    }, [images, currentImage, handleDownloadAllZip]);

    // Handle keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
                return;
            }

            switch (e.key) {
                case 'Escape':
                    onClose();
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault();
                    navigateToPrevious();
                    break;
                case 'ArrowRight':
                case 'ArrowDown':
                    e.preventDefault();
                    navigateToNext();
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    zoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    zoomOut();
                    break;
                case 'r':
                case 'R':
                    e.preventDefault();
                    rotate();
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, zoomIn, zoomOut, rotate, onClose, navigateToNext, navigateToPrevious]);

    // Handle touch events
    useEffect(() => {
        if (!isOpen) return;

        // One-finger drag is handled via isDragging, 
        // two-finger pinch is handled via pinchStartDistance
        // We use global listeners for move and end for better stability
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);
        document.addEventListener('touchcancel', handleTouchEnd);

        return () => {
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
            document.removeEventListener('touchcancel', handleTouchEnd);
        };
    }, [isOpen, handleTouchMove, handleTouchEnd]);

    // Handle mouse drag events
    useEffect(() => {
        if (!isOpen) return;

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isOpen, isDragging, handleMouseMove, handleMouseUp]);

    // Auto-scroll thumbnails when current index changes
    const thumbnailListRef = useRef<HTMLDivElement>(null);
    const thumbnailRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        if (thumbnailListRef.current && thumbnailRefs.current[currentImageIndex]) {
            const thumbnail = thumbnailRefs.current[currentImageIndex];
            if (thumbnail) {
                thumbnail.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }, [currentImageIndex]);

    // Handle initial population of thumbnail refs
    useEffect(() => {
        thumbnailRefs.current = thumbnailRefs.current.slice(0, images.length);
    }, [images]);

    const activeBadgeColorClass = useMemo(() => {
        if (!activeQuestionMeta || activeQuestionMeta.awardedMarks === null || activeQuestionMeta.totalMarks <= 0) {
            return 'neutral';
        }
        if (activeQuestionMeta.awardedMarks === activeQuestionMeta.totalMarks) return 'green';
        if (activeQuestionMeta.awardedMarks === 0) return 'red';
        return 'yellow';
    }, [activeQuestionMeta]);

    if (!currentImage) {
        return null;
    }

    const responseMatchesActiveQuestion = Boolean(
        !latestFollowUpResponse?.questionNumber ||
        !activeQuestionMeta?.questionNumber ||
        String(latestFollowUpResponse.questionNumber).toLowerCase() === String(activeQuestionMeta.questionNumber).toLowerCase()
    );

    const showMobileResponseSheet = Boolean(
        isMobile &&
        onSendFollowUpMessage &&
        (isProcessingFollowUp || Boolean(latestFollowUpResponse && responseMatchesActiveQuestion && latestFollowUpResponse.content))
    );

    return (
        <div className={`image-viewer-root ${isMobile && onSendFollowUpMessage ? 'has-mobile-chat' : ''}`} role="region" aria-label="Image viewer">
            <div className="image-mode-header">
                <div className="image-mode-controls">
                    {images.length > 1 && (
                        <>
                            <div className={`page-stepper-controls ${isMistakeView ? 'mistake-mode' : ''}`} role="group" aria-label="Page navigation">
                                <button
                                    type="button"
                                    className="page-step-btn"
                                    onClick={navigateToPrevious}
                                    disabled={!canGoPrevious}
                                    aria-label={isMistakeView ? 'Previous mistake page' : 'Previous page'}
                                    title={isMistakeView ? 'Previous mistake page (↑)' : 'Previous page (↑)'}
                                >
                                    <ArrowUp size={15} />
                                </button>
                                <span className="page-step-counter">
                                    {isMistakeView
                                        ? `Mistake ${currentMistakePosition} / ${lostMarkPageIndices.length}`
                                        : `${currentImageIndex + 1} / ${images.length}`}
                                </span>
                                <button
                                    type="button"
                                    className="page-step-btn"
                                    onClick={navigateToNext}
                                    disabled={!canGoNext}
                                    aria-label={isMistakeView ? 'Next mistake page' : 'Next page'}
                                    title={isMistakeView ? 'Next mistake page (↓)' : 'Next page (↓)'}
                                >
                                    <ArrowDown size={15} />
                                </button>
                            </div>
                            <div className="control-separator" />
                        </>
                    )}
                    {lostMarkPageIndices.length > 0 && (
                        <>
                            <button
                                type="button"
                                className={`mistakes-filter-pill ${isMistakesFilterActive ? 'active' : ''}`}
                                onClick={handleToggleMistakesFilter}
                                aria-pressed={isMistakesFilterActive}
                                title={isMistakesFilterActive ? 'Show all pages' : 'Filter to pages with lost marks'}
                            >
                                <AlertCircle size={14} />
                                <span>Mistakes ({lostMarkPageIndices.length})</span>
                            </button>
                            <div className="control-separator" />
                        </>
                    )}
                    {!isMobile && onSendFollowUpMessage && activeQuestionMeta && (
                        <>
                            <button
                                type="button"
                                className={`viewer-explain-btn ${hasExplanationForActiveQuestion ? 'has-explanation' : ''}`}
                                onClick={handleExplainActiveQuestion}
                                disabled={isProcessingFollowUp}
                                title={
                                    hasExplanationForActiveQuestion
                                        ? `Scroll to existing Question ${activeQuestionMeta.questionNumber} explanation in chat`
                                        : `Ask AI to explain Question ${activeQuestionMeta.questionNumber} in the chat panel`
                                }
                            >
                                <Sparkles size={14} />
                                <span>
                                    {hasExplanationForActiveQuestion
                                        ? `View Q${activeQuestionMeta.questionNumber} Explanation`
                                        : `Explain Q${activeQuestionMeta.questionNumber}`}
                                </span>
                            </button>
                            <div className="control-separator" />
                        </>
                    )}
                    <div className="zoom-controls">
                        <button type="button" className="zoom-btn" onClick={zoomOut} disabled={!canZoomOut} aria-label="Zoom out"><ZoomOut size={20} /></button>
                        <div className="zoom-level">{zoomLevel}%</div>
                        <button type="button" className="zoom-btn" onClick={zoomIn} disabled={!canZoomIn} aria-label="Zoom in"><ZoomIn size={20} /></button>
                    </div>
                    <div className="control-separator" />
                    <button type="button" className="rotate-btn" onClick={rotate} aria-label="Rotate image"><RotateCw size={20} /></button>
                    <div className="control-separator" />
                    <button type="button" className="download-btn" onClick={onDownload} disabled={isDownloading || isZipping} aria-label="Download image" title={isDownloading ? 'Downloading...' : 'Download current page'}><Download size={20} /></button>
                    {images.length > 1 && (
                        <>
                            <div className="control-separator" />
                            <button
                                type="button"
                                className="download-all-btn"
                                onClick={onDownloadAll}
                                disabled={isZipping || isDownloading}
                                aria-label="Download all pages as ZIP archive"
                                title={isZipping ? `Zipping ${zipProgress}` : 'Download all pages in a .zip archive'}
                            >
                                <Archive size={20} />
                            </button>
                        </>
                    )}
                </div>
                <button type="button" className="close-btn" onClick={onClose} aria-label="Close image viewer"><X size={20} /></button>
            </div>

            <div className="image-mode-content">
                <div className="image-container">
                    {isLoading && (
                        <div className="image-loading">
                            <div className="loading-spinner" />
                            <span>Loading image...</span>
                        </div>
                    )}
                    {imageError && (
                        <div className="image-error">
                            <span>❌ Image failed to load</span>
                            <button onClick={() => window.location.reload()}>Try again</button>
                        </div>
                    )}
                    {!imageError && (
                        <img
                            ref={imageRef}
                            src={currentImage.src}
                            alt={currentImage.alt}
                            className="main-image"
                            style={{ transform: calculateTransform(), transformOrigin: 'center center' }}
                            onLoad={handleImageLoad}
                            onError={handleImageError}
                            onMouseDown={handleMouseDown}
                            onTouchStart={handleTouchStart}
                            draggable={false}
                        />
                    )}
                </div>

                {images.length > 1 && (
                    <div className="thumbnail-sidebar">
                        <div className="thumbnail-list" ref={thumbnailListRef}>
                            {visibleThumbnails.map(({ image, originalIndex }) => (
                                <button
                                    key={image.id || originalIndex}
                                    id={`thumb-btn-${originalIndex}`}
                                    ref={el => thumbnailRefs.current[originalIndex] = el}
                                    type="button"
                                    className={`thumbnail-btn ${originalIndex === currentImageIndex ? 'active' : ''}`}
                                    onClick={() => handleImageClick(originalIndex)}
                                    aria-label={`View image ${originalIndex + 1}`}
                                >
                                    <img src={image.src} alt={image.alt} className="modal-thumbnail-image" draggable={false} />
                                    {image.badgeText && <span className={`thumbnail-badge ${image.badgeColor || 'neutral'}`}>{image.badgeText}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {showMobileResponseSheet && !isSheetCollapsed && (
                    <div
                        className="viewer-mobile-response-sheet expanded"
                        onTouchStart={e => e.stopPropagation()}
                        onTouchMove={e => e.stopPropagation()}
                    >
                        <div
                            className="viewer-mobile-sheet-header"
                            role="button"
                            tabIndex={0}
                            onClick={() => setIsSheetCollapsed(true)}
                            onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsSheetCollapsed(true);
                                }
                            }}
                        >
                            <div className="viewer-mobile-sheet-title">
                                <Sparkles size={14} />
                                <span>
                                    {isProcessingFollowUp
                                        ? `Thinking${activeQuestionMeta ? ` about Q${activeQuestionMeta.questionNumber}` : ''}...`
                                        : `AI Explanation${latestFollowUpResponse?.questionNumber ? ` · Q${latestFollowUpResponse.questionNumber}` : ''}`}
                                </span>
                            </div>
                            <div className="viewer-mobile-sheet-actions">
                                <button
                                    type="button"
                                    className="viewer-sheet-icon-btn"
                                    onClick={e => {
                                        e.stopPropagation();
                                        setIsSheetCollapsed(true);
                                    }}
                                    aria-label="Collapse AI response"
                                >
                                    <ChevronDown size={16} />
                                </button>
                            </div>
                        </div>
                        <div className="viewer-mobile-sheet-body">
                            {isProcessingFollowUp ? (
                                <div className="viewer-mobile-sheet-loading">
                                    <div className="loading-spinner small" />
                                    <span>Generating step-by-step explanation...</span>
                                </div>
                            ) : latestFollowUpResponse ? (
                                MarkdownRenderer ? (
                                    <MarkdownRenderer content={latestFollowUpResponse.content} />
                                ) : (
                                    <div className="viewer-mobile-sheet-plain">{latestFollowUpResponse.content}</div>
                                )
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            {isMobile && onSendFollowUpMessage && (
                <form className="viewer-mobile-chat-bar" onSubmit={handleMobileChatSubmit}>
                    <div className="viewer-mobile-chat-chips">
                        {activeQuestionMeta && (
                            <span className={`viewer-active-q-badge ${activeBadgeColorClass}`}>
                                Q{activeQuestionMeta.questionNumber}
                                {activeQuestionMeta.awardedMarks !== null && activeQuestionMeta.totalMarks > 0
                                    ? ` · ${activeQuestionMeta.awardedMarks}/${activeQuestionMeta.totalMarks}`
                                    : ''}
                            </span>
                        )}
                        <button
                            type="button"
                            className={`viewer-mobile-explain-chip ${showMobileResponseSheet ? 'has-explanation' : ''}`}
                            onClick={() => {
                                if (showMobileResponseSheet) {
                                    setIsSheetCollapsed(prev => !prev);
                                } else {
                                    handleExplainActiveQuestion();
                                }
                            }}
                            disabled={isProcessingFollowUp && !isSheetCollapsed}
                        >
                            <Sparkles size={12} />
                            <span>
                                {isProcessingFollowUp
                                    ? `Thinking${activeQuestionMeta ? ` · Q${activeQuestionMeta.questionNumber}` : '...'}`
                                    : showMobileResponseSheet
                                        ? `AI Explanation${activeQuestionMeta ? ` · Q${activeQuestionMeta.questionNumber}` : ''}`
                                        : (activeQuestionMeta ? `Explain Q${activeQuestionMeta.questionNumber}` : 'Explain Page')}
                            </span>
                            {showMobileResponseSheet && (
                                isSheetCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                            )}
                        </button>
                    </div>
                    <div className="viewer-mobile-chat-input-row">
                        <input
                            type="text"
                            className="viewer-mobile-chat-input"
                            value={mobileInputText}
                            onChange={e => setMobileInputText(e.target.value)}
                            placeholder={
                                activeQuestionMeta
                                    ? `Ask about Q${activeQuestionMeta.questionNumber}...`
                                    : 'Ask a follow-up question...'
                            }
                            disabled={isProcessingFollowUp}
                        />
                        <button
                            type="submit"
                            className="viewer-mobile-chat-send"
                            disabled={!mobileInputText.trim() || isProcessingFollowUp}
                            aria-label="Send question"
                        >
                            <Send size={15} />
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default ImageViewer;
