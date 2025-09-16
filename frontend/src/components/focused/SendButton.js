/**
 * Focused SendButton Component
 * Simple, maintainable, single-purpose component for send button
 */

import React, { useCallback } from 'react';
import { createValidationError } from '../../utils/errorUtils';
import './SendButton.css';

const SendButton = ({ 
  onClick, 
  onError, 
  disabled = false, 
  loading = false,
  className = '',
  size = 'medium', // 'small', 'medium', 'large'
  variant = 'primary', // 'primary', 'secondary', 'success'
  text = 'Send',
  showText = false,
  showIcon = true
}) => {
  // Handle button click
  const handleClick = useCallback(() => {
    if (disabled || loading) return;
    
    if (!onClick) {
      const error = createValidationError('No click handler provided');
      onError?.(error);
      return;
    }
    
    onClick();
  }, [disabled, loading, onClick, onError]);

  // Handle keyboard events
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleClick();
    }
  }, [handleClick]);

  return (
    <button
      type="button"
      className={`send-button ${className} ${size} ${variant} ${disabled ? 'disabled' : ''} ${loading ? 'loading' : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      disabled={disabled || loading}
      aria-label={text}
    >
      {loading ? (
        <div className="send-button-loading">
          <div className="spinner" />
        </div>
      ) : (
        <div className="send-button-content">
          {showIcon && (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
            </svg>
          )}
          {showText && <span className="send-button-text">{text}</span>}
        </div>
      )}
    </button>
  );
};

export default SendButton;
