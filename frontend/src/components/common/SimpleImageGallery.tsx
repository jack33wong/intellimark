import React from 'react';
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
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className={`thumbnail-grid ${className}`}>
      {images.map((image, index) => (
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
          <img
            src={image}
            alt={`Gallery image ${index + 1}`}
            className="thumbnail-image"
          />
          <div className="thumbnail-overlay">
            <span className="thumbnail-label">Page {index + 1}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default SimpleImageGallery;
