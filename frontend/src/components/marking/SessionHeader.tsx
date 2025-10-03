/**
 * Session Header Component (TypeScript)
 * This is the definitive version with the fix for the auto-closing dropdown.
 */
import React, { useEffect, useRef } from 'react';
import { useMarkingPage } from '../../contexts/MarkingPageContext';

const SessionHeader: React.FC = () => {
  const {
    sessionTitle,
    isFavorite,
    onFavoriteToggle,
    rating,
    onRatingChange,
    hoveredRating,
    setHoveredRating,
    showInfoDropdown,
    onToggleInfoDropdown,
    currentSession,
  } = useMarkingPage();

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null); // Ref for the toggle button

  const getModelUsed = (): string => {
    const metadata = currentSession?.sessionMetadata;
    return metadata?.modelUsed || metadata?.lastModelUsed || 'N/A';
  };

  const getProcessingTime = (): string => {
      const timeMs = currentSession?.sessionMetadata?.totalProcessingTimeMs;
      return timeMs ? `${(timeMs / 1000).toFixed(1)}s` : 'N/A';
  };
  
  const getTokenData = () => {
    const metadata = currentSession?.sessionMetadata;
    if (!metadata) return null;
    if (Array.isArray(metadata.tokens)) return metadata.tokens;
    if (metadata.llmTokens !== undefined || metadata.mathpixCalls !== undefined) {
      return [metadata.llmTokens || 0, metadata.mathpixCalls || 0];
    }
    return null;
  };
  
  const tokens = getTokenData();
  const modelUsed = getModelUsed();
  const processingTime = getProcessingTime();

  const renderStars = () => {
    return Array.from({ length: 5 }, (_, index) => {
      const starValue = index + 1;
      const isFilled = starValue <= (hoveredRating || rating);
      return (
        <span
          key={starValue}
          className={`star ${isFilled ? 'filled' : ''}`}
          onClick={() => onRatingChange(starValue)}
          onMouseEnter={() => setHoveredRating(starValue)}
          onMouseLeave={() => setHoveredRating(0)}
        >★</span>
      );
    });
  };
  
  // 👇 FIX: The useEffect for handling "click outside" is now architecturally correct.
  // It correctly handles dependencies and event propagation to prevent auto-closing.
  useEffect(() => {
    if (!showInfoDropdown) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      // If the click is on the button that opens the dropdown, do nothing.
      if (buttonRef.current && buttonRef.current.contains(event.target as Node)) {
        return;
      }
      // If the click is outside the dropdown content, close it.
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onToggleInfoDropdown();
      }
    };

    // Use a timeout to ensure the listener is added after the current event cycle.
    const timerId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
    // This effect should ONLY run when the dropdown's visibility changes.
  }, [showInfoDropdown, onToggleInfoDropdown]);

  const displaySession = currentSession;

  return (
    <div className="session-header">
      <div className="session-title-section">
        <h1 className="session-title">
          {displaySession?.id?.startsWith('temp-') ? 'Processing...' : sessionTitle}
        </h1>
      </div>
      
      {displaySession && !displaySession.id.startsWith('temp-') && (
        <div className="session-actions">
          <div className="info-dropdown-container">
            <button 
              ref={buttonRef} // Attach ref to the button
              className="header-btn info-btn"
              onClick={onToggleInfoDropdown}
              title="Task Details"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
            </button>
            
            {showInfoDropdown && (
              <div className="info-dropdown" ref={dropdownRef}>
                <div className="info-dropdown-content">
                  <div className="dropdown-header"><h3>Task Details</h3></div>
                  <div className="dropdown-main-content">
                    <div className="label-value-item">
                      <span className="label">Title:</span>
                      <span className="value">{sessionTitle}</span>
                    </div>
                  </div>
                   <div className="agent-speed-section">
                        <div className="agent-info">
                            <span className="label">Model Used</span>
                            <span className="value">{modelUsed}</span>
                        </div>
                        <div className="speed-info">
                            <span className="label">Processing Time</span>
                            <span className="value">{processingTime}</span>
                        </div>
                   </div>
                  <div className="dropdown-rating-section">
                    <div className="rating-container">
                      <div className="rating-label"><span className="label">Rate this task:</span></div>
                      <div className="rating-stars">{renderStars()}</div>
                    </div>
                  </div>
                   <div className="dropdown-footer">
                        <div className="token-count">
                            <span className="label">LLM Tokens</span>
                            <span className="value">{tokens ? tokens[0]?.toLocaleString() : 'N/A'}</span>
                        </div>
                        <div className="mathpix-count">
                            <span className="label">Mathpix Calls</span>
                            <span className="value">{tokens ? tokens[1] : 'N/A'}</span>
                        </div>
                        <div className="last-update">
                            <span className="label">Last Update:</span>
                            <span className="value">{currentSession?.updatedAt ? new Date(currentSession.updatedAt).toLocaleString() : 'N/A'}</span>
                        </div>
                   </div>
                </div>
              </div>
            )}
          </div>
          
          <button 
            className={`header-btn favorite-btn ${isFavorite ? 'favorited' : ''}`}
            onClick={onFavoriteToggle}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default SessionHeader;

