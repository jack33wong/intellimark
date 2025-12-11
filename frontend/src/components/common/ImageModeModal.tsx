// Simplified ImageModeModal now uses the shared ImageViewer component
import React, { useRef, useEffect, useCallback } from 'react';
import type { SessionImage } from '../../utils/imageCollectionUtils';
import ImageViewer from './ImageViewer';
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
  const scrollPositionRef = useRef<number>(0);

  // Store scroll position when opening
  useEffect(() => {
    if (isOpen) {
      scrollPositionRef.current = window.scrollY;
    }
  }, [isOpen]);

  const handleClose = useCallback(() => {
    window.scrollTo(0, scrollPositionRef.current);
    onClose();
  }, [onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="image-mode-modal" role="dialog" aria-label="Image viewer">
      <ImageViewer
        images={images}
        initialImageIndex={initialImageIndex}
        onClose={handleClose}
      />
    </div>
  );
};

export default ImageModeModal;
