/**
 * Session Header Component
 * Displays session title, favorite, rating, and metadata
 */

import React, { useEffect, useRef } from 'react';

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
  onToggleInfoDropdown,
  sessionData = null // Add sessionData prop to access unified session messages
}) => {
  const dropdownRef = useRef(null);

  // Helper function to get token data from either markingResult or sessionData
  const getTokenData = () => {
    // First try to get from markingResult (for current sessions)
    if (markingResult?.metadata?.tokens && Array.isArray(markingResult.metadata.tokens)) {
      return markingResult.metadata.tokens;
    }
    
    // For historical sessions: check unifiedSession.sessionMetadata
    if (sessionData?.sessionMetadata) {
      // Check if tokens are stored as array
      if (sessionData.sessionMetadata.tokens && Array.isArray(sessionData.sessionMetadata.tokens)) {
        return sessionData.sessionMetadata.tokens;
      }
      
      // Check if tokens are stored as totalTokens (for LLM tokens)
      if (sessionData.sessionMetadata.totalTokens !== undefined) {
        // For now, we only have totalTokens, so use it for LLM tokens and 0 for Mathpix calls
        return [sessionData.sessionMetadata.totalTokens, 0];
      }
    }
    
    return null;
  };

  const tokens = getTokenData();

  // Helper function to get model information
  const getModelUsed = () => {
    // First try to get from markingResult
    if (markingResult?.metadata?.modelUsed) {
      return markingResult.metadata.modelUsed;
    }
    
    // Check for different model field names in markingResult
    if (markingResult?.model) {
      return markingResult.model;
    }
    
    // For historical sessions: check unifiedSession.sessionMetadata
    if (sessionData?.sessionMetadata?.modelUsed) {
      return sessionData.sessionMetadata.modelUsed;
    }
    
    // Also check lastModelUsed for historical sessions
    if (sessionData?.sessionMetadata?.lastModelUsed) {
      return sessionData.sessionMetadata.lastModelUsed;
    }
    
    // Default model based on common usage
    return 'ChatGPT-4 Omni';
  };

  const modelUsed = getModelUsed();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        if (showInfoDropdown && onToggleInfoDropdown) {
          onToggleInfoDropdown();
        }
      }
    };

    if (showInfoDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showInfoDropdown, onToggleInfoDropdown]);

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
          <div className="info-dropdown-container" ref={dropdownRef}>
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
                  
                  {/* Title Section - First row */}
                  <div className="dropdown-title-section">
                    <div className="label-value-item">
                      <span className="label">Title:</span>
                      <span className="value">{sessionTitle.length > 30 ? sessionTitle.substring(0, 30) + '...' : sessionTitle}</span>
                    </div>
                  </div>
                  
                  {/* Model and Processing Time Section */}
                  <div className="dropdown-model-section">
                    <div className="label-value-item">
                      <span className="label">Model Used:</span>
                      <span className="value">{modelUsed}</span>
                    </div>
                    <div className="label-value-item">
                      <span className="label">Processing Time:</span>
                      <span className="value">
                        {(() => {
                          // Try different sources for processing time
                          const timeMs = markingResult?.metadata?.totalProcessingTimeMs ||
                                        markingResult?.metadata?.processingTimeMs ||
                                        sessionData?.sessionMetadata?.totalProcessingTimeMs ||
                                        sessionData?.sessionMetadata?.processingTimeMs;
                          
                          return timeMs ? `${(timeMs / 1000).toFixed(1)}s` : 'N/A';
                        })()}
                      </span>
                    </div>
                  </div>
                  
                  {/* Rating Section */}
                  <div className="dropdown-rating-section">
                    <div className="rating-container">
                      <div className="rating-label">
                        <span className="label">Rate this task:</span>
                      </div>
                      <div className="rating-stars">
                        {renderStars(rating, hoveredRating)}
                      </div>
                    </div>
                  </div>
                  
                  {/* Footer - Restored original fields */}
                  <div className="dropdown-footer">
                    <div className="token-count">
                      <span className="label">LLM Tokens:</span>
                      <span className="value">
                        {tokens && Array.isArray(tokens) && tokens.length > 0 
                          ? tokens[0]?.toLocaleString() || 'N/A'
                          : 'N/A'
                        }
                      </span>
                    </div>
                    <div className="mathpix-count">
                      <span className="label">Mathpix Calls:</span>
                      <span className="value">
                        {tokens && Array.isArray(tokens) && tokens.length > 1 
                          ? tokens[1] || 'N/A'
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
