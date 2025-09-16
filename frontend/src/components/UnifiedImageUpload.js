/**
 * Unified Image Upload Component
 * Single component for ALL image processing
 * Eliminates multiple code paths and complexity
 */

import React, { useState, useCallback } from 'react';
import { useImageProcessing } from '../hooks/useImageProcessing';
import { useAuth } from '../contexts/AuthContext';
import { Brain, Upload, Send } from 'lucide-react';
import './UnifiedImageUpload.css';

const UnifiedImageUpload = ({ onImageProcessed, onMessagesUpdate }) => {
  const { user } = useAuth();
  const { status, userMessage, aiMessage, sessionId, error, isWaitingForAI, messages, processImage, reset } = useImageProcessing();
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState('chatgpt-4o');

  // Handle file selection
  const handleFileSelect = useCallback((event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedFile(file);
      reset(); // Reset processing state
    }
  }, [reset]);

  // Handle image processing
  const handleProcessImage = useCallback(async () => {
    if (!selectedFile) return;

    try {
      await processImage(selectedFile, {
        model: selectedModel,
        isFollowUp: false
      });
    } catch (error) {
      console.error('❌ Image processing failed:', error);
    }
  }, [selectedFile, selectedModel, processImage]);

  // Handle follow-up image processing
  const handleFollowUpImage = useCallback(async (file) => {
    if (!file) return;

    try {
      await processImage(file, {
        model: selectedModel,
        sessionId: sessionId,
        isFollowUp: true
      });
    } catch (error) {
      console.error('❌ Follow-up image processing failed:', error);
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

      {/* Status Display */}
      {status === 'error' && (
        <div className="error-message">
          ❌ {error}
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
