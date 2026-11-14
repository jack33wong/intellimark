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
    MarkdownRenderer
}) => {
    const [currentImageIndex, setCurrentImageIndex] = useState(initialImageIndex);
    const [isMistakesFilterActive, setIsMistakesFilterActive] = useState(false);
    const [mobileInputText, setMobileInputText] = useState('');
    const [isSheetDismissed, setIsSheetDismissed] = useState(false);
    const [isSheetCollapsed, setIsSheetCollapsed] = useState(false);
    const [hasRequestedInViewerFollowUp, setHasRequestedInViewerFollowUp] = useState(false);
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
            setIsSheetDismissed(false);
            setIsSheetCollapsed(false);
            setHasRequestedInViewerFollowUp(true);
        }
    }, [latestFollowUpResponse?.id]);

    // Update internal state if initial prop changes (e.g. parent switching images)
    // We use a ref to track the last prop value to prevent redundant sets
    const lastPropIndexRef = useRef(initialImageIndex);
    useEffect(() => {
        if (initialImageIndex !== lastPropIndexRef.current) {
            setCurrentImageIndex(initialImageIndex);
            lastPropIndexRef.current = initialImageIndex;
            setIsSheetCollapsed(true);
            engagementTracker.recordPageView(initialImageIndex);
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

    const navigateToPrevious = useCallback(() => {
        if (isMistakesFilterActive && lostMarkPageIndices.length > 0) {
            const currentPos = lostMarkPageIndices.indexOf(currentImageIndex);
            if (currentPos !== -1) {
                const prevPos = currentPos === 0 ? lostMarkPageIndices.length - 1 : currentPos - 1;
                performNavigation(lostMarkPageIndices[prevPos]);
            } else {
                const prevCandidates = lostMarkPageIndices.filter(idx => idx < currentImageIndex);
                const targetIdx = prevCandidates.length > 0
                    ? prevCandidates[prevCandidates.length - 1]
                    : lostMarkPageIndices[lostMarkPageIndices.length - 1];
                performNavigation(targetIdx);
            }
            return;
        }
        if (images.length > 1) {
            const newIndex = currentImageIndex === 0 ? images.length - 1 : currentImageIndex - 1;
            performNavigation(newIndex);
        }
    }, [isMistakesFilterActive, lostMarkPageIndices, images.length, currentImageIndex, performNavigation]);

    const navigateToNext = useCallback(() => {
        if (isMistakesFilterActive && lostMarkPageIndices.length > 0) {
            const currentPos = lostMarkPageIndices.indexOf(currentImageIndex);
            if (currentPos !== -1) {
                const nextPos = currentPos === lostMarkPageIndices.length - 1 ? 0 : currentPos + 1;
                performNavigation(lostMarkPageIndices[nextPos]);
            } else {
                const nextIdx = lostMarkPageIndices.find(idx => idx > currentImageIndex) ?? lostMarkPageIndices[0];
                performNavigation(nextIdx);
            }
            return;
        }
        if (images.length > 1) {
            const newIndex = currentImageIndex === images.length - 1 ? 0 : currentImageIndex + 1;
            performNavigation(newIndex);
        }
    }, [isMistakesFilterActive, lostMarkPageIndices, images.length, currentImageIndex, performNavigation]);

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

    const handleNextMistake = useCallback(() => {
        if (!lostMarkPageIndices || lostMarkPageIndices.length === 0) return;
        const nextIdx = lostMarkPageIndices.find(idx => idx > currentImageIndex) ?? lostMarkPageIndices[0];
        performNavigation(nextIdx);
    }, [lostMarkPageIndices, currentImageIndex, performNavigation]);

    const handleExplainActiveQuestion = useCallback(async () => {
        if (!onSendFollowUpMessage || isProcessingFollowUp) return;
        const qNum = activeQuestionMeta?.questionNumber;
        const promptText = qNum
            ? (activeQuestionMeta?.awardedMarks !== null &&
               activeQuestionMeta?.totalMarks &&
               activeQuestionMeta.awardedMarks < activeQuestionMeta.totalMarks
                ? `Explain Question ${qNum} step-by-step and show how to get full marks (${activeQuestionMeta.totalMarks}/${activeQuestionMeta.totalMarks}).`
                : `Explain Question ${qNum} step-by-step.`)
            : `Explain the marking on page ${currentImageIndex + 1} step-by-step.`;

        if (isMobile) {
            setHasRequestedInViewerFollowUp(true);
            setIsSheetDismissed(false);
            setIsSheetCollapsed(false);
        }
        await onSendFollowUpMessage(promptText, qNum || null);
    }, [onSendFollowUpMessage, isProcessingFollowUp, activeQuestionMeta, currentImageIndex, isMobile]);

    const handleMobileChatSubmit = useCallback(async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const trimmed = mobileInputText.trim();
        if (!trimmed || !onSendFollowUpMessage || isProcessingFollowUp) return;

        const qNum = activeQuestionMeta?.questionNumber || null;
        setMobileInputText('');
        setHasRequestedInViewerFollowUp(true);
        setIsSheetDismissed(false);
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

    if (!currentImage) {
        return null;
    }

    const activeBadgeColorClass = useMemo(() => {
        if (!activeQuestionMeta || activeQuestionMeta.awardedMarks === null || activeQuestionMeta.totalMarks <= 0) {
            return 'neutral';
        }
        if (activeQuestionMeta.awardedMarks === activeQuestionMeta.totalMarks) return 'green';
        if (activeQuestionMeta.awardedMarks === 0) return 'red';
        return 'yellow';
    }, [activeQuestionMeta]);

    const showMobileResponseSheet = Boolean(
        isMobile &&
        onSendFollowUpMessage &&
        !isSheetDismissed &&
        (isProcessingFollowUp || (latestFollowUpResponse && (hasRequestedInViewerFollowUp || latestFollowUpResponse.content)))
    );

    return (
        <div className={`image-viewer-root ${isMobile && onSendFollowUpMessage ? 'has-mobile-chat' : ''}`} role="region" aria-label="Image viewer">
            <div className="image-mode-header">
                <div className="image-mode-controls">
                    {images.length > 1 && (
                        <>
                            <div className="page-stepper-controls" role="group" aria-label="Page navigation">
                                <button
                                    type="button"
                                    className="page-step-btn"
                                    onClick={navigateToPrevious}
                                    aria-label="Previous page"
                                    title="Previous page (↑)"
                                >
                                    <ArrowUp size={16} />
                                </button>
                                <button
                                    type="button"
                                    className="page-step-btn"
                                    onClick={navigateToNext}
                                    aria-label="Next page"
                                    title="Next page (↓)"
                                >
                                    <ArrowDown size={16} />
                                </button>
                                <span className="page-step-counter">
                                    {currentImageIndex + 1} / {images.length}
                                </span>
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
                            <button
                                type="button"
                                className="next-mistake-btn"
                                onClick={handleNextMistake}
                                title="Jump to next mistake page"
                            >
                                <span>Next Mistake</span>
                            </button>
                            <div className="control-separator" />
                        </>
                    )}
                    {!isMobile && onSendFollowUpMessage && activeQuestionMeta && (
                        <>
                            <button
                                type="button"
                                className="viewer-explain-btn"
                                onClick={handleExplainActiveQuestion}
                                disabled={isProcessingFollowUp}
                                title={`Ask AI to explain Question ${activeQuestionMeta.questionNumber} in the chat panel`}
                            >
                                <Sparkles size={14} />
                                <span>Explain Q{activeQuestionMeta.questionNumber}</span>
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
                    <button type="button" className="download-btn" onClick={onDownload} disabled={isDownloading || isZipping} aria-label="Download image" title="Download current page"><Download size={20} /><span>{isDownloading ? 'Downloading...' : (images.length > 1 ? 'Page' : 'Download')}</span></button>
                    {images.length > 1 && (
                        <>
                            <div className="control-separator" />
                            <button
                                type="button"
                                className="download-all-btn"
                                onClick={onDownloadAll}
                                disabled={isZipping || isDownloading}
                                aria-label="Download all pages as ZIP archive"
                                title="Download all pages in a .zip archive"
                            >
                                <Archive size={20} />
                                <span>{isZipping ? `Zipping ${zipProgress}` : 'All (.zip)'}</span>
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

                {showMobileResponseSheet && (
                    <div className={`viewer-mobile-response-sheet ${isSheetCollapsed ? 'collapsed' : 'expanded'}`}>
                        <div className="viewer-mobile-sheet-header" onClick={() => setIsSheetCollapsed(prev => !prev)}>
                            <div className="viewer-mobile-sheet-title">
                                <Sparkles size={14} />
                                <span>
                                    {isProcessingFollowUp
                                        ? `Thinking${activeQuestionMeta ? ` about Q${activeQuestionMeta.questionNumber}` : ''}...`
                                        : `AI Explanation${latestFollowUpResponse?.questionNumber ? ` · Q${latestFollowUpResponse.questionNumber}` : ''}`}
                                </span>
                            </div>
                            <div className="viewer-mobile-sheet-actions" onClick={e => e.stopPropagation()}>
                                <button
                                    type="button"
                                    className="viewer-sheet-icon-btn"
                                    onClick={() => setIsSheetCollapsed(prev => !prev)}
                                    aria-label={isSheetCollapsed ? 'Expand AI response' : 'Collapse AI response'}
                                >
                                    {isSheetCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                                <button
                                    type="button"
                                    className="viewer-sheet-icon-btn"
                                    onClick={() => setIsSheetDismissed(true)}
                                    aria-label="Dismiss AI response"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                        {!isSheetCollapsed && (
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
                        )}
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
                            className="viewer-mobile-explain-chip"
                            onClick={handleExplainActiveQuestion}
                            disabled={isProcessingFollowUp}
                        >
                            <Sparkles size={12} />
                            <span>
                                {activeQuestionMeta ? `Explain Q${activeQuestionMeta.questionNumber}` : 'Explain Page'}
                            </span>
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
