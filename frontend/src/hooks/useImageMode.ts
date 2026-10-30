/**
 * Single hook for Image Mode functionality
 * Handles all state management, zoom, drag, and utilities
 */

import { useState, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
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
  isZipping: boolean;
  zipProgress: string;

  // Actions
  zoomIn: () => void;
  zoomOut: () => void;
  rotate: () => void;
  resetAll: () => void;

  // Drag handlers
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: MouseEvent) => void;
  handleMouseUp: () => void;

  // Touch handlers
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchMove: (e: TouchEvent) => void;
  handleTouchEnd: () => void;

  // Image handlers
  handleImageLoad: () => void;
  handleImageError: () => void;
  handleDownload: (image: SessionImage) => Promise<void>;
  handleDownloadAllZip: (images: SessionImage[], zipBaseName?: string) => Promise<void>;

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
  const [pinchStartDistance, setPinchStartDistance] = useState<number | null>(null);
  const [pinchStartZoom, setPinchStartZoom] = useState(DEFAULT_ZOOM);
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState('');

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
      // Find the first zoom level greater than current
      const nextLevel = ZOOM_LEVELS.find(level => level > prev);
      const newZoom = nextLevel || prev;
      if (newZoom !== prev) {
        setTranslateX(0);
        setTranslateY(0);
      }
      return newZoom;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => {
      // Find the last zoom level smaller than current
      const prevLevel = [...ZOOM_LEVELS].reverse().find(level => level < prev);
      const newZoom = prevLevel || prev;
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

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      setDragStart({ x: touch.clientX - translateX, y: touch.clientY - translateY });
      setPinchStartDistance(null);
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      const distance = Math.max(1, Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      ));
      setPinchStartDistance(distance);
      setPinchStartZoom(zoomLevel);
    }
  }, [translateX, translateY, zoomLevel]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (e.touches.length === 1 && isDragging) {
      e.preventDefault();
      const touch = e.touches[0];
      const newTranslateX = touch.clientX - dragStart.x;
      const newTranslateY = touch.clientY - dragStart.y;

      const maxTranslateX = window.innerWidth * 0.4;
      const maxTranslateY = window.innerHeight * 0.4;
      const boundedX = Math.max(-maxTranslateX, Math.min(maxTranslateX, newTranslateX));
      const boundedY = Math.max(-maxTranslateY, Math.min(maxTranslateY, newTranslateY));

      setTranslateX(boundedX);
      setTranslateY(boundedY);
    } else if (e.touches.length === 2 && pinchStartDistance !== null) {
      e.preventDefault();
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = distance / pinchStartDistance;
      const newZoom = Math.round(pinchStartZoom * ratio);

      // Keep within bounds
      const minZoom = ZOOM_LEVELS[0];
      const maxZoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
      setZoomLevel(Math.max(minZoom, Math.min(maxZoom, newZoom)));
    }
  }, [isDragging, dragStart, pinchStartDistance, pinchStartZoom]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    setPinchStartDistance(null);
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
      let downloadFilename = image.filename || 'annotated-image';
      // Ensure image downloads never have a .pdf extension
      if (downloadFilename.toLowerCase().endsWith('.pdf')) {
        const pageSuffix = image.pageIndex !== undefined ? `_page_${image.pageIndex + 1}` : '';
        downloadFilename = downloadFilename.replace(/\.pdf$/i, `${pageSuffix}.jpg`);
      }
      if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(downloadFilename)) {
        downloadFilename += '.jpg';
      }

      if (image.src.startsWith('data:')) {
        // Base64 data URL
        const response = await fetch(image.src);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = downloadFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } else {
        // External URL - use backend proxy
        const backendUrl = process.env.REACT_APP_API_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5001');
        const downloadUrl = `${backendUrl}/api/marking/download-image?url=${encodeURIComponent(image.src)}&filename=${encodeURIComponent(downloadFilename)}`;

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = downloadFilename;
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

  // Download all images in a zip archive (supports desktop and mobile)
  const handleDownloadAllZip = useCallback(async (images: SessionImage[], zipBaseName: string = 'annotated_homework') => {
    if (!images || images.length === 0 || isZipping) return;

    setIsZipping(true);
    setZipProgress(`(0/${images.length})`);

    try {
      const zip = new JSZip();
      const backendUrl = process.env.REACT_APP_API_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5001');

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        setZipProgress(`(${i + 1}/${images.length})`);

        let blob: Blob | null = null;
        if (img.src.startsWith('data:')) {
          const response = await fetch(img.src);
          blob = await response.blob();
        } else {
          try {
            const response = await fetch(img.src);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            blob = await response.blob();
          } catch (fetchErr) {
            // Fallback: proxy via backend if CORS blocks reading the image
            const proxyUrl = `${backendUrl}/api/marking/download-image?url=${encodeURIComponent(img.src)}`;
            const response = await fetch(proxyUrl);
            blob = await response.blob();
          }
        }

        if (blob) {
          let filename = img.filename || `image_page_${i + 1}.jpg`;
          if (filename.toLowerCase().endsWith('.pdf')) {
            filename = filename.replace(/\.pdf$/i, `_page_${i + 1}.jpg`);
          }
          if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(filename)) {
            filename += '.jpg';
          }
          // Ensure page number uniqueness if filenames are identical
          if (!filename.includes(`page_${i + 1}`) && !filename.includes(`p${i + 1}`)) {
            const dotIdx = filename.lastIndexOf('.');
            const base = dotIdx > 0 ? filename.substring(0, dotIdx) : filename;
            const ext = dotIdx > 0 ? filename.substring(dotIdx) : '.jpg';
            filename = `${base}_page_${i + 1}${ext}`;
          }
          zip.file(filename, blob);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = window.URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      const cleanZipName = zipBaseName.replace(/\.zip$/i, '');
      link.download = `${cleanZipName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate zip file:', err);
    } finally {
      setIsZipping(false);
      setZipProgress('');
    }
  }, [isZipping]);

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
    isZipping,
    zipProgress,

    // Actions
    zoomIn,
    zoomOut,
    rotate,
    resetAll,

    // Drag handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,

    // Touch handlers
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,

    // Image handlers
    handleImageLoad,
    handleImageError,
    handleDownload,
    handleDownloadAllZip,

    // Utils
    calculateTransform,
    canZoomIn,
    canZoomOut
  };
};
