/**
 * FollowUpChatInput Component
 * 
 * Compact single-line chat input for follow-up messages
 * with model selector and send button.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { ModelSelector, SendButton } from '../focused';
import './FollowUpChatInput.css';

const FollowUpChatInput = ({
  chatInput,
  setChatInput,
  selectedModel,
  setSelectedModel,
  isProcessing,
  onSendMessage,
  onAnalyzeImage,
  onFollowUpImage,
  onKeyPress,
  onUploadClick,
  clearPreview,
  currentSession // Add currentSession to detect if this is follow-up
}) => {
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
    
    // Clear the file input to allow selecting the same file again
    e.target.value = '';
  }, [onUploadClick]);

  const handleModelSelect = useCallback((model) => {
    setSelectedModel(model);
  }, [setSelectedModel]);

  // Clear preview image
  const clearPreviewInternal = useCallback(() => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
      setPreviewImage(null);
    }
    setIsExpanded(false);
  }, [previewImage]);

  // Pass the clearPreview function to parent
  useEffect(() => {
    if (clearPreview) {
      clearPreview(clearPreviewInternal);
    }
  }, [clearPreview]); // Only run when clearPreview prop changes

  const removePreview = useCallback(() => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
      setPreviewImage(null);
      setIsExpanded(false);
    }
  }, [previewImage]);

  const handleSendClick = useCallback(() => {
    // If there's an image preview, determine if this is initial or follow-up upload
    if (previewImage) {
      const isFollowUp = !!currentSession; // If there's a current session, this is a follow-up
      
      // Phase 1: Switch to chat mode IMMEDIATELY (200-500ms)
      // This should trigger the transition before any API calls
      if (isFollowUp) {
        if (onFollowUpImage) {
          try {
            // Get the file from the file input
            const fileInput = document.getElementById('followup-file-input');
            const file = fileInput?.files?.[0];
            onFollowUpImage(file);
          } catch (error) {
            console.error('FollowUpChatInput: ERROR calling onFollowUpImage:', error);
          }
        }
      } else {
        if (onAnalyzeImage) {
          try {
            onAnalyzeImage();
          } catch (error) {
            console.error('FollowUpChatInput: ERROR calling onAnalyzeImage:', error);
          }
        }
      }
    } else {
      // If no image, call regular send message API
      if (onSendMessage && chatInput.trim()) {
        onSendMessage();
      }
    }
    
    // Collapse the div after sending
    setIsExpanded(false);
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
      setPreviewImage(null);
    }
  }, [onSendMessage, onAnalyzeImage, onFollowUpImage, previewImage, currentSession]);


  
  return (
    <div className={`followup-chat-input-bar ${isExpanded ? 'expanded' : ''}`}>
      <div className="followup-input-wrapper">
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

          {/* Buttons Row - Upload, Model, Send */}
          <div className="followup-buttons-row">
            {/* Left Side - Upload and Model */}
            <div className="followup-left-buttons">
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
              <ModelSelector
                selectedModel={selectedModel}
                onModelSelect={handleModelSelect}
                isProcessing={isProcessing}
                size="small"
              />
            </div>

            {/* Right Side - Send Button */}
            <SendButton
              onClick={handleSendClick}
              disabled={isProcessing || (!(chatInput || '').trim() && !previewImage)}
              loading={isProcessing}
              variant={((chatInput || '').trim() || previewImage) ? 'success' : 'primary'}
              size="small"
            />
          </div>
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
    </div>
  );
};

export default FollowUpChatInput;
