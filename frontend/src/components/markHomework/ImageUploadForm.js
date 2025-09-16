/**
 * Image Upload Form Component
 * Handles file selection, preview, and upload initiation
 */

import React from 'react';
import { ImageUpload, ModelSelector, SendButton } from '../focused';

const ImageUploadForm = ({
  selectedFile,
  previewUrl,
  isProcessing,
  onFileSelect,
  onAnalyzeImage,
  onClearFile,
  selectedModel,
  onModelChange,
  availableModels = ['chatgpt-4o', 'gemini-2.5-pro', 'chatgpt-5'],
  loadingProgress = 0,
  showExpandedThinking = false
}) => {
  const handleImageSelect = (imageData) => {
    if (imageData && imageData.file) {
      onFileSelect(imageData.file);
    }
  };

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
            onImageSelect={handleImageSelect}
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
                onModelSelect={onModelChange}
                isProcessing={isProcessing}
                size="main"
              />
            </div>
            <SendButton
              onClick={onAnalyzeImage}
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
    </>
  );
};

export default ImageUploadForm;
