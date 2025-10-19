/**
 * Single hook for Image Mode functionality
 * Handles all state management, zoom, drag, and utilities
 */

import { useState, useCallback, useEffect } from 'react';
import type { SessionImage } from '../utils/imageCollectionUtils';

const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 175, 200];
const DEFAULT_ZOOM = 100;

interface UseImageModeProps {
  isOpen: boolean;
  currentImageIndex: number;
}

interface UseImageModeReturn {
  // State
  zoomLevel: number;
  rotation: number;
  translateX: number;
  translateY: number;
  isDragging: boolean;
  imageError: boolean;
  isLoading: boolean;
  isDownloading: boolean;
  
  // Actions
  zoomIn: () => void;
  zoomOut: () => void;
  rotate: () => void;
  resetAll: () => void;
  
  // Drag handlers
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: MouseEvent) => void;
  handleMouseUp: () => void;
  
  // Image handlers
  handleImageLoad: () => void;
  handleImageError: () => void;
  handleDownload: (image: SessionImage) => Promise<void>;
  
  // Utils
  calculateTransform: () => string;
  canZoomIn: boolean;
  canZoomOut: boolean;
}

export const useImageMode = ({ isOpen, currentImageIndex }: UseImageModeProps): UseImageModeReturn => {
  // State
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  // Reset all state
  const resetAll = useCallback(() => {
    setZoomLevel(DEFAULT_ZOOM);
    setRotation(0);
    setTranslateX(0);
    setTranslateY(0);
    setImageError(false);
    setIsLoading(true);
  }, []);

  // Reset when image mode opens or image changes
  useEffect(() => {
    if (isOpen) {
      setTranslateX(0);
      setTranslateY(0);
    }
  }, [isOpen]);

  useEffect(() => {
    resetAll();
  }, [currentImageIndex, resetAll]);

  // Zoom functions
  const zoomIn = useCallback(() => {
    setZoomLevel(prev => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      const newZoom = currentIndex < ZOOM_LEVELS.length - 1 
        ? ZOOM_LEVELS[currentIndex + 1] 
        : prev;
      if (newZoom !== prev) {
        setTranslateX(0);
        setTranslateY(0);
      }
      return newZoom;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      const newZoom = currentIndex > 0 
        ? ZOOM_LEVELS[currentIndex - 1] 
        : prev;
      if (newZoom !== prev) {
        setTranslateX(0);
        setTranslateY(0);
      }
      return newZoom;
    });
  }, []);

  const rotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - translateX, y: e.clientY - translateY });
  }, [translateX, translateY]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const newTranslateX = e.clientX - dragStart.x;
    const newTranslateY = e.clientY - dragStart.y;
    
    // Apply boundaries
    const maxTranslateX = window.innerWidth * 0.4;
    const maxTranslateY = window.innerHeight * 0.4;
    
    const boundedX = Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslateX));
    const boundedY = Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslateY));
    
    setTranslateX(boundedX);
    setTranslateY(boundedY);
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Image handlers
  const handleImageLoad = useCallback(() => {
    setIsLoading(false);
    setImageError(false);
  }, []);

  const handleImageError = useCallback(() => {
    setIsLoading(false);
    setImageError(true);
  }, []);

  // Download function
  const handleDownload = useCallback(async (image: SessionImage) => {
    if (!image || isDownloading) return;

    setIsDownloading(true);

    try {
      if (image.src.startsWith('data:')) {
        // Base64 data URL
        const response = await fetch(image.src);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = image.filename || 'image';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        // External URL - use backend proxy
        const backendUrl = process.env.REACT_APP_API_URL || 'http://localhost:5001';
        const downloadUrl = `${backendUrl}/api/marking/download-image?url=${encodeURIComponent(image.src)}&filename=${encodeURIComponent(image.filename || 'image')}`;
        
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = image.filename || 'image';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Failed to download image:', error);
      // Fallback: open in new tab
      const link = document.createElement('a');
      link.href = image.src;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading]);

  // Utils
  const calculateTransform = useCallback(() => {
    return `translate(${translateX}px, ${translateY}px) scale(${zoomLevel / 100}) rotate(${rotation}deg)`;
  }, [translateX, translateY, zoomLevel, rotation]);

  const canZoomIn = zoomLevel < ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  const canZoomOut = zoomLevel > ZOOM_LEVELS[0];

  return {
    // State
    zoomLevel,
    rotation,
    translateX,
    translateY,
    isDragging,
    imageError,
    isLoading,
    isDownloading,
    
    // Actions
    zoomIn,
    zoomOut,
    rotate,
    resetAll,
    
    // Drag handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    
    // Image handlers
    handleImageLoad,
    handleImageError,
    handleDownload,
    
    // Utils
    calculateTransform,
    canZoomIn,
    canZoomOut
  };
};
