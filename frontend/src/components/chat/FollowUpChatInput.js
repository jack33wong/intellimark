/**
 * FollowUpChatInput Component
 * 
 * Compact single-line chat input for follow-up messages
 * with model selector and send button.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, ChevronDown, Plus } from 'lucide-react';
import './FollowUpChatInput.css';

const FollowUpChatInput = ({
  chatInput,
  setChatInput,
  selectedModel,
  setSelectedModel,
  isProcessing,
  onSendMessage,
  onAnalyzeImage,
  onKeyPress,
  onUploadClick
}) => {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleUploadClick = useCallback(() => {
    document.getElementById('followup-file-input')?.click();
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      // Create preview URL
      const previewUrl = URL.createObjectURL(file);
      setPreviewImage(previewUrl);
      setIsExpanded(true);
      
      // Call the parent handler
      onUploadClick(file);
    }
  }, [onUploadClick]);

  const handleModelToggle = useCallback(() => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  }, [isModelDropdownOpen]);

  const handleModelSelect = useCallback((model) => {
    setSelectedModel(model);
    setIsModelDropdownOpen(false);
  }, [setSelectedModel]);

  const removePreview = useCallback(() => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
      setPreviewImage(null);
      setIsExpanded(false);
    }
  }, [previewImage]);

  const handleSendClick = useCallback(() => {
    // If there's an image preview, call analyze image API (same as main chat input)
    if (previewImage) {
      onAnalyzeImage();
    } else {
      // If no image, call regular send message API
      onSendMessage();
    }
    
    // Collapse the div after sending
    setIsExpanded(false);
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
      setPreviewImage(null);
    }
  }, [onSendMessage, onAnalyzeImage, previewImage]);

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
    <div className={`followup-chat-input-bar ${isExpanded ? 'expanded' : ''}`}>
      <div className={`followup-single-line-container ${isExpanded ? 'expanded' : ''}`}>
        {/* Image Preview - Above controls when expanded */}
        {isExpanded && previewImage && (
          <div className="followup-preview-section">
            <div className="followup-image-preview">
              <img
                src={previewImage}
                alt="Preview"
                className="followup-preview-image"
              />
              <button
                className="followup-remove-preview"
                onClick={removePreview}
                type="button"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* Controls Row */}
        <div className="followup-controls-row">
          {/* Upload Button */}
          <button
            className="followup-upload-button"
            onClick={handleUploadClick}
            disabled={isProcessing}
            title="Upload image"
          >
            <Plus size={14} />
          </button>

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
          <div className="followup-text-wrapper">
            <textarea
              placeholder={isProcessing ? "AI is processing your homework..." : "Ask me anything about your homework..."}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyPress={onKeyPress}
              disabled={isProcessing}
              className="followup-text-input"
            />
          </div>

          {/* Send Button */}
          <button
            className={`followup-send-button ${(chatInput.trim() || previewImage) ? 'analyze-mode' : ''}`}
            disabled={isProcessing || (!chatInput.trim() && !previewImage)}
            onClick={handleSendClick}
          >
          {isProcessing ? (
            <div className="followup-send-spinner"></div>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
            </svg>
          )}
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        id="followup-file-input"
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
        disabled={isProcessing}
      />
    </div>
  );
};

export default FollowUpChatInput;
