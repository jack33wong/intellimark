import React from 'react';
import './SuggestedFollowUpButtons.css';

const SuggestedFollowUpButtons = ({
  suggestions = [],
  onSuggestionClick,
  disabled = false
}: {
  suggestions?: any[];
  onSuggestionClick?: (suggestion: string, mode?: string) => void;
  disabled?: boolean;
}) => {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="suggested-follow-ups">
      <div className="suggested-follow-ups-header">
        <span className="suggested-follow-ups-title">Suggested follow-ups:</span>
      </div>
      <div className="suggested-follow-ups-list">
        {suggestions.map((suggestion: any, index: number) => {
          const displayText = typeof suggestion === 'object' && suggestion !== null
            ? (suggestion.text || suggestion.displayName || '')
            : String(suggestion || '');
          const mode = typeof suggestion === 'object' && suggestion !== null
            ? suggestion.mode
            : undefined;

          return (
            <button
              key={index}
              className="suggested-follow-up-button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation(); // Prevent event bubbling to parent elements
                if (!disabled) {
                  onSuggestionClick && onSuggestionClick(displayText, mode);
                }
              }}
            >
              {displayText}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SuggestedFollowUpButtons;
