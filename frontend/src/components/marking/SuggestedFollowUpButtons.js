import React from 'react';
import './SuggestedFollowUpButtons.css';

const SuggestedFollowUpButtons = ({ suggestions = [], onSuggestionClick }) => {
  console.log('🔍 [DEBUG] SuggestedFollowUpButtons rendered with suggestions:', suggestions);
  console.log('🔍 [DEBUG] Suggestions length:', suggestions?.length);
  console.log('🔍 [DEBUG] Suggestions type:', typeof suggestions);
  console.log('🔍 [DEBUG] Is array:', Array.isArray(suggestions));
  
  if (!suggestions || suggestions.length === 0) {
    console.log('🔍 [DEBUG] No suggestions, returning null');
    // TEMPORARY: Always render for debugging
    return (
      <div className="suggested-follow-ups">
        <div className="suggested-follow-ups-header">
          <span className="suggested-follow-ups-title">DEBUG: No suggestions provided</span>
        </div>
      </div>
    );
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
