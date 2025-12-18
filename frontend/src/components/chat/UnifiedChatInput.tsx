/**
 * UnifiedChatInput Component (TypeScript)
 * This component now correctly manages its own state and is fully typed.
 */
import React, { useState, useCallback } from 'react';
import { Plus, Brain } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ModelSelector, SendButton } from '../focused';
import { useAuth } from '../../contexts/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
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
  // New props for multi-image support
  onAnalyzeMultiImage?: (files: File[], text: string) => void;
  onFollowUpMultiImage?: (files: File[], text: string) => void;
  currentSession?: any; // Session data to check if model selection should be disabled
  contextQuestionId?: string | null;
  setContextQuestionId?: (id: string | null) => void;
}

const UnifiedChatInput: React.FC<UnifiedChatInputProps> = ({
  mode,
  selectedModel,
  isProcessing,
  onModelChange,
  onAnalyzeImage,
  onFollowUpImage,
  onSendMessage,
  onAnalyzeMultiImage,
  onFollowUpMultiImage,
  currentSession,
  contextQuestionId,
  setContextQuestionId,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { checkPermission } = useSubscription();
  const canSelectModel = checkPermission('model_selection');
  const [chatInput, setChatInput] = useState<string>('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isMultiImage, setIsMultiImage] = useState<boolean>(false);

  // Helper function to detect PDF files
  const isPDF = (file: File) => {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  };

  // PDF Preview Component
  const PDFPreview = ({ file, onRemove }: { file: File, onRemove: () => void }) => {
    const fileName = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;
    const fileSize = (file.size / 1024 / 1024).toFixed(1) + ' MB';

    return (
      <div className="pdf-preview-container">
        <div className="pdf-preview-content">
          <div className="pdf-icon-wrapper">
            <div className="pdf-icon" style={{ backgroundColor: 'rgb(250, 66, 62)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="pdf-icon-svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M11.2598 2.25191C11.8396 2.25191 12.2381 2.24808 12.6201 2.33981L12.8594 2.40719C13.0957 2.48399 13.3228 2.5886 13.5352 2.71871L13.6582 2.79879C13.9416 2.99641 14.1998 3.25938 14.5586 3.61813L15.5488 4.60836L15.833 4.89449C16.0955 5.16136 16.2943 5.38072 16.4482 5.6318L16.5703 5.84957C16.6829 6.07074 16.7691 6.30495 16.8271 6.54684L16.8574 6.69137C16.918 7.0314 16.915 7.39998 16.915 7.90719V13.0839C16.915 13.7728 16.9157 14.3301 16.8789 14.7802C16.8461 15.1808 16.781 15.5417 16.6367 15.8779L16.5703 16.0205C16.3049 16.5413 15.9008 16.9772 15.4053 17.2812L15.1865 17.4033C14.8099 17.5951 14.4041 17.6745 13.9463 17.7119C13.4961 17.7487 12.9391 17.749 12.25 17.749H7.75C7.06092 17.749 6.50395 17.7487 6.05371 17.7119C5.65317 17.6791 5.29227 17.6148 4.95606 17.4707L4.81348 17.4033C4.29235 17.1378 3.85586 16.7341 3.55176 16.2382L3.42969 16.0205C3.23787 15.6439 3.15854 15.2379 3.12109 14.7802C3.08432 14.3301 3.08496 13.7728 3.08496 13.0839V6.91695C3.08496 6.228 3.08433 5.67086 3.12109 5.22066C3.1585 4.76296 3.23797 4.35698 3.42969 3.98043C3.73311 3.38494 4.218 2.90008 4.81348 2.59664C5.19009 2.40484 5.59593 2.32546 6.05371 2.28805C6.50395 2.25126 7.06091 2.25191 7.75 2.25191H11.2598ZM7.75 3.58199C7.03896 3.58199 6.54563 3.58288 6.16211 3.61422C5.78642 3.64492 5.575 3.70168 5.41699 3.78219C5.0718 3.95811 4.79114 4.23874 4.61524 4.58395C4.53479 4.74193 4.47795 4.95354 4.44727 5.32906C4.41595 5.71254 4.41504 6.20609 4.41504 6.91695V13.0839C4.41504 13.7947 4.41594 14.2884 4.44727 14.6718C4.47798 15.0472 4.53477 15.259 4.61524 15.417L4.68555 15.5429C4.86186 15.8304 5.11487 16.0648 5.41699 16.2187L5.54688 16.2744C5.69065 16.3258 5.88016 16.3636 6.16211 16.3867C6.54563 16.418 7.03898 16.4189 7.75 16.4189H12.25C12.961 16.4189 13.4544 16.418 13.8379 16.3867C14.2135 16.356 14.425 16.2992 14.583 16.2187L14.709 16.1474C14.9963 15.9712 15.2308 15.7189 15.3848 15.417L15.4414 15.2861C15.4927 15.1425 15.5297 14.953 15.5527 14.6718C15.5841 14.2884 15.585 13.7947 15.585 13.0839V8.55758L13.3506 8.30953C12.2572 8.18804 11.3976 7.31827 11.2881 6.22359L11.0234 3.58199H7.75ZM12.6113 6.09176C12.6584 6.56193 13.0275 6.93498 13.4971 6.98727L15.5762 7.21871C15.5727 7.13752 15.5686 7.07109 15.5615 7.01266L15.5342 6.85738C15.5005 6.7171 15.4501 6.58135 15.3848 6.45309L15.3145 6.32711C15.2625 6.24233 15.1995 6.16135 15.0928 6.04488L14.6084 5.54879L13.6182 4.55856C13.2769 4.21733 13.1049 4.04904 12.9688 3.94234L12.8398 3.8525C12.7167 3.77705 12.5853 3.71637 12.4482 3.67184L12.3672 3.6484L12.6113 6.09176Z"></path>
              </svg>
            </div>
          </div>
          <div className="pdf-file-info">
            <div className="pdf-file-name">{fileName}</div>
            <div className="pdf-file-type">PDF • {fileSize}</div>
          </div>
        </div>
        <button className="pdf-remove-btn" onClick={onRemove} type="button" title="Remove PDF">
          ×
        </button>
      </div>
    );
  };

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    if (newFiles.length === 0) return;
    // Block file selection while processing
    if (isProcessing) {
      e.target.value = '';
      return;
    }


    // If we already have files and user selects more, add to existing
    if (imageFiles.length > 0 || imageFile) {
      // Filter out duplicate files by name and size
      const existingFiles: File[] = [...imageFiles, ...(imageFile ? [imageFile] : [])];
      const uniqueNewFiles = newFiles.filter(newFile =>
        !existingFiles.some(existingFile =>
          existingFile.name === newFile.name && existingFile.size === newFile.size
        )
      );

      if (uniqueNewFiles.length === 0) {
        e.target.value = ''; // Clear the file input
        return;
      }

      // Add only unique new files to existing ones
      const allFiles = [...existingFiles, ...uniqueNewFiles];
      setImageFiles(allFiles);
      setImageFile(null);
      setPreviewImage(null);
      setIsMultiImage(true);

      // Load previews for images only (skip PDFs)
      const imageFilesOnly = allFiles.filter(file => !isPDF(file));
      const readers = imageFilesOnly.map(file => {
        const reader = new FileReader();
        return new Promise<string>((resolve) => {
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            }
          };
          reader.readAsDataURL(file);
        });
      });

      if (readers.length > 0) {
        Promise.all(readers).then(previews => {
          setPreviewImages(previews);
        });
      } else {
        setPreviewImages([]);
      }
    } else if (newFiles.length === 1) {
      // Single file mode - but treat PDFs as multi-image for proper SSE handling
      const file = newFiles[0];

      if (isPDF(file)) {
        // PDFs go through multi-image path for proper SSE handling
        setImageFile(null);
        setImageFiles([file]);
        setPreviewImage(null);
        setPreviewImages([]);
        setIsMultiImage(true);
      } else {
        // Regular images go through single image path
        setImageFile(file);
        setImageFiles([]);
        setPreviewImages([]);
        setIsMultiImage(false);

        // Generate preview for images
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setPreviewImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
      }
    } else {
      // Multi-file mode (first selection)
      setImageFile(null);
      setImageFiles(newFiles);
      setPreviewImage(null);
      setIsMultiImage(true);

      // Load previews for images only (skip PDFs)
      const imageFilesOnly = newFiles.filter(file => !isPDF(file));
      const readers = imageFilesOnly.map(file => {
        const reader = new FileReader();
        return new Promise<string>((resolve) => {
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            }
          };
          reader.readAsDataURL(file);
        });
      });

      if (readers.length > 0) {
        Promise.all(readers).then(previews => {
          setPreviewImages(previews);
        });
      } else {
        setPreviewImages([]);
      }
    }

    setIsExpanded(true);
    // Don't reset the input value to allow multiple selections
  }, [imageFiles, imageFile, isMultiImage, isProcessing]);

  const handleUploadClick = useCallback(() => {
    document.getElementById('unified-file-input')?.click();
  }, []);

  const removePreview = useCallback(() => {
    setPreviewImage(null);
    setImageFile(null);
    setPreviewImages([]);
    setImageFiles([]);
    setIsMultiImage(false);
    setIsExpanded(false);
  }, []);

  const removeImageAtIndex = useCallback((indexToRemove: number) => {
    if (isMultiImage) {
      const newFiles = imageFiles.filter((_, index) => index !== indexToRemove);
      const newPreviews = previewImages.filter((_, index) => index !== indexToRemove);

      if (newFiles.length === 0) {
        // No more files, reset everything
        setImageFiles([]);
        setPreviewImages([]);
        setIsMultiImage(false);
        setIsExpanded(false);
      } else if (newFiles.length === 1) {
        // Only one file left, switch to single image mode
        setImageFile(newFiles[0]);
        setImageFiles([]);
        setPreviewImage(newPreviews[0]);
        setPreviewImages([]);
        setIsMultiImage(false);
      } else {
        // Still multiple files
        setImageFiles(newFiles);
        setPreviewImages(newPreviews);
      }
    } else {
      // Single image mode
      removePreview();
    }
  }, [isMultiImage, imageFiles, previewImages, removePreview]);

  const handleSendClick = useCallback(() => {
    if (isProcessing) return;
    const textToSend = chatInput.trim();
    const fileToSend = imageFile;
    const filesToSend = imageFiles;


    if (!textToSend && !fileToSend && filesToSend.length === 0) return;

    if (isMultiImage && filesToSend.length > 0) {
      // Multi-image mode
      const handler = mode === 'first-time' ? onAnalyzeMultiImage : onFollowUpMultiImage;
      if (handler) {
        handler(filesToSend, textToSend);
      } else {
        // Fallback: Process each file individually using single image handlers
        filesToSend.forEach((file, index) => {
          const singleHandler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
          const fileText = filesToSend.length > 1 ? `${textToSend} (File ${index + 1}/${filesToSend.length})` : textToSend;
          singleHandler(file, fileText);
        });
      }
    } else if (fileToSend) {
      // Single image mode
      const handler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
      handler(fileToSend, textToSend);
    } else if (textToSend) {
      // Text only
      onSendMessage(textToSend);
    }

    setChatInput('');
    setPreviewImage(null);
    setImageFile(null);
    setPreviewImages([]);
    setImageFiles([]);
    setIsMultiImage(false);
    setIsExpanded(false);

    // Clear the file input element to prevent duplicate uploads
    const fileInput = document.getElementById('unified-file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }, [isProcessing, chatInput, imageFile, imageFiles, isMultiImage, mode, onAnalyzeImage, onFollowUpImage, onAnalyzeMultiImage, onFollowUpMultiImage, onSendMessage]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  }, [handleSendClick]);

  const handleModelSelection = useCallback((newModel: string) => {
    // If user is trying to change away from 'auto' (or the current allowed default), check permissions
    if (newModel !== 'auto' && !canSelectModel) {
      if (window.confirm('Custom model selection is available on Enterprise plan. Would you like to upgrade?')) {
        navigate('/upgrade');
      }
      return;
    }
    onModelChange(newModel);
  }, [canSelectModel, navigate, onModelChange]);

  const handleError = (error: Error) => {
    console.error("Component Error:", error);
  };

  return (
    <>
      {mode === 'first-time' && (
        <div className="chat-title-section">
          <h2 className="chat-title-greeting">
            {user ? `Hi ${user.displayName || user.email?.split('@')[0] || 'User'}` : 'Hi there'}
          </h2>
        </div>
      )}
      <div className={`followup-chat-input-bar ${isExpanded ? 'expanded' : ''} ${mode}`}>
        <div className="followup-input-wrapper">
          {contextQuestionId && (
            <div className="context-chip-container" style={{ padding: '0 12px 8px 12px' }}>
              <div
                className="context-chip"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  backgroundColor: 'rgba(56, 55, 57, 0.95)', /* More opaque background */
                  borderRadius: '16px',
                  fontSize: '11px',
                  color: '#efefef', /* Brighter text */
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  fontWeight: 600, /* Bolder */
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)' /* Added shadow for contrast */
                }}
              >
                <Brain size={12} style={{ color: '#8b5cf6' }} /> {/* Vibe check: vibrant purple icon */}
                <span style={{ color: 'white', opacity: 1 }}>Question {contextQuestionId} Focused</span>
                <span style={{
                  fontSize: '9px',
                  backgroundColor: 'rgba(16, 185, 129, 0.25)', /* More vibrant green */
                  color: '#10b981',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  marginLeft: '2px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.3px'
                }}>Auto</span>
                <button
                  onClick={() => setContextQuestionId?.(null)}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '0 2px',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    marginLeft: '4px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                  title="Clear context"
                >
                  <Plus size={12} style={{ transform: 'rotate(45deg)' }} />
                </button>
              </div>
            </div>
          )}
          <div className={`followup-single-line-container ${isExpanded ? 'expanded' : ''}`}>
            {isExpanded && ((previewImage || previewImages.length > 0) || (imageFile && isPDF(imageFile)) || (imageFiles.length > 0 && imageFiles.some(file => isPDF(file)))) && (
              <div className="followup-preview-section">
                {isMultiImage ? (
                  <div className="followup-image-preview">
                    <div className="multi-image-preview-container">
                      <div className="multi-image-scroll">
                        {imageFiles.map((file, index) => {
                          if (isPDF(file)) {
                            return (
                              <PDFPreview
                                key={index}
                                file={file}
                                onRemove={() => removeImageAtIndex(index)}
                              />
                            );
                          }
                          // Find corresponding preview image
                          const imageIndex = imageFiles.slice(0, index).filter(f => !isPDF(f)).length;
                          const preview = previewImages[imageIndex];
                          return (
                            <div key={index} className="multi-image-item">
                              <img src={preview} alt={`Preview ${index + 1}`} className="followup-preview-image" />
                              <button
                                className="multi-image-remove"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeImageAtIndex(index);
                                }}
                                type="button"
                                title="Remove this file"
                              >
                                ×
                              </button>
                              <span className="multi-image-label">Page {index + 1}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="followup-image-preview">
                    {imageFile && isPDF(imageFile) ? (
                      <PDFPreview file={imageFile} onRemove={removePreview} />
                    ) : (
                      <>
                        <img src={previewImage || ''} alt="Preview" className="followup-preview-image" />
                        <button className="followup-remove-preview" onClick={removePreview} type="button">×</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="followup-controls-row">
              <div className="followup-text-wrapper">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={isProcessing ? "AI is processing..." : "Ask anything"}
                  disabled={isProcessing}
                  className="followup-text-input"
                />
              </div>
              <div className="followup-buttons-row">
                <div className="followup-left-buttons">
                  <button className="followup-upload-button" onClick={handleUploadClick} disabled={isProcessing} title="Upload image(s)/PDF(s)">
                    <Plus size={14} />
                  </button>
                  {/* 👇 Disable model selection if session exists and has messages (model cannot be changed after session creation) */}
                  <ModelSelector
                    selectedModel={selectedModel}
                    onModelChange={handleModelSelection}
                    disabled={isProcessing || (currentSession && currentSession.messages && currentSession.messages.length > 0)}
                    size={mode === 'first-time' ? 'main' : 'small'}
                    onError={handleError}
                  />
                </div>
                {/* 👇 FIX 2: Added the required `onError` prop. */}
                <SendButton onClick={handleSendClick} disabled={isProcessing || (!imageFile && !imageFiles.length && !chatInput?.trim())} loading={isProcessing} variant={(imageFile || imageFiles.length > 0) ? 'success' : 'primary'} size={mode === 'first-time' ? 'main' : 'small'} onError={handleError} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <input id="unified-file-input" type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} disabled={isProcessing} />
    </>
  );
};

export default UnifiedChatInput;