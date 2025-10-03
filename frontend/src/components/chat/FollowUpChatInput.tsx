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
  onAnalyzeImage: (file: File, text: string) => Promise<void>;
  onFollowUpImage: (file: File, text: string) => Promise<void>;
  onSendMessage: (text: string) => Promise<void>;
}

const FollowUpChatInput: React.FC<FollowUpChatInputProps> = (props) => {
  return <UnifiedChatInput {...props} />;
};

export default FollowUpChatInput;
