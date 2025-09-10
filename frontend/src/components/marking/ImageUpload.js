import React, { useState, useCallback } from 'react';
import { Upload } from 'lucide-react';
import Button from '../common/Button';
// import LoadingSpinner from '../common/LoadingSpinner'; // Not used in this component
import { SUPPORTED_FILE_TYPES } from '../../utils/constants';
import { isValidFileType, isValidFileSize, formatFileSize } from '../../utils/helpers';
// CSS imported via App.css to avoid webpack circular dependency

/**
 * Image upload component
 * @param {Object} props - Component props
 * @param {File|null} props.selectedFile - Currently selected file
 * @param {Function} props.onFileSelect - File selection handler
 * @param {boolean} props.disabled - Whether upload is disabled
 * @param {string} props.className - Additional CSS classes
 */
const ImageUpload = ({ 
  selectedFile, 
  onFileSelect, 
  disabled = false,
  className = '' 
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState(null);

  const handleFileSelect = useCallback((file) => {
    setError(null);

    // Validate file type
    if (!isValidFileType(file, SUPPORTED_FILE_TYPES.IMAGE)) {
      setError('Please select a valid image file (JPEG, PNG, WebP)');
      return;
    }

    // Validate file size
    if (!isValidFileSize(file, SUPPORTED_FILE_TYPES.MAX_SIZE)) {
      setError(`File size must be less than ${formatFileSize(SUPPORTED_FILE_TYPES.MAX_SIZE)}`);
      return;
    }

    onFileSelect(file);
  }, [onFileSelect]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [disabled, handleFileSelect]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleClick = useCallback(() => {
    if (!disabled) {
      document.getElementById('file-input')?.click();
    }
  }, [disabled]);

  return (
    <div className={`image-upload ${className}`}>
      <div
        className={`upload-area ${isDragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          id="file-input"
          type="file"
          accept={SUPPORTED_FILE_TYPES.IMAGE.join(',')}
          onChange={handleFileInputChange}
          style={{ display: 'none' }}
          disabled={disabled}
        />
        
        {selectedFile ? (
          <div className="file-preview">
            <img 
              src={URL.createObjectURL(selectedFile)} 
              alt="Preview" 
              className="preview-image"
            />
            <div className="file-info">
              <p className="file-name">{selectedFile.name}</p>
              <p className="file-size">{formatFileSize(selectedFile.size)}</p>
            </div>
            <Button
              variant="ghost"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onFileSelect(null);
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <div className="upload-placeholder">
            <Upload size={48} className="upload-icon" />
            <p className="upload-text">
              {isDragOver ? 'Drop image here' : 'Click or drag to upload'}
            </p>
            <p className="upload-hint">
              Supports JPEG, PNG, WebP up to {formatFileSize(SUPPORTED_FILE_TYPES.MAX_SIZE)}
            </p>
          </div>
        )}
      </div>
      
      {error && (
        <div className="upload-error">
          <p>{error}</p>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
