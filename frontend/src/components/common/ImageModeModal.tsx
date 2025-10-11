/**
 * Image Mode Modal Component
 * 
 * Full-screen image viewer with zoom controls, download, and thumbnail navigation
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, ZoomIn, ZoomOut, Download, RotateCw } from 'lucide-react';
import type { SessionImage } from '../../utils/imageCollectionUtils';
import './ImageModeModal.css';

interface ImageModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: SessionImage[];
  initialImageIndex: number;
}

const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 175, 200];
const DEFAULT_ZOOM = 100;

const ImageModeModal: React.FC<ImageModeModalProps> = ({
  isOpen,
  onClose,
  images,
  initialImageIndex
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(initialImageIndex);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const scrollPositionRef = useRef<number>(0);

  // Store scroll position when opening
  useEffect(() => {
    if (isOpen) {
      scrollPositionRef.current = window.scrollY;
    }
  }, [isOpen]);

  // Reset zoom and rotation when switching images
  useEffect(() => {
    setZoomLevel(DEFAULT_ZOOM);
    setRotation(0);
    setImageError(false);
    setIsLoading(true);
  }, [currentImageIndex]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentImageIndex, zoomLevel]);

  const currentImage = images[currentImageIndex];

  const handleClose = useCallback(() => {
    // Restore scroll position
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

  const zoomIn = useCallback(() => {
    setZoomLevel(prev => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      return currentIndex < ZOOM_LEVELS.length - 1 
        ? ZOOM_LEVELS[currentIndex + 1] 
        : prev;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      return currentIndex > 0 
        ? ZOOM_LEVELS[currentIndex - 1] 
        : prev;
    });
  }, []);

  const rotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);


  const handleImageClick = useCallback((index: number) => {
    setCurrentImageIndex(index);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!currentImage || isDownloading) return;

    setIsDownloading(true);

    try {
      // For base64 data URLs, use the fetch approach
      if (currentImage.src.startsWith('data:')) {
        const response = await fetch(currentImage.src);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = currentImage.filename || 'image';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        // For Firebase Storage URLs and other external URLs, use backend proxy
        const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';
        const downloadUrl = `${backendUrl}/api/mark-homework/download-image?url=${encodeURIComponent(currentImage.src)}&filename=${encodeURIComponent(currentImage.filename || 'image')}`;
        
        // Create a temporary link to trigger download
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = currentImage.filename || 'image';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Failed to download image:', error);
      // Fallback: open in new tab so user can right-click and save
      const link = document.createElement('a');
      link.href = currentImage.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsDownloading(false);
    }
  }, [currentImage, isDownloading]);

  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    setImageError(false);
  }, []);

  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setImageError(true);
  }, []);

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
              disabled={zoomLevel === ZOOM_LEVELS[0]}
              aria-label="Zoom out"
            >
              <ZoomOut size={20} />
            </button>
            <div className="zoom-level">{zoomLevel}%</div>
            <button
              type="button"
              className="zoom-btn"
              onClick={zoomIn}
              disabled={zoomLevel === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
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
            onClick={handleDownload}
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
              <button onClick={() => setImageError(false)}>
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
                transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`,
                transformOrigin: 'center center'
              }}
              onLoad={handleImageLoad}
              onError={handleImageError}
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
