/**
 * FollowUpChatInput Component
 * 
 * Compact single-line chat input for follow-up messages
 * Now uses UnifiedChatInput for follow-up mode
 */

import React from 'react';
import UnifiedChatInput from './UnifiedChatInput';

const FollowUpChatInput = ({
  selectedModel,
  isProcessing,
  onAnalyzeImage,
  onFollowUpImage,
  onUploadClick,
  clearPreview,
  currentSession
}) => {
  return (
    <UnifiedChatInput
      mode="follow-up"
      selectedModel={selectedModel}
      isProcessing={isProcessing}
      onAnalyzeImage={onAnalyzeImage}
      onFollowUpImage={onFollowUpImage}
      onUploadClick={onUploadClick}
      clearPreview={clearPreview}
      currentSession={currentSession}
    />
  );
};

export default FollowUpChatInput;