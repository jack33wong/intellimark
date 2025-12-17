import React, { useState, useEffect } from 'react';
import { Grid, List } from 'lucide-react';
import './SimpleImageGallery.css';

interface SimpleImageGalleryProps {
  images: (string | { url: string; originalFileName?: string; fileSize?: number })[];
  onImageClick?: (index: number) => void;
  className?: string;
  showViewToggle?: boolean; // New prop to show/hide view toggle
}

const SimpleImageGallery: React.FC<SimpleImageGalleryProps> = ({
  images,
  onImageClick,
  className = '',
  showViewToggle = false
}) => {
  const [imageErrors, setImageErrors] = useState<Set<number>>(new Set());

  // Read initial view mode from localStorage
  const [viewMode, setViewMode] = useState<'grid' | 'horizontal'>(() => {
    const saved = localStorage.getItem('galleryViewMode');
    return (saved as 'grid' | 'horizontal') || 'grid';
  });

  // Listen for changes from Settings modal
  useEffect(() => {
    const handleViewModeChange = (event: CustomEvent) => {
      setViewMode(event.detail as 'grid' | 'horizontal');
    };

    window.addEventListener('galleryViewModeChanged', handleViewModeChange as EventListener);

    return () => {
      window.removeEventListener('galleryViewModeChanged', handleViewModeChange as EventListener);
    };
  }, []);

  if (!images || images.length === 0) {
    return null;
  }

  const handleImageError = (index: number, imageSrc: string) => {
    console.error(`Failed to load image ${index + 1}:`, imageSrc);
    setImageErrors(prev => new Set(prev).add(index));
  };

  const getImageSrc = (image: string | { url: string; originalFileName?: string; fileSize?: number }) => {
    // Handle both old format (string) and new format (object)
    const imageSrc = typeof image === 'string' ? image : image.url;

    // Handle both base64 data URLs and Firebase Storage links
    if (imageSrc.startsWith('data:') || imageSrc.startsWith('http')) {
      return imageSrc;
    }
    // If it's not a valid URL format, assume it's base64 and add data URL prefix
    if (imageSrc && !imageSrc.includes('://')) {
      return `data:image/png;base64,${imageSrc}`;
    }
    return imageSrc;
  };

  const gridClass = viewMode === 'horizontal' ? 'thumbnail-horizontal' : 'thumbnail-grid';

  return (
    <div className="gallery-container">
      {showViewToggle && (
        <div className="gallery-view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => setViewMode('grid')}
            title="Grid View"
          >
            <Grid size={16} />
          </button>
          <button
            className={`view-toggle-btn ${viewMode === 'horizontal' ? 'active' : ''}`}
            onClick={() => setViewMode('horizontal')}
            title="Horizontal View"
          >
            <List size={16} />
          </button>
        </div>
      )}
      <div className={`${gridClass} ${className}`}>
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
                  alt={`Gallery item ${index + 1}`}
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
    </div>
  );
};

export default SimpleImageGallery;