/**
 * UnifiedChatInput Component
 * This is the definitive version. It combines the correct, single-render-path
 * architecture with the "fire-and-forget" submission logic to fix all
 * outstanding layout and functional bugs.
 */
import React, { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { ModelSelector, SendButton, ImageUpload } from '../focused';
import { useAuth } from '../../contexts/AuthContext';
import './UnifiedChatInput.css';

const UnifiedChatInput = ({
  mode,
  selectedModel,
  isProcessing,
  onModelChange,
  onAnalyzeImage,
  onFollowUpImage,
  onSendMessage,
}) => {
  const { user } = useAuth();
  const [chatInput, setChatInput] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [imageFile, setImageFile] = useState(null); 
  const [isExpanded, setIsExpanded] = useState(false);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file); 
      const reader = new FileReader();
      reader.onload = () => setPreviewImage(reader.result);
      reader.readAsDataURL(file);
      setIsExpanded(true);
    }
    e.target.value = '';
  }, []);

  const handleUploadClick = useCallback(() => {
    document.getElementById('unified-file-input')?.click();
  }, []);

  const removePreview = useCallback(() => {
    setPreviewImage(null);
    setImageFile(null); 
    setIsExpanded(false);
  }, []);

  // 👇 FIX 1: The `handleSendClick` function correctly "fires-and-forgets"
  // the submission, allowing the UI to clean up immediately.
  const handleSendClick = useCallback(() => {
    if (isProcessing) return;
    const textToSend = chatInput.trim();
    const fileToSend = imageFile;
    if (!textToSend && !fileToSend) return;

    if (fileToSend) {
      // The parent passes the same handler for both modes
      onAnalyzeImage?.(fileToSend, textToSend);
    } else if (textToSend) {
      onSendMessage?.(textToSend);
    }
    
    // Immediately clean up the local UI state.
    setChatInput('');
    setPreviewImage(null);
    setImageFile(null);
    setIsExpanded(false);
  }, [isProcessing, chatInput, imageFile, onAnalyzeImage, onSendMessage]);

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  }, [handleSendClick]);
  
  return (
    // 👇 FIX 2: The component has a single, unified render path with a fragment
    // as its root. This restores your correct CSS-driven architecture.
    <>
      {mode === 'first-time' && (
        <div className="chat-title-section">
            <h2 className="chat-title-greeting">
              {user ? `Hello ${user.displayName || user.email?.split('@')[0] || 'User'}!` : 'Hello!'}
            </h2>
            <p className="chat-title-subtitle">
              What can I do for you?
            </p>
        </div>
      )}
      <div className={`followup-chat-input-bar ${isExpanded ? 'expanded' : ''}`}>
        <div className="followup-input-wrapper">
          <div className={`followup-single-line-container ${isExpanded ? 'expanded' : ''}`}>
            {isExpanded && previewImage && (
              <div className="followup-preview-section">
                <div className="followup-image-preview">
                  <img src={previewImage} alt="Preview" className="followup-preview-image" />
                  <button className="followup-remove-preview" onClick={removePreview} type="button">×</button>
                </div>
              </div>
            )}
            <div className="followup-controls-row">
              <div className="followup-text-wrapper">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={isProcessing ? "AI is processing..." : "Ask me anything, or upload an image..."}
                  disabled={isProcessing}
                  className="followup-text-input"
                />
              </div>
              <div className="followup-buttons-row">
                <div className="followup-left-buttons">
                  <button className="followup-upload-button" onClick={handleUploadClick} disabled={isProcessing} title="Upload image">
                    <Plus size={14} />
                  </button>
                  <ModelSelector selectedModel={selectedModel} onModelChange={onModelChange} isProcessing={isProcessing} size={mode === 'first-time' ? 'main' : 'small'} />
                </div>
                <SendButton onClick={handleSendClick} disabled={isProcessing || (!imageFile && !chatInput?.trim())} loading={isProcessing} variant={imageFile ? 'success' : 'primary'} size={mode === 'first-time' ? 'main' : 'small'} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <input id="unified-file-input" type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} disabled={isProcessing} />
    </>
  );
};

export default UnifiedChatInput;

