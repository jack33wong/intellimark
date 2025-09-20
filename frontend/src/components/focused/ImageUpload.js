/**
 * Focused ImageUpload Component
 * Simple, maintainable, single-purpose component for image upload
 */

import React, { useState, useRef, useCallback } from 'react';
import { Upload } from 'lucide-react';
import { 
  convertFileToBase64, 
  isImageFile, 
  formatFileSize, 
  FILE_CONSTRAINTS 
} from '../../utils/fileUtils';
import { createFileError, createValidationError } from '../../utils/errorUtils';
import './ImageUpload.css';

const ImageUpload = ({ 
  onImageSelect, 
  onError, 
  disabled = false, 
  className = '',
  accept = 'image/*',
  maxSize = FILE_CONSTRAINTS.MAX_SIZE,
  showPreview = true,
  placeholder = 'Click to upload image or drag and drop',
  isProcessing: externalIsProcessing = false
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);


  // Handle file selection
  const handleFileSelect = useCallback(async (file) => {
    if (!file) return;

    // Validate file
    if (!isImageFile(file)) {
      const error = createFileError('Please select a valid image file');
      onError?.(error);
      return;
    }

    if (file.size > maxSize) {
      const error = createValidationError(
        `File size must be less than ${formatFileSize(maxSize)}`
      );
      onError?.(error);
      return;
    }

    try {
      // Convert to base64
      const base64 = await convertFileToBase64(file);
      
      // Create preview URL using base64 instead of blob URL
      let previewUrl = null;
      if (showPreview) {
        // Use base64 data URL instead of blob URL to avoid ERR_FILE_NOT_FOUND
        previewUrl = base64; // base64 is already a data URL from convertFileToBase64
        setPreviewUrl(previewUrl);
      }
      
      // Notify parent
      onImageSelect?.({
        file,
        base64,
        previewUrl: previewUrl
      });
      
    } catch (error) {
      const fileError = createFileError('Failed to process image file', { originalError: error });
      onError?.(fileError);
    }
  }, [onImageSelect, onError, maxSize, showPreview]);

  // Handle file input change
  const handleFileInputChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Handle drag and drop
  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((event) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    setIsDragOver(false);
    
    if (disabled) return;
    
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [disabled, handleFileSelect]);

  // Handle click to open file dialog
  const handleClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [disabled]);

  // No cleanup needed for data URLs

  return (
    <div 
      className={`upload-button-base image-upload ${className} ${isDragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileInputChange}
        disabled={disabled}
        style={{ display: 'none' }}
      />
      
      {externalIsProcessing ? (
        <div className="image-upload-processing">
          <div className="spinner" />
          <span>Processing image...</span>
        </div>
      ) : previewUrl ? (
        <div className="image-upload-preview">
          <img src={previewUrl} alt="Preview" />
          {externalIsProcessing && (
            <div className="image-upload-spinner-overlay">
              <div className="spinner" />
              <span>Processing image...</span>
            </div>
          )}
          {!externalIsProcessing && (
            <div className="image-upload-overlay">
              <span>Click to change image</span>
            </div>
          )}
        </div>
      ) : (
        <div className="image-upload-placeholder">
          <Upload size={20} />
          <span>{placeholder}</span>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
