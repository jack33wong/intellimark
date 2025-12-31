/**
 * FollowUpChatInput Component (TypeScript)
 * This component is a simple wrapper that passes all necessary props
 * down to the UnifiedChatInput component.
 */
import React from 'react';
import UnifiedChatInput from './UnifiedChatInput';

// Define the type for the props this component receives
interface FollowUpChatInputProps {
  mode: 'first-time' | 'follow-up';
  selectedModel: string;
  isProcessing: boolean;
  onModelChange: (model: string) => void;
  onAnalyzeImage: (file: File, text: string) => Promise<boolean> | any;
  onFollowUpImage: (file: File, text: string) => Promise<boolean> | any;
  onSendMessage: (text: string) => Promise<boolean> | any;
  onAnalyzeMultiImage?: (files: File[], text: string) => Promise<boolean> | any;
  onFollowUpMultiImage?: (files: File[], text: string) => Promise<boolean> | any;
  currentSession?: any; // Session data to check if model selection should be disabled
  contextQuestionId?: string | null;
  setContextQuestionId?: (id: string | null) => void;
  isNegative?: boolean;
}

const FollowUpChatInput: React.FC<FollowUpChatInputProps> = (props) => {
  return <UnifiedChatInput {...props} />;
};

export default FollowUpChatInput;
