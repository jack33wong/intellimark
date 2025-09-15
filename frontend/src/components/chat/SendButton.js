/**
 * SendButton Component
 * 
 * Reusable send button with loading state and disabled state
 */

import React from 'react';
import './SendButton.css';

const SendButton = ({ 
  onSend, 
  isProcessing, 
  disabled, 
  className = '',
  children 
}) => {
  return (
    <button
      className={`send-button ${disabled ? 'disabled' : 'active'} ${className}`}
      onClick={onSend}
      disabled={disabled}
    >
      {isProcessing ? (
        <div className="send-spinner"></div>
      ) : (
        children || (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
          </svg>
        )
      )}
    </button>
  );
};

export default SendButton;
