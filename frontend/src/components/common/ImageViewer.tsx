/**
 * ImageViewer Component
 * 
 * Reusable full-control image viewer (Zoom, Pan, Rotate, Download)
 * Used by both ImageModeModal and SplitView
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, Download, RotateCw } from 'lucide-react';
import type { SessionImage } from '../../utils/imageCollectionUtils';
import { useImageMode } from '../../hooks/useImageMode';
import './ImageModeModal.css'; // Reusing existing styles for now

interface ImageViewerProps {
    images: SessionImage[];
    initialImageIndex: number;
    onClose: () => void;
    isOpen?: boolean; // Optional, defaults to true if mounted
    onImageChange?: (index: number) => void;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
    images,
    initialImageIndex,
    onClose,
    isOpen = true,
    onImageChange
}) => {
    const [currentImageIndex, setCurrentImageIndex] = React.useState(initialImageIndex);
    const imageRef = useRef<HTMLImageElement>(null);

    // Update internal state if initial prop changes (e.g. parent switching images)
    // We use a ref to track the last prop value to prevent redundant sets
    const lastPropIndexRef = useRef(initialImageIndex);
    useEffect(() => {
        if (initialImageIndex !== lastPropIndexRef.current) {
            setCurrentImageIndex(initialImageIndex);
            lastPropIndexRef.current = initialImageIndex;
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
        zoomIn,
        zoomOut,
        rotate,
        handleMouseDown,
        handleMouseMove,
        handleMouseUp,
        handleImageLoad,
        handleImageError,
        handleDownload,
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
        if (onImageChange) {
            onImageChange(newIndex);
        }
    }, [onImageChange]);

    const navigateToPrevious = useCallback(() => {
        if (images.length > 1) {
            const newIndex = currentImageIndex === 0 ? images.length - 1 : currentImageIndex - 1;
            performNavigation(newIndex);
        }
    }, [images.length, currentImageIndex, performNavigation]);

    const navigateToNext = useCallback(() => {
        if (images.length > 1) {
            const newIndex = currentImageIndex === images.length - 1 ? 0 : currentImageIndex + 1;
            performNavigation(newIndex);
        }
    }, [images.length, currentImageIndex, performNavigation]);

    const handleImageClick = useCallback((index: number) => {
        performNavigation(index);
    }, [performNavigation]);

    const onDownload = useCallback(async () => {
        if (!currentImage) return;
        await handleDownload(currentImage);
    }, [currentImage, handleDownload]);

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
                    e.preventDefault();
                    navigateToPrevious();
                    break;
                case 'ArrowRight':
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

    return (
        <div className="image-mode-modal" role="region" aria-label="Image viewer" style={{ position: 'relative', height: '100%', zIndex: 1, inset: 0 }}>
            <div className="image-mode-header">
                <div className="image-mode-controls">
                    <div className="zoom-controls">
                        <button type="button" className="zoom-btn" onClick={zoomOut} disabled={!canZoomOut} aria-label="Zoom out"><ZoomOut size={20} /></button>
                        <div className="zoom-level">{zoomLevel}%</div>
                        <button type="button" className="zoom-btn" onClick={zoomIn} disabled={!canZoomIn} aria-label="Zoom in"><ZoomIn size={20} /></button>
                    </div>
                    <div className="control-separator" />
                    <button type="button" className="rotate-btn" onClick={rotate} aria-label="Rotate image"><RotateCw size={20} /></button>
                    <div className="control-separator" />
                    <button type="button" className="download-btn" onClick={onDownload} disabled={isDownloading} aria-label="Download image"><Download size={20} /><span>{isDownloading ? 'Downloading...' : 'Download'}</span></button>
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
                            draggable={false}
                        />
                    )}
                </div>

                {images.length > 1 && (
                    <div className="thumbnail-sidebar">
                        <div className="thumbnail-list" ref={thumbnailListRef}>
                            {images.map((image, index) => (
                                <button
                                    key={image.id || index}
                                    id={`thumb-btn-${index}`}
                                    ref={el => thumbnailRefs.current[index] = el}
                                    type="button"
                                    className={`thumbnail-btn ${index === currentImageIndex ? 'active' : ''}`}
                                    onClick={() => handleImageClick(index)}
                                    aria-label={`View image ${index + 1}`}
                                >
                                    <img src={image.src} alt={image.alt} className="modal-thumbnail-image" draggable={false} />
                                    {image.badgeText && <span className={`thumbnail-badge ${image.badgeColor || 'neutral'}`}>{image.badgeText}</span>}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImageViewer;
