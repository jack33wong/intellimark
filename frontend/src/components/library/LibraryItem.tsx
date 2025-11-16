/**
 * Library Item Component
 * Displays a single session card with thumbnails
 */

import React, { useState } from 'react';
import './LibraryItem.css';
import type { LibraryItem as LibraryItemType } from '../../pages/LibraryPage';

interface LibraryItemProps {
  item: LibraryItemType;
  onThumbnailClick: (item: LibraryItemType, imageIndex: number) => void;
}

const LibraryItem: React.FC<LibraryItemProps> = ({ item, onThumbnailClick }) => {
  const [expandedFiles, setExpandedFiles] = useState<boolean>(false);
  
  // Show first 4 thumbnails, rest in dropdown
  const visibleThumbnails = item.images.slice(0, 4);
  const totalImages = item.images.length;
  const remainingCount = totalImages > 4 ? totalImages - 4 : 0;

  // Truncate title if more than 30 words
  const truncateTitle = (title: string, maxWords: number = 30): string => {
    const words = title.split(/\s+/);
    if (words.length > maxWords) {
      return words.slice(0, maxWords).join(' ') + '...';
    }
    return title;
  };

  const displayTitle = truncateTitle(item.sessionTitle);

  return (
    <div className="library-item">
      <div className="library-item-header">
        <div className="library-item-top-row">
          <span className="library-item-date">{item.date}</span>
          {item.studentScore && (
            <div className="library-item-score">
              {item.studentScore.scoreText}
            </div>
          )}
        </div>
        <div className="library-item-title-wrapper">
          <h3 className="library-item-title">{displayTitle}</h3>
        </div>
      </div>

      <div className="library-item-thumbnails">
        {visibleThumbnails.map((image, index) => (
          <div
            key={image.id}
            className="library-thumbnail"
            onClick={() => onThumbnailClick(item, index)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onThumbnailClick(item, index);
              }
            }}
            aria-label={`View image ${index + 1} of ${totalImages}`}
          >
            <img
              src={image.src}
              alt={image.alt || image.filename || `Image ${index + 1}`}
              className="thumbnail-image"
              loading="lazy"
              onError={(e) => {
                console.warn('Failed to load thumbnail image:', image.src);
                // Hide the thumbnail if image fails to load
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        ))}

        {remainingCount > 0 && !expandedFiles && (
          <button
            className="more-files-btn"
            onClick={() => setExpandedFiles(true)}
            aria-label={`Show ${remainingCount} more files`}
          >
            <span>{remainingCount} more files</span>
          </button>
        )}

        {expandedFiles && (
          <>
            {item.images.slice(4).map((image, index) => (
              <div
                key={image.id}
                className="library-thumbnail"
                onClick={() => onThumbnailClick(item, index + 4)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onThumbnailClick(item, index + 4);
                  }
                }}
                aria-label={`View image ${index + 5} of ${totalImages}`}
              >
                <img
                  src={image.src}
                  alt={image.alt || image.filename || `Image ${index + 5}`}
                  className="thumbnail-image"
                  loading="lazy"
                  onError={(e) => {
                    console.warn('Failed to load thumbnail image:', image.src);
                    // Hide the thumbnail if image fails to load
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            ))}
            <button
              className="collapse-files-btn"
              onClick={() => setExpandedFiles(false)}
              aria-label="Collapse files"
            >
              Show less
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default LibraryItem;

