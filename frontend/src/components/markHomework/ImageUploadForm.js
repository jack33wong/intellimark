/**
 * Image Upload Form Component
 * Handles file selection, preview, and upload initiation
 */

import React from 'react';
import { Upload } from 'lucide-react';

const ImageUploadForm = ({
  selectedFile,
  previewUrl,
  isProcessing,
  onFileSelect,
  onAnalyzeImage,
  onClearFile,
  selectedModel,
  onModelChange,
  availableModels = ['chatgpt-4o', 'gemini-2.5-pro', 'chatgpt-5']
}) => {
  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <div className="upload-section">
      <div className="upload-container">
        {!previewUrl ? (
          <div className="upload-area">
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="file-input"
              id="image-upload"
              disabled={isProcessing}
            />
            <label htmlFor="image-upload" className="upload-label">
              <Upload size={48} className="upload-icon" />
              <div className="upload-text">
                <h3>Upload Homework Image</h3>
                <p>Click to select or drag and drop an image</p>
                <p className="upload-hint">Supports JPG, PNG, WebP formats</p>
              </div>
            </label>
          </div>
        ) : (
          <div className="preview-container">
            <div className="preview-image-wrapper">
              <img
                src={previewUrl}
                alt="Preview"
                className="preview-image"
              />
              <button
                className="clear-preview-btn"
                onClick={onClearFile}
                disabled={isProcessing}
                title="Remove image"
              >
                ×
              </button>
            </div>
            
            <div className="preview-actions">
              <div className="model-selection">
                <label htmlFor="model-select">AI Model:</label>
                <select
                  id="model-select"
                  value={selectedModel}
                  onChange={(e) => onModelChange(e.target.value)}
                  disabled={isProcessing}
                  className="model-select"
                >
                  {availableModels.map(model => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
              
              <button
                className="analyze-btn"
                onClick={onAnalyzeImage}
                disabled={isProcessing || !selectedFile}
              >
                {isProcessing ? 'Processing...' : 'Analyze Image'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUploadForm;
