/**
 * Image Upload Form Component
 * Handles file selection, preview, and upload initiation
 */

import React, { useState } from 'react';
import { Upload, Bot, ChevronDown } from 'lucide-react';

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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleModelToggle = () => {
    setIsModelDropdownOpen(!isModelDropdownOpen);
  };

  const handleModelSelect = (model) => {
    onModelChange(model);
    setIsModelDropdownOpen(false);
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
              <div className="ai-model-dropdown">
                <button 
                  className="ai-model-button" 
                  onClick={handleModelToggle}
                  disabled={isProcessing}
                >
                  <Bot size={16} />
                  <span>ai model</span>
                  <ChevronDown size={14} className={isModelDropdownOpen ? 'rotated' : ''} />
                </button>
                
                {isModelDropdownOpen && (
                  <div className="ai-model-dropdown-menu">
                    <button 
                      className={`ai-model-option ${selectedModel === 'chatgpt-4o' ? 'selected' : ''}`}
                      onClick={() => handleModelSelect('chatgpt-4o')}
                    >
                      GPT-4o
                    </button>
                    <button 
                      className={`ai-model-option ${selectedModel === 'gemini-2.5-pro' ? 'selected' : ''}`}
                      onClick={() => handleModelSelect('gemini-2.5-pro')}
                    >
                      Gemini 2.5 Pro
                    </button>
                    <button 
                      className={`ai-model-option ${selectedModel === 'chatgpt-5' ? 'selected' : ''}`}
                      onClick={() => handleModelSelect('chatgpt-5')}
                    >
                      GPT-5
                    </button>
                  </div>
                )}
              </div>
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
