/**
 * Component type definitions
 */

import { ReactNode } from 'react';

// Common component props
export interface BaseComponentProps {
  className?: string;
  children?: ReactNode;
}

// Button component props
export interface ButtonProps extends BaseComponentProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}

// Modal component props
export interface ModalProps extends BaseComponentProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'small' | 'medium' | 'large' | 'full';
  closable?: boolean;
}

// Loading spinner props
export interface LoadingSpinnerProps extends BaseComponentProps {
  size?: 'small' | 'medium' | 'large';
  color?: 'primary' | 'secondary' | 'white' | 'success' | 'danger';
  text?: string;
}

// Image upload props
export interface ImageUploadProps extends BaseComponentProps {
  selectedFile: File | null;
  onFileSelect: (file: File | null) => void;
  disabled?: boolean;
}

// Chat interface props
export interface ChatInterfaceProps extends BaseComponentProps {
  messages: ChatMessage[];
  onSendMessage: (message: ChatMessage) => void;
  isProcessing?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

// Chat message
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  type?: string;
  imageData?: string;
  fileName?: string;
  apiUsed?: string;
  showRaw?: boolean;
  rawContent?: string;
  detectedQuestion?: {
    examDetails: Record<string, any>;
    questionNumber: string;
    questionText: string;
    confidence: number;
  };
}

// Mark homework page props
export interface MarkHomeworkPageProps {
  selectedMarkingResult?: any;
  onClearSelectedResult?: () => void;
  onMarkingResultSaved?: () => void;
  onPageModeChange?: (mode: string) => void;
}
