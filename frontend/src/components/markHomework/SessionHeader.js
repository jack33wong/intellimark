/**
 * Session Header Component
 * Displays session title, favorite, rating, and metadata
 */

import React from 'react';

const SessionHeader = ({
  sessionTitle,
  isFavorite,
  onFavoriteToggle,
  rating,
  onRatingChange,
  hoveredRating,
  onRatingHover,
  user,
  markingResult = null,
  showInfoDropdown = false,
  onToggleInfoDropdown
}) => {
  const renderStars = (currentRating, hoverRating = currentRating) => {
    return Array.from({ length: 5 }, (_, index) => {
      const starValue = index + 1;
      const isFilled = starValue <= (hoverRating || currentRating);
      
      return (
        <span
          key={starValue}
          className={`star ${isFilled ? 'filled' : ''}`}
          onClick={() => onRatingChange(starValue)}
          onMouseEnter={() => onRatingHover(starValue)}
          onMouseLeave={() => onRatingHover(0)}
          title={`Rate ${starValue} star${starValue !== 1 ? 's' : ''}`}
        >
          ★
        </span>
      );
    });
  };

  return (
    <div className="chat-header">
      <div className="chat-header-content">
        <div className="chat-header-left">
          <h1>
            {sessionTitle.length > 100 ? sessionTitle.substring(0, 100) + '...' : sessionTitle}
          </h1>
        </div>
        <div className="chat-header-right">
          <div className="info-dropdown-container">
            <button 
              className="header-btn info-btn"
              onClick={onToggleInfoDropdown}
              title="Information"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
            </button>
            
            {/* Info Dropdown */}
            {showInfoDropdown && (
              <div className="info-dropdown">
                <div className="info-dropdown-content">
                  {/* Header */}
                  <div className="dropdown-header">
                    <h3>Task Details</h3>
                  </div>
                  
                  {/* Main Content */}
                  <div className="dropdown-main-content">
                    {/* Label-Value Pairs */}
                    <div className="label-value-pairs">
                      <div className="label-value-item">
                        <span className="label">Title:</span>
                        <span className="value">{sessionTitle.length > 30 ? sessionTitle.substring(0, 30) + '...' : sessionTitle}</span>
                      </div>
                      <div className="label-value-item">
                        <span className="label">Question Type:</span>
                        <span className="value">{markingResult?.classification?.questionType || 'Math Problem'}</span>
                      </div>
                      <div className="label-value-item">
                        <span className="label">Difficulty:</span>
                        <span className="value">{markingResult?.classification?.difficulty || 'Medium'}</span>
                      </div>
                      <div className="label-value-item">
                        <span className="label">API Used:</span>
                        <span className="value">{markingResult?.apiUsed || 'N/A'}</span>
                      </div>
                      <div className="label-value-item">
                        <span className="label">OCR Method:</span>
                        <span className="value">{markingResult?.ocrMethod || 'N/A'}</span>
                      </div>
                      <div className="label-value-item">
                        <span className="label">Confidence:</span>
                        <span className="value">
                          {markingResult?.metadata?.confidence 
                            ? `${(markingResult.metadata.confidence * 100).toFixed(1)}%`
                            : 'N/A'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer */}
                  <div className="dropdown-footer">
                    <div className="token-count">
                      <span className="label">LLM Tokens:</span>
                      <span className="value">{markingResult?.metadata?.tokens?.[0]?.toLocaleString() || 'N/A'}</span>
                    </div>
                    <div className="mathpix-count">
                      <span className="label">Mathpix Calls:</span>
                      <span className="value">{markingResult?.metadata?.tokens?.[1] || 'N/A'}</span>
                    </div>
                    <div className="processing-time">
                      <span className="label">Processing Time:</span>
                      <span className="value">
                        {markingResult?.metadata?.totalProcessingTimeMs 
                          ? `${(markingResult.metadata.totalProcessingTimeMs / 1000).toFixed(1)}s`
                          : 'N/A'
                        }
                      </span>
                    </div>
                    <div className="last-update">
                      <span className="label">Last Update:</span>
                      <span className="value">{new Date().toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Rating Section */}
          <div className="rating-section">
            <div className="rating-stars">
              {renderStars(rating, hoveredRating)}
            </div>
            <span className="rating-text">
              {rating > 0 ? `${rating} star${rating !== 1 ? 's' : ''}` : 'Rate this session'}
            </span>
          </div>
          
          {/* Favorite button */}
          <button 
            className={`header-btn favorite-btn ${isFavorite ? 'favorited' : ''} ${!user?.uid ? 'disabled' : ''}`}
            onClick={onFavoriteToggle}
            title={!user?.uid ? "Login required to save favorites" : (isFavorite ? "Remove from favorites" : "Add to favorites")}
            disabled={!user?.uid}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionHeader;
