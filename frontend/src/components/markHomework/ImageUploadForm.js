/**
 * Image Upload Form Component
 * Handles file selection, preview, and upload initiation
 */

import React from 'react';
import { Upload } from 'lucide-react';
import ModelSelector from '../chat/ModelSelector';

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
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(file);
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
          <button 
            className={`title-upload-btn ${selectedFile && previewUrl ? 'has-image' : ''}`}
            onClick={() => document.getElementById('image-upload').click()}
            style={selectedFile && previewUrl ? {
              backgroundImage: `url(${previewUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat'
            } : {}}
          >
            {selectedFile && previewUrl ? (
              <span className="change-image-text">Change Image</span>
            ) : (
              <>
                <Upload size={20} />
                Upload Homework
              </>
            )}
          </button>
        </div>

        {/* Hidden file input for top button */}
        <input
          id="image-upload"
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          disabled={isProcessing}
        />
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
            <button 
              className={`send-btn ${selectedFile ? 'analyze-mode' : ''}`}
              disabled={isProcessing || !selectedFile}
              onClick={onAnalyzeImage}
            >
              {isProcessing ? (
                <div className="send-spinner"></div>
              ) : selectedFile ? (
                <span className="btn-text">Analyze</span>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
                </svg>
              )}
            </button>
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
