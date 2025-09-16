/**
 * ImageUploadInterface Component
 * Handles image upload, processing, and error display
 */

import React from 'react';
import ImageUploadForm from './ImageUploadForm';

const ImageUploadInterface = ({
  selectedFile,
  previewUrl,
  isProcessing,
  onFileSelect,
  onAnalyzeImage,
  onClearFile,
  selectedModel,
  onModelChange,
  loadingProgress,
  showExpandedThinking,
  markError
}) => {
  return (
    <div className="mark-homework-page upload-mode">
      <ImageUploadForm
        selectedFile={selectedFile}
        previewUrl={previewUrl}
        isProcessing={isProcessing}
        onFileSelect={onFileSelect}
        onAnalyzeImage={onAnalyzeImage}
        onClearFile={onClearFile}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        loadingProgress={loadingProgress}
        showExpandedThinking={showExpandedThinking}
      />
      
      {markError && (
        <div className="error-message">
          <p>{markError}</p>
        </div>
      )}
    </div>
  );
};

export default ImageUploadInterface;
