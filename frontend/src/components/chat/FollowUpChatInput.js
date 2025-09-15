/**
 * FollowUpChatInput Component
 * 
 * Compact single-line chat input for follow-up messages
 * with model selector and send button.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import './FollowUpChatInput.css';

const FollowUpChatInput = ({
  chatInput,
  setChatInput,
  selectedModel,
  setSelectedModel,
  isProcessing,
  onSendMessage,
  onKeyPress
}) => {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  const handleModelToggle = useCallback(() => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  }, [isModelDropdownOpen]);

  const handleModelSelect = useCallback((model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  }, [setSelectedModel]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isModelDropdownOpen && !event.target.closest('.followup-ai-model-dropdown')) {
        setIsModelDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isModelDropdownOpen]);

  return (
    <div className="followup-chat-input-bar">
      <div className="followup-single-line-container">
        {/* Model Dropdown */}
        <div className="followup-model-dropdown">
          <button
            className="followup-model-button"
            onClick={handleModelToggle}
            disabled={isProcessing}
          >
            <Bot size={16} />
            <span>
              {selectedModel === 'chatgpt-4o' ? 'GPT-4o' : 
               selectedModel === 'gemini-2.5-pro' ? 'Gemini 2.5 Pro' : 
               selectedModel === 'chatgpt-5' ? 'GPT-5' : 'AI Model'}
            </span>
            <ChevronDown size={14} className={isModelDropdownOpen ? 'rotated' : ''} />
          </button>

          {isModelDropdownOpen && (
            <div className="followup-model-dropdown-menu">
              <button
                className={`followup-model-option ${selectedModel === 'chatgpt-4o' ? 'selected' : ''}`}
                onClick={() => handleModelSelect('chatgpt-4o')}
              >
                GPT-4o
              </button>
              <button
                className={`followup-model-option ${selectedModel === 'gemini-2.5-pro' ? 'selected' : ''}`}
                onClick={() => handleModelSelect('gemini-2.5-pro')}
              >
                Gemini 2.5 Pro
              </button>
              <button
                className={`followup-model-option ${selectedModel === 'chatgpt-5' ? 'selected' : ''}`}
                onClick={() => handleModelSelect('chatgpt-5')}
              >
                GPT-5
              </button>
            </div>
          )}
        </div>

        {/* Text Input */}
        <textarea
          placeholder={isProcessing ? "AI is processing your homework..." : "Ask me anything about your homework..."}
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyPress={onKeyPress}
          disabled={isProcessing}
          className="followup-text-input"
        />

        {/* Send Button */}
        <button
          className={`followup-send-button ${chatInput.trim() ? 'analyze-mode' : ''}`}
          disabled={isProcessing || !chatInput.trim()}
          onClick={onSendMessage}
        >
          {isProcessing ? (
            <div className="followup-send-spinner"></div>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
};

export default FollowUpChatInput;
