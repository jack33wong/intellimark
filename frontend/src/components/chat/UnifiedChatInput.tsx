/**
 * UnifiedChatInput Component (TypeScript)
 * This component now correctly manages its own state and is fully typed.
 */
import React, { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { ModelSelector, SendButton } from '../focused';
import { useAuth } from '../../contexts/AuthContext';
import './UnifiedChatInput.css';

// Define the type for the props this component receives
interface UnifiedChatInputProps {
  mode: 'first-time' | 'follow-up';
  selectedModel: string;
  isProcessing: boolean;
  onModelChange: (model: string) => void;
  onAnalyzeImage: (file: File, text: string) => void;
  onFollowUpImage: (file: File, text: string) => void;
  onSendMessage: (text: string) => void;
}

const UnifiedChatInput: React.FC<UnifiedChatInputProps> = ({
  mode,
  selectedModel,
  isProcessing,
  onModelChange,
  onAnalyzeImage,
  onFollowUpImage,
  onSendMessage,
}) => {
  const { user } = useAuth();
  const [chatInput, setChatInput] = useState<string>('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null); 
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file); 
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setPreviewImage(reader.result);
        }
      };
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

  const handleSendClick = useCallback(() => {
    if (isProcessing) return;
    const textToSend = chatInput.trim();
    const fileToSend = imageFile;
    if (!textToSend && !fileToSend) return;

    if (fileToSend) {
      const handler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
      handler(fileToSend, textToSend);
    } else if (textToSend) {
      onSendMessage(textToSend);
    }
    
    setChatInput('');
    setPreviewImage(null);
    setImageFile(null);
    setIsExpanded(false);
  }, [isProcessing, chatInput, imageFile, mode, onAnalyzeImage, onFollowUpImage, onSendMessage]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  }, [handleSendClick]);

  const handleError = (error: Error) => {
    console.error("Component Error:", error);
  };
  
  return (
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
                  {/* 👇 FIX 1: Changed `isProcessing` to the correct `disabled` prop. */}
                  <ModelSelector selectedModel={selectedModel} onModelChange={onModelChange} disabled={isProcessing} size={mode === 'first-time' ? 'main' : 'small'} onError={handleError} />
                </div>
                {/* 👇 FIX 2: Added the required `onError` prop. */}
                <SendButton onClick={handleSendClick} disabled={isProcessing || (!imageFile && !chatInput?.trim())} loading={isProcessing} variant={imageFile ? 'success' : 'primary'} size={mode === 'first-time' ? 'main' : 'small'} onError={handleError} />
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

