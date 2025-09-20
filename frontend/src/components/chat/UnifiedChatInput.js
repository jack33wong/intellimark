/**
 * UnifiedChatInput Component
 * 
 * Unified component for both first-time and follow-up chat inputs
 * Maintains exact same UI while eliminating code duplication
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { ModelSelector, SendButton, ImageUpload } from '../focused';
import './UnifiedChatInput.css';

const UnifiedChatInput = ({
  // Mode configuration
  mode = 'first-time', // 'first-time' | 'follow-up'
  
  // Common props
  selectedModel = 'auto',
  isProcessing = false,
  onImageSelect,
  onSendClick,
  onModelChange,
  onUploadClick,
  onAnalyzeImage,
  onFollowUpImage,
  clearPreview,
  currentSession,
  
  // First-time specific props
  selectedFile,
  previewUrl,
  onFileSelect,
  onClearFile,
  loadingProgress = 0,
  showExpandedThinking = false,
  
  // Follow-up specific props
  onClearPreview
}) => {
  // Common state management
  const [previewImage, setPreviewImage] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // ============================================================================
  // COMMON LOGIC - Shared between both modes
  // ============================================================================

  // File handling logic (100% shared)
  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      // Convert file to base64 data URL
      const reader = new FileReader();
      reader.onload = () => {
        setPreviewImage(reader.result);
        setIsExpanded(true);
      };
      reader.readAsDataURL(file);
      
      // Call the appropriate parent handler
      if (mode === 'first-time') {
        onFileSelect?.(file);
      } else {
        onUploadClick?.(file);
      }
    }
    
    // Clear the file input to allow selecting the same file again
    e.target.value = '';
  }, [mode, onFileSelect, onUploadClick]);

  // Upload click handler (100% shared)
  const handleUploadClick = useCallback(() => {
    const inputId = mode === 'first-time' ? 'main-file-input' : 'followup-file-input';
    document.getElementById(inputId)?.click();
  }, [mode]);

  // Model selection handler (100% shared)
  const handleModelSelect = useCallback((model) => {
    if (mode === 'first-time') {
      onModelChange?.(model);
    } else {
      // No-op for follow-up since model is hardcoded to 'auto'
    }
  }, [mode, onModelChange]);

  // Preview removal logic (100% shared)
  const removePreview = useCallback(() => {
    setPreviewImage(null);
    setIsExpanded(false);
  }, []);

  // Send click handler (90% shared with mode-specific logic)
  const handleSendClick = useCallback(() => {
    if (mode === 'first-time') {
      // First-time mode: call onAnalyzeImage
      onAnalyzeImage?.();
    } else {
      // Follow-up mode: determine if this is initial or follow-up upload
      if (previewImage) {
        const isFollowUp = !!currentSession;
        
        if (isFollowUp) {
          if (onFollowUpImage) {
            try {
              const fileInput = document.getElementById('followup-file-input');
              const file = fileInput?.files?.[0];
              onFollowUpImage(file);
            } catch (error) {
              console.error('UnifiedChatInput: ERROR calling onFollowUpImage:', error);
            }
          }
        } else {
          if (onAnalyzeImage) {
            try {
              onAnalyzeImage();
            } catch (error) {
              console.error('UnifiedChatInput: ERROR calling onAnalyzeImage:', error);
            }
          }
        }
      } else {
        // If no image, call analyze image (which will show error for no file)
        if (onAnalyzeImage) {
          onAnalyzeImage();
        }
      }
    }
    
    // Collapse the div after sending (follow-up mode only)
    if (mode === 'follow-up') {
      setIsExpanded(false);
      if (previewImage) {
        setPreviewImage(null);
      }
    }
  }, [mode, previewImage, currentSession, onAnalyzeImage, onFollowUpImage]);

  // Clear preview function for parent (follow-up mode only)
  const clearPreviewInternal = useCallback(() => {
    setPreviewImage(null);
    setIsExpanded(false);
  }, []);

  // Pass the clearPreview function to parent (follow-up mode only)
  useEffect(() => {
    if (mode === 'follow-up' && clearPreview) {
      clearPreview(clearPreviewInternal);
    }
  }, [mode, clearPreview, clearPreviewInternal]);

  // ============================================================================
  // RENDER LOGIC - Mode-specific UI rendering
  // ============================================================================

  if (mode === 'first-time') {
    // First-time mode: Render ImageUploadForm UI
    return (
      <>
        {/* Main Content */}
        <div className="upload-main-content">
          <div className="upload-title-section">
            <div className="title-content">
              <h1>intellimark</h1>
              <p>Upload your homework images and get instant AI-powered feedback, explanations, and corrections</p>
            </div>
            <ImageUpload
              onImageSelect={onImageSelect}
              onError={(error) => console.error('Image upload error:', error)}
              disabled={isProcessing}
              showPreview={true}
              placeholder="Upload Homework"
              className="upload-button-base title-upload-btn"
            />
          </div>
        </div>

        {/* Main Chat Input Bar */}
        <div className="main-upload-input-bar main-chat-input-bar">
          <div className="main-upload-input">
            {/* Main Input Area */}
            <div className="input-container">
              <textarea
                placeholder={isProcessing ? "AI is processing your homework..." : "Ask me anything about your homework..."}
                disabled={isProcessing}
                className="main-chat-input"
              />
            </div>
            
            {/* Model Selector with Send Button */}
            <div className="model-selector">
              <div className="left-controls">
                <ModelSelector
                  selectedModel={selectedModel}
                  onModelSelect={handleModelSelect}
                  isProcessing={isProcessing}
                  size="main"
                />
              </div>
              <SendButton
                onClick={handleSendClick}
                disabled={isProcessing || !selectedFile}
                loading={isProcessing}
                variant={selectedFile ? 'success' : 'primary'}
                size="main"
              >
                {selectedFile ? 'Analyze' : 'Send'}
              </SendButton>
            </div>
          </div>
          {isProcessing && (
            <div className="upload-loading-bar inside-input">
              <div className="loading-content">
                <div className="loading-text">Processing your homework...</div>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${loadingProgress}%` }}
                  ></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Hidden file input */}
        <input
          id="main-file-input"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          disabled={isProcessing}
        />
      </>
    );
  }

  // Follow-up mode: Render FollowUpChatInput UI
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
                disabled={isProcessing}
                className="followup-text-input"
                readOnly
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
                disabled={isProcessing || !previewImage}
                loading={isProcessing}
                variant={previewImage ? 'success' : 'primary'}
                size="small"
              />
            </div>
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
  );
};

export default UnifiedChatInput;
