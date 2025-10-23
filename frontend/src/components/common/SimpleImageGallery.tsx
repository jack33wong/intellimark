import React, { useState } from 'react';
import './SimpleImageGallery.css';

interface SimpleImageGalleryProps {
  images: string[];
  onImageClick?: (index: number) => void;
  className?: string;
}

const SimpleImageGallery: React.FC<SimpleImageGalleryProps> = ({
  images,
  onImageClick,
  className = ''
}) => {
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());

  if (!images || images.length === 0) {
    return null;
  }

  const handleImageError = (index: number, imageSrc: string) => {
    console.error(`Failed to load image ${index + 1}:`, imageSrc);
    setImageErrors(prev => new Set(prev).add(index));
  };

  const getImageSrc = (image: string) => {
    // Handle both base64 data URLs and Firebase Storage links
    if (image.startsWith('data:') || image.startsWith('http')) {
      return image;
    }
    // If it's not a valid URL format, assume it's base64 and add data URL prefix
    if (image && !image.includes('://')) {
      return `data:image/png;base64,${image}`;
    }
    return image;
  };

  return (
    <div className={`thumbnail-grid ${className}`}>
      {images.map((image, index) => {
        const imageSrc = getImageSrc(image);
        const hasError = imageErrors.has(index);
        
        return (
          <div
            key={index}
            className="thumbnail-item"
            onClick={() => onImageClick?.(index)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onImageClick?.(index);
              }
            }}
          >
            {!hasError ? (
              <img
                src={imageSrc}
                alt={`Gallery image ${index + 1}`}
                className="thumbnail-image"
                onError={() => handleImageError(index, imageSrc)}
                onLoad={() => {
                  // Remove from error set if it loads successfully
                  setImageErrors(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(index);
                    return newSet;
                  });
                }}
              />
            ) : (
              <div className="thumbnail-error">
                <span>Failed to load</span>
              </div>
            )}
            <div className="thumbnail-overlay">
              <span className="thumbnail-label">Page {index + 1}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SimpleImageGallery;