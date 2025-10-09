import React from 'react';
import './SuggestedFollowUpButtons.css';

const SuggestedFollowUpButtons = ({ suggestions = [], onSuggestionClick }: { suggestions?: string[], onSuggestionClick?: (suggestion: string) => void }) => {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="suggested-follow-ups">
      <div className="suggested-follow-ups-header">
        <span className="suggested-follow-ups-title">Suggested follow-ups:</span>
      </div>
      <div className="suggested-follow-ups-list">
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            className="suggested-follow-up-button"
            onClick={() => onSuggestionClick && onSuggestionClick(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestedFollowUpButtons;
