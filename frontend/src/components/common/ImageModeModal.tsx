/**
 * Image Mode Modal Component
 * 
 * Full-screen image viewer with zoom controls, download, and thumbnail navigation
 * Simplified with single useImageMode hook
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, Download, RotateCw } from 'lucide-react';
import type { SessionImage } from '../../utils/imageCollectionUtils';
import { useImageMode } from '../../hooks/useImageMode';
import './ImageModeModal.css';

interface ImageModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: SessionImage[];
  initialImageIndex: number;
}

const ImageModeModal: React.FC<ImageModeModalProps> = ({
  isOpen,
  onClose,
  images,
  initialImageIndex
}) => {
  const [currentImageIndex, setCurrentImageIndex] = React.useState(initialImageIndex);
  const imageRef = useRef<HTMLImageElement>(null);
  const scrollPositionRef = useRef<number>(0);

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

  const currentImage = images[currentImageIndex];

  const handleClose = useCallback(() => {
    window.scrollTo(0, scrollPositionRef.current);
    onClose();
  }, [onClose]);

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

  // Store scroll position when opening
  useEffect(() => {
    if (isOpen) {
      scrollPositionRef.current = window.scrollY;
    }
  }, [isOpen]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          handleClose();
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
  }, [isOpen, currentImageIndex, zoomLevel, zoomIn, zoomOut, rotate, handleClose, navigateToNext, navigateToPrevious]);

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

  if (!isOpen || !currentImage) {
    return null;
  }

  return (
    <div className="image-mode-modal" role="dialog" aria-label="Image viewer">
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
          onClick={handleClose}
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
                    className="thumbnail-image"
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

export default ImageModeModal;
