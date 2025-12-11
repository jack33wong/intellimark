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
}

const ImageViewer: React.FC<ImageViewerProps> = ({
    images,
    initialImageIndex,
    onClose,
    isOpen = true
}) => {
    const [currentImageIndex, setCurrentImageIndex] = React.useState(initialImageIndex);
    const imageRef = useRef<HTMLImageElement>(null);

    // Update internal state if initial prop changes (e.g. parent switching images)
    useEffect(() => {
        setCurrentImageIndex(initialImageIndex);
    }, [initialImageIndex]);

    // Use single hook for all functionality
    // Note: we pass isOpen=true because if this component is rendered, it's "open"
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

    const currentImage = images[currentImageIndex];

    const navigateToPrevious = useCallback(() => {
        if (images.length > 1) {
            setCurrentImageIndex(prev =>
                prev === 0 ? images.length - 1 : prev - 1
            );
        }
    }, [images.length]);

    const navigateToNext = useCallback(() => {
        if (images.length > 1) {
            setCurrentImageIndex(prev =>
                prev === images.length - 1 ? 0 : prev + 1
            );
        }
    }, [images.length]);

    const handleImageClick = useCallback((index: number) => {
        setCurrentImageIndex(index);
    }, []);

    const onDownload = useCallback(async () => {
        if (!currentImage) return;
        await handleDownload(currentImage);
    }, [currentImage, handleDownload]);

    // Handle keyboard navigation
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle events if we have focus or global listener
            // In split mode, we might want to restrict this to when hovering?
            // For now, keep existing behavior but be mindful of conflicts with chat input

            // We'll skip keys if the active element is an input or textarea
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

    if (!currentImage) {
        return null;
    }

    return (
        <div className="image-mode-modal" role="region" aria-label="Image viewer" style={{ position: 'relative', height: '100%', zIndex: 1, inset: 0 }}>
            {/* Header with controls */}
            <div className="image-mode-header">
                <div className="image-mode-controls">
                    {/* Zoom controls */}
                    <div className="zoom-controls">
                        <button
                            type="button"
                            className="zoom-btn"
                            onClick={zoomOut}
                            disabled={!canZoomOut}
                            aria-label="Zoom out"
                        >
                            <ZoomOut size={20} />
                        </button>
                        <div className="zoom-level">{zoomLevel}%</div>
                        <button
                            type="button"
                            className="zoom-btn"
                            onClick={zoomIn}
                            disabled={!canZoomIn}
                            aria-label="Zoom in"
                        >
                            <ZoomIn size={20} />
                        </button>
                    </div>

                    {/* Separator */}
                    <div className="control-separator" />

                    {/* Rotate button */}
                    <button
                        type="button"
                        className="rotate-btn"
                        onClick={rotate}
                        aria-label="Rotate image"
                    >
                        <RotateCw size={20} />
                    </button>

                    {/* Separator */}
                    <div className="control-separator" />

                    {/* Download button */}
                    <button
                        type="button"
                        className="download-btn"
                        onClick={onDownload}
                        disabled={isDownloading}
                        aria-label="Download image"
                    >
                        <Download size={20} />
                        <span>{isDownloading ? 'Downloading...' : 'Download'}</span>
                    </button>
                </div>

                {/* Close button */}
                <button
                    type="button"
                    className="close-btn"
                    onClick={onClose}
                    aria-label="Close image viewer"
                >
                    <X size={20} />
                </button>
            </div>

            {/* Main content area */}
            <div className="image-mode-content">
                {/* Image display */}
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
                            <button onClick={() => window.location.reload()}>
                                Try again
                            </button>
                        </div>
                    )}

                    {!imageError && (
                        <img
                            ref={imageRef}
                            src={currentImage.src}
                            alt={currentImage.alt}
                            className="main-image"
                            style={{
                                transform: calculateTransform(),
                                transformOrigin: 'center center'
                            }}
                            onLoad={handleImageLoad}
                            onError={handleImageError}
                            onMouseDown={handleMouseDown}
                            draggable={false}
                        />
                    )}
                </div>

                {/* Thumbnail sidebar */}
                {images.length > 1 && (
                    <div className="thumbnail-sidebar">
                        <div className="thumbnail-list">
                            {images.map((image, index) => (
                                <button
                                    key={image.id}
                                    type="button"
                                    className={`thumbnail-btn ${index === currentImageIndex ? 'active' : ''}`}
                                    onClick={() => handleImageClick(index)}
                                    aria-label={`View image ${index + 1}`}
                                >
                                    <img
                                        src={image.src}
                                        alt={image.alt}
                                        className="modal-thumbnail-image"
                                        draggable={false}
                                    />
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
