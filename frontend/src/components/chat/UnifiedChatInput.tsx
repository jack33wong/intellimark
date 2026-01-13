/**
 * UnifiedChatInput Component (TypeScript)
 * This component now correctly manages its own state and is fully typed.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Plus, Brain, X, Check, Sparkles, Smartphone, UploadCloud } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import LandingPageUploadWidget from '../common/LandingPageUploadWidget';
import MobileUploadModal from '../upload/MobileUploadModal';
import ImageModeModal from '../common/ImageModeModal';
import { ModelSelector, SendButton } from '../focused';
import { useAuth } from '../../contexts/AuthContext';
import { useSubscription } from '../../hooks/useSubscription';
import ApiClient from '../../services/apiClient';
import ConfirmationModal from '../common/ConfirmationModal';
import { mobileUploadService } from '../../services/MobileUploadService';
import { FileHandoff } from './FileHandoff';
import './UnifiedChatInput.css';

// Define the type for the props this component receives
interface UnifiedChatInputProps {
  mode: 'first-time' | 'follow-up';
  selectedModel: string;
  isProcessing: boolean;
  onModelChange: (model: string) => void;
  onAnalyzeImage: (file: File, text: string) => Promise<boolean> | any;
  onFollowUpImage: (file: File, text: string) => Promise<boolean> | any;
  onSendMessage: (text: string) => Promise<boolean> | any;
  // New props for multi-image support
  onAnalyzeMultiImage?: (files: File[], text: string) => Promise<boolean> | any;
  onFollowUpMultiImage?: (files: File[], text: string) => Promise<boolean> | any;
  currentSession?: any; // Session data to check if model selection should be disabled
  contextQuestionId?: string | null;
  setContextQuestionId?: (id: string | null) => void;
  isNegative?: boolean;
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
  isNegative = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { checkPermission } = useSubscription();
  const [canSelectModel, setCanSelectModel] = useState<boolean>(true); // Initialize with true, we'll check permission later
  const [chatInput, setChatInput] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isMultiImage, setIsMultiImage] = useState<boolean>(false);

  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
  const [isMobileUploadOpen, setIsMobileUploadOpen] = useState<boolean>(false);
  const [mobileSessionId, setMobileSessionId] = useState<string>('');


  const [showImageMode, setShowImageMode] = useState<boolean>(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);


  // Metadata & Autocomplete State
  const [metadata, setMetadata] = useState<{ boards: string[], tiers: string[], papers: string[] }>({
    boards: [],
    tiers: [],
    papers: [],
  });
  const [showAutocomplete, setShowAutocomplete] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  // Dynamic filtering logic using useMemo (Modern React)
  const filteredResults = useMemo(() => {
    if (mode !== 'first-time') return [];

    // If no text typed and no chip selected, show empty suggestions list
    if (chatInput.trim().length === 0 && selectedTags.length === 0) {
      return [];
    }

    let filtered = metadata.papers;

    // 1. Filter by ALL selected tags (Facet logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter(paper =>
        selectedTags.every(tag => paper.toLowerCase().includes(tag.toLowerCase()))
      );
    }

    // 2. Further filter by typing buffer
    if (chatInput.trim().length > 0) {
      filtered = filtered.filter(paper =>
        paper.toLowerCase().includes(chatInput.toLowerCase())
      );
    }

    return filtered.slice(0, 10);
  }, [metadata.papers, selectedTags, chatInput, mode]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHandoff, setShowHandoff] = useState<boolean>(false);
  const handoverProcessedRef = useRef(false);

  // Check model selection permission once subscribe hook is available
  useEffect(() => {
    setCanSelectModel(checkPermission('model_selection'));
  }, [checkPermission]);
  // Fetch metadata on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const response = await ApiClient.get('/api/config/exam-metadata');
        if (response.data) {
          setMetadata(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch exam metadata:', error);
      }
    };
    fetchMetadata();
  }, []);

  // Autocomplete will now stay open as long as there is input (no outside-click close)


  // Filter suggestions based on input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setChatInput(value);
    if (mode === 'first-time') {
      setShowAutocomplete(true);
      setHighlightedIndex(-1);
    }
  };

  const toggleFilterTag = (tag: string, categoryTags: string[] = []) => {
    const isSelected = selectedTags.some(t => t.toLowerCase() === tag.toLowerCase());

    setSelectedTags(prev => {
      if (isSelected) {
        // Toggle OFF
        return prev.filter(t => t.toLowerCase() !== tag.toLowerCase());
      } else {
        // Toggle ON: remove others in same category
        const filtered = prev.filter(t =>
          !categoryTags.some(ct => ct.toLowerCase() === t.toLowerCase())
        );
        return [...filtered, tag];
      }
    });

    setShowAutocomplete(true);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };

  const removeTag = (tagToRemove: string) => {
    setSelectedTags(prev => prev.filter(tag => tag !== tagToRemove));
    inputRef.current?.focus();
  };

  const combinedInput = React.useMemo(() => {
    const tagsPart = selectedTags.length > 0 ? selectedTags.join(' ') : '';
    const inputPart = chatInput.trim();
    return tagsPart ? (inputPart ? `${tagsPart} ${inputPart}` : tagsPart) : inputPart;
  }, [selectedTags, chatInput]);

  const handleSuggestionClick = (suggestion: string) => {
    // Click selected paper suggestion: populate input for confirmation
    setChatInput(suggestion);
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

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

  const processFiles = useCallback((newFiles: File[]) => {
    if (newFiles.length === 0) return;
    // Block file selection while processing
    if (isProcessing) return;

    // If we already have files and user selects more, add to existing
    if (imageFiles.length > 0 || imageFile) {
      // Filter out duplicate files by name and size
      const existingFiles: File[] = [...imageFiles, ...(imageFile ? [imageFile] : [])];
      const uniqueNewFiles = newFiles.filter(newFile =>
        !existingFiles.some(existingFile =>
          existingFile.name === newFile.name && existingFile.size === newFile.size
        )
      );

      if (uniqueNewFiles.length === 0) return;

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
  }, [imageFiles, imageFile, isMultiImage, isProcessing]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    processFiles(newFiles);
    // Clear the input value so the same file can be selected again
    if (e.target) e.target.value = '';
  }, [processFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (isProcessing) return;

    const items = e.clipboardData.items;
    const pastedFiles: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1 || item.type === 'application/pdf') {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }

    if (pastedFiles.length > 0) {
      // If we found images/PDFs, process them
      processFiles(pastedFiles);

      // Prevent the default paste behavior (which might insert filenames or text)
      // to keep the chat input clean for the user's typing.
      e.preventDefault();
    }
  }, [processFiles, isProcessing]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenCameraHandoff = useCallback(async () => {
    let sessionId = mobileSessionId;
    if (!sessionId) {
      sessionId = mobileUploadService.generateSessionId();
      setMobileSessionId(sessionId);
      try {
        await mobileUploadService.createSession(sessionId);
      } catch (err) {
        console.error('Failed to create session:', err);
      }
    }

    // Save session ID for return flow
    localStorage.setItem('active_mobile_session_id', sessionId);

    // Clean Handoff and redirect
    setShowHandoff(false);
    // Clean URL
    window.history.replaceState({}, '', '/app');

    // Redirect to mobile camera page with return URL
    window.location.href = `/mobile-upload/${sessionId}?returnUrl=${encodeURIComponent('/app')}`;
  }, [mobileSessionId]);

  // V16.5: Restore session on return from camera
  useEffect(() => {
    const savedSessionId = localStorage.getItem('active_mobile_session_id');
    if (savedSessionId) {
      console.log('[MobileSync] Restoring active session:', savedSessionId);
      setMobileSessionId(savedSessionId);
    }
  }, []);

  // Handle Action deep links (from Landing Page) via FileHandoff Bridge
  useEffect(() => {
    if (mode !== 'first-time') return;

    const params = new URLSearchParams(location.search);
    const action = params.get('action');

    if (action === 'select' || action === 'upload') {
      setShowHandoff(true);
    } else if (action === 'scan') {
      // Direct detection of mobile to skip bridge on desktop
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        setShowHandoff(true);
      } else {
        // Desktop: Show QR code modal immediately
        setIsMobileUploadOpen(true);
        // Clean URL to prevent re-opening on refresh
        window.history.replaceState({}, '', '/app');
      }
    }
  }, [location.search, mode]);

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

  const handleSendClick = useCallback(async () => {
    if (isProcessing) return;
    const textToSend = combinedInput;
    const fileToSend = imageFile;
    const filesToSend = imageFiles;

    if (!textToSend && !fileToSend && filesToSend.length === 0) return;

    let success = true;

    if (isMultiImage && filesToSend.length > 0) {
      // Multi-image mode
      const handler = mode === 'first-time' ? onAnalyzeMultiImage : onFollowUpMultiImage;
      if (handler) {
        const result = await (handler as any)(filesToSend, textToSend);
        if (result === false) success = false;
      } else {
        // Fallback: Process each file individually using single image handlers
        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];
          const singleHandler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
          const fileText = filesToSend.length > 1 ? `${textToSend} (File ${i + 1}/${filesToSend.length})` : textToSend;
          const result = await (singleHandler as any)(file, fileText);
          if (result === false) {
            success = false;
            break;
          }
        }
      }
    } else if (fileToSend) {
      // Single image mode
      const handler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
      const result = await (handler as any)(fileToSend, textToSend);
      if (result === false) success = false;
    } else if (textToSend) {
      // Text only
      const result = await (onSendMessage as any)(textToSend);
      if (result === false) success = false;
    }

    if (success) {
      setChatInput('');
      setSelectedTags([]);
      setPreviewImage(null);
      setImageFile(null);
      setPreviewImages([]);
      setImageFiles([]);
      setIsMultiImage(false);
      setIsExpanded(false);

      // Finalize Mobile Session if it exists
      if (mobileSessionId) {
        mobileUploadService.cleanupSession(mobileSessionId);
        setMobileSessionId('');
      }

      // Clear the file input element to prevent duplicate uploads
      const fileInput = document.getElementById('unified-file-input') as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
    }
  }, [isProcessing, combinedInput, imageFile, imageFiles, isMultiImage, mode, onAnalyzeImage, onFollowUpImage, onAnalyzeMultiImage, onFollowUpMultiImage, onSendMessage]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    } else if (e.key === 'Backspace' && chatInput === '' && selectedTags.length > 0) {
      // If user presses Backspace with empty input, remove the last tag
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  };

  const handleModelSelection = useCallback((newModel: string) => {
    // If user is trying to change away from 'auto' (or the current allowed default), check permissions
    if (newModel !== 'auto' && !canSelectModel) {
      setShowUpgradeModal(true);
      return;
    }
    onModelChange(newModel);
  }, [canSelectModel, onModelChange]);

  // V16.4: Background Mobile Sync Logic
  const handleMobileImages = useCallback(async (imageUrls: string[]) => {
    try {
      const newFiles: File[] = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        const response = await fetch(url);
        const blob = await response.blob();
        const filename = `mobile-scan-${Date.now()}-${i}.jpg`;
        newFiles.push(new File([blob], filename, { type: 'image/jpeg' }));
      }

      // Collect existing files/previews
      let currentFiles: File[] = [];
      let currentPreviews: string[] = [];

      // If we already had a single image, convert it to the array
      if (imageFile) {
        currentFiles = [imageFile];
        currentPreviews = [previewImage!];
      } else if (imageFiles.length > 0) {
        currentFiles = [...imageFiles];
        currentPreviews = [...previewImages];
      }

      const combinedFiles = [...currentFiles, ...newFiles];
      const combinedPreviews = [...currentPreviews, ...imageUrls];

      if (combinedFiles.length === 1) {
        setImageFile(combinedFiles[0]);
        setImageFiles([]);
        setPreviewImage(combinedPreviews[0]);
        setPreviewImages([]);
        setIsMultiImage(false);
      } else {
        setImageFiles(combinedFiles);
        setImageFile(null);
        setPreviewImage(null);
        setPreviewImages(combinedPreviews);
        setIsMultiImage(true);
      }
      setIsExpanded(true);

      // Cleanup session persistence after successful receipt
      localStorage.removeItem('active_mobile_session_id');
    } catch (err) {
      console.error('Failed to process mobile images:', err);
    }
  }, [imageFile, imageFiles, previewImage, previewImages, setImageFile, setImageFiles, setPreviewImage, setPreviewImages, setIsMultiImage, setIsExpanded]);

  // The actual background listener
  useEffect(() => {
    if (!mobileSessionId) return;

    console.log("[MobileSync] Background listener active for:", mobileSessionId);
    const unsubscribe = mobileUploadService.listenToSession(mobileSessionId, (session) => {
      if (session && session.status === 'completed' && session.imageUrls && session.imageUrls.length > 0) {
        console.log("[MobileSync] Batch detected in background!");
        handleMobileImages(session.imageUrls);
        // Reset immediately for the next batch
        mobileUploadService.resetSession(mobileSessionId);
      }
    });

    return () => unsubscribe();
  }, [mobileSessionId, handleMobileImages]);

  const handleError = (error: Error) => {
    console.error("Component Error:", error);
  };

  return (
    <>
      {mode === 'first-time' && (
        <div className={`chat-title-section ${isExpanded ? 'shift-up' : ''}`}>
          <div className="user-greeting">
            <Sparkles size={18} className="greeting-sparkle" />
            <span>Hi {user?.displayName?.split(' ')[0] || 'there'}</span>
          </div>
          <p className="chat-title-greeting">
            Precision Spatial AI Marking
          </p>
          <p className="chat-title-description">
            Unlock method marks (M1) and board-aligned feedback with every scan.
          </p>
        </div>
      )}

      <div className={`followup-chat-input-bar ${isExpanded ? 'expanded' : ''} ${mode}`}>
        <div className="followup-input-wrapper">
          {contextQuestionId && (
            <div className="context-chip-container">
              <div className="context-chip">
                <Brain size={12} />
                <span className="chip-label">Question {contextQuestionId} Focused</span>
                <span className="chip-sublabel">AUTO</span>
                <button
                  onClick={() => setContextQuestionId?.(null)}
                  className="context-chip-close"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
          <div className={`followup-single-line-container ${isExpanded ? 'expanded' : ''} ${isNegative ? 'negative-credits' : ''}`}>
            {isNegative && (
              <div className="negative-credits-warning">
                <span className="warning-icon">⚠️</span>
                <span>You have insufficient credits. Please top up or upgrade to continue.</span>
                <button
                  className="warning-action-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate('/upgrade', { state: { fromApp: true } });
                  }}
                >
                  Top Up
                </button>
              </div>
            )}


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
                              <img
                                src={preview}
                                alt={`Preview ${index + 1}`}
                                className="followup-preview-image clickable"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveImageIndex(imageIndex);
                                  setShowImageMode(true);
                                }}
                              />
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
                        <img
                          src={previewImage || ''}
                          alt="Preview"
                          className="followup-preview-image clickable"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveImageIndex(0);
                            setShowImageMode(true);
                          }}
                        />
                        <button className="followup-remove-preview" onClick={(e) => { e.stopPropagation(); removePreview(); }} type="button">×</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="followup-controls-row">
              <div className="followup-text-wrapper">
                <textarea
                  ref={inputRef}
                  value={chatInput}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  onPaste={handlePaste}
                  placeholder={
                    isProcessing
                      ? "AI is processing..."
                      : mode === 'follow-up'
                        ? "Ask a follow-up question about your marks..."
                        : "Search exam code (e.g., Edexcel June 2024 3H) to start your marking session..."
                  }
                  disabled={isProcessing}
                  className="followup-text-input"
                  onFocus={() => {
                    if (mode === 'first-time') {
                      setShowAutocomplete(true);
                    }
                  }}
                />
              </div>
              <div className="followup-buttons-row">
                <div className="followup-left-buttons">
                  <button className="followup-upload-button" onClick={handleUploadClick} disabled={isProcessing} title="Upload image(s)/PDF(s)">
                    <Plus size={14} />
                  </button>
                  <button
                    className="followup-upload-button mobile-scan-btn"
                    onClick={() => {
                      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                      if (isMobile) {
                        handleOpenCameraHandoff();
                      } else {
                        setIsMobileUploadOpen(true);
                      }
                    }}
                    disabled={isProcessing}
                    title="Scan from Mobile"
                  >
                    <Smartphone size={14} />
                  </button>
                </div>
                <div className="followup-right-buttons">
                  {/* 👇 Disable model selection if session exists and has messages (model cannot be changed after session creation) */}
                  <ModelSelector
                    selectedModel={selectedModel}
                    onModelChange={handleModelSelection}
                    disabled={isProcessing || (currentSession && currentSession.messages && currentSession.messages.length > 0)}
                    size={mode === 'first-time' ? 'main' : 'small'}
                    dropdownDirection={mode === 'first-time' ? 'down' : 'up'}
                    onError={handleError}
                  />
                  {/* 👇 FIX 2: Added the required `onError` prop. */}
                  {/* 👇 SendButton disabled logic updated to check combinedInput */}
                  <SendButton
                    onClick={handleSendClick}
                    disabled={isProcessing || (!imageFile && !imageFiles.length && !combinedInput.trim())}
                    loading={isProcessing}
                    variant={(imageFile || imageFiles.length > 0) ? 'success' : 'primary'}
                    size={mode === 'first-time' ? 'main' : 'small'}
                    onError={handleError}
                  />
                </div>
              </div>
            </div>
          </div>
          {showAutocomplete && mode === 'first-time' && (
            <div className="autocomplete-dropdown inline-style" ref={dropdownRef}>
              <div className="autocomplete-chips-section">
                <div className="autocomplete-chips-label">Quick Filters:</div>
                <div className="autocomplete-chips-container">
                  {metadata.boards.map(board => (
                    <button
                      key={board}
                      className={`filter-chip board ${selectedTags.includes(board) ? 'active' : ''}`}
                      onClick={() => toggleFilterTag(board, metadata.boards)}
                    >
                      {board}
                    </button>
                  ))}
                  {metadata.tiers.map(tier => (
                    <button
                      key={tier}
                      className={`filter-chip tier ${selectedTags.includes(tier) ? 'active' : ''}`}
                      onClick={() => toggleFilterTag(tier, metadata.tiers)}
                    >
                      {tier}
                    </button>
                  ))}
                </div>
              </div>

              {filteredResults.length > 0 && (
                <div className="autocomplete-results-list">
                  <div className="autocomplete-results-label">Suggestions:</div>
                  {filteredResults.map((result, index) => (
                    <div
                      key={result}
                      className={`autocomplete-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                      onClick={() => handleSuggestionClick(result)}
                    >
                      <Brain size={12} className="suggestion-icon" />
                      <span className="suggestion-text">{result}</span>
                      {chatInput.toLowerCase().includes(result.toLowerCase()) && <Check size={12} className="check-icon" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <input ref={fileInputRef} id="unified-file-input" type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} disabled={isProcessing} />

      <MobileUploadModal
        isOpen={isMobileUploadOpen}
        onClose={() => setIsMobileUploadOpen(false)}
        onImageReceived={handleMobileImages}
        sessionIdProp={mobileSessionId}
        onSessionCreated={setMobileSessionId}
      />

      {showHandoff && (
        <FileHandoff
          onFilesSelected={(files) => processFiles(files)}
          onClose={() => setShowHandoff(false)}
          onOpenCamera={handleOpenCameraHandoff}
        />
      )}

      {/* Enterprise Upgrade Modal */}
      <ConfirmationModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        onConfirm={() => {
          setShowUpgradeModal(false);
          navigate('/upgrade', { state: { fromApp: true } });
        }}
        title="Upgrade to Enterprise"
        message="Custom model selection is available on the Enterprise plan. Would you like to upgrade now and unlock all powerful AI models?"
        confirmText="View Plans"
        cancelText="Maybe Later"
        variant="primary"
      />

      {/* Render Image Mode Modal */}
      {showImageMode && (
        <ImageModeModal
          isOpen={showImageMode}
          images={(isMultiImage ? previewImages : (previewImage ? [previewImage] : [])).map((src, idx) => ({
            id: `preview-${idx}`,
            src,
            filename: `preview-${idx}.jpg`,
            messageId: 'preview',
            messageRole: 'user',
            messageType: 'preview',
            alt: 'Preview Image'
          }))}
          initialImageIndex={activeImageIndex}
          onClose={() => setShowImageMode(false)}
        />
      )}
    </>
  );
};

export default UnifiedChatInput;