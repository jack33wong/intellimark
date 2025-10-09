import React from 'react';
import { MessageCircle, ArrowRight } from 'lucide-react';
import './SuggestedFollowUpButtons.css';

const SuggestedFollowUpButtons = ({ suggestions = [], onSuggestionClick }) => {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="suggested-follow-ups">
      <div className="suggested-follow-ups-header">
        <span className="suggested-follow-ups-title">Suggested follow-ups:</span>
      </div>
      <div className="suggested-follow-ups-list">
        {suggestions.map((suggestion, index) => {
          // Handle both old format (string) and new format (object)
          const suggestionText = typeof suggestion === 'string' ? suggestion : suggestion.text;
          const suggestionMode = typeof suggestion === 'string' ? 'chat' : suggestion.mode;
          
          return (
            <button
              key={index}
              className="suggested-follow-up-button"
              onClick={() => onSuggestionClick && onSuggestionClick(suggestionText, suggestionMode)}
            >
              <div className="suggested-follow-up-content">
                <div className="suggested-follow-up-left">
                  <MessageCircle className="suggested-follow-up-start-icon" />
                  <span className="suggested-follow-up-text">{suggestionText}</span>
                </div>
                <ArrowRight className="suggested-follow-up-end-icon" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SuggestedFollowUpButtons;
