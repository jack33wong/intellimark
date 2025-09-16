/**
 * Unified Image Upload Component
 * Single component for ALL image processing
 * Eliminates multiple code paths and complexity
 */

import React, { useState, useCallback } from 'react';
import { useImageProcessing } from '../hooks/useImageProcessing';
import { useAuth } from '../contexts/AuthContext';
import { Brain, Upload, Send } from 'lucide-react';
import { validateFile, validateModel } from '../utils/validation';
import './UnifiedImageUpload.css';

const UnifiedImageUpload = ({ onImageProcessed, onMessagesUpdate }) => {
  const { user } = useAuth();
  const { status, userMessage, aiMessage, sessionId, error, isWaitingForAI, messages, processImage, reset } = useImageProcessing();
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');

  // Handle file selection with fail-fast validation
  const handleFileSelect = useCallback((event) => {
    const file = event.target.files[0];
    
    if (!file) {
      return; // No file selected, this is normal
    }

    try {
      // Fail fast on invalid file
      validateFile(file);
      setSelectedFile(file);
      reset(); // Reset processing state
    } catch (error) {
      // Show error to user immediately
      console.error('❌ File validation failed:', error.message);
      // Reset file input
      event.target.value = '';
      // Could dispatch error state here if needed
    }
  }, [reset]);

  // Handle image processing with fail-fast validation
  const handleProcessImage = useCallback(async () => {
    // Fail fast on missing file
    if (!selectedFile) {
      console.error('❌ No file selected for processing');
      return;
    }

    try {
      // Validate inputs before processing
      validateFile(selectedFile);
      validateModel(selectedModel);

      await processImage(selectedFile, {
        model: selectedModel,
        isFollowUp: false
      });
    } catch (error) {
      console.error('❌ Image processing failed:', error);
      // Error is already handled by the hook's error state
    }
  }, [selectedFile, selectedModel, processImage]);

  // Handle follow-up image processing with fail-fast validation
  const handleFollowUpImage = useCallback(async (file) => {
    // Fail fast on missing file
    if (!file) {
      console.error('❌ No file provided for follow-up processing');
      return;
    }

    try {
      // Validate inputs before processing
      validateFile(file);
      validateModel(selectedModel);

      await processImage(file, {
        model: selectedModel,
        sessionId: sessionId,
        isFollowUp: true
      });
    } catch (error) {
      console.error('❌ Follow-up image processing failed:', error);
      // Error is already handled by the hook's error state
    }
  }, [selectedModel, sessionId, processImage]);

  // Update messages whenever messages change
  React.useEffect(() => {
    if (messages?.length > 0) {
      onMessagesUpdate?.(messages);
    }
  }, [messages, onMessagesUpdate]);

  // Notify parent when image is processed
  React.useEffect(() => {
    if (userMessage) {
      onImageProcessed?.(userMessage, sessionId);
    }
  }, [userMessage, sessionId, onImageProcessed]);

  return (
    <div className="unified-image-upload">
      {/* File Selection */}
      <div className="upload-section">
        <div className="file-input-container">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="file-input"
            id="image-upload"
          />
          <label htmlFor="image-upload" className="file-input-label">
            <Upload size={20} />
            <span>{selectedFile ? selectedFile.name : 'Choose Image'}</span>
          </label>
        </div>

        {/* Model Selection */}
        <div className="model-selection">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="model-select"
          >
            <option value="chatgpt-4o">ChatGPT-4 Omni</option>
            <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
            <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
          </select>
        </div>

        {/* Process Button */}
        <button
          onClick={handleProcessImage}
          disabled={!selectedFile || status === 'processing'}
          className="process-button"
        >
          {status === 'processing' ? (
            <Brain size={20} className="spinning" />
          ) : (
            <Send size={20} />
          )}
          <span>
            {status === 'processing' ? 'Processing...' : 'Process Image'}
          </span>
        </button>
      </div>

      {/* Error Display with Fail-Fast Feedback */}
      {status === 'error' && (
        <div className="error-message" role="alert" aria-live="polite">
          <div className="error-icon">❌</div>
          <div className="error-content">
            <div className="error-title">Processing Error</div>
            <div className="error-details">{error}</div>
          </div>
        </div>
      )}

      {/* AI Thinking Indicator */}
      {isWaitingForAI && (
        <div className="ai-thinking">
          <Brain size={20} className="spinning" />
          <span>AI is thinking...</span>
        </div>
      )}

      {/* Debug Info (Development Only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="debug-info">
          <h4>Debug Info:</h4>
          <pre>{JSON.stringify({
            status: status || 'undefined',
            hasUserMessage: !!userMessage,
            hasAiMessage: !!aiMessage,
            sessionId: sessionId || 'undefined',
            isWaitingForAI: isWaitingForAI || false
          }, null, 2)}</pre>
        </div>
      )}
    </div>
  );
};

export default UnifiedImageUpload;
