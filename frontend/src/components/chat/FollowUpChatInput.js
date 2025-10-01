/**
 * FollowUpChatInput Component
 * Correctly acts as a simple wrapper that passes all necessary props
 * down to the UnifiedChatInput component.
 */

import React from 'react';
import UnifiedChatInput from './UnifiedChatInput';

const FollowUpChatInput = ({
  mode,
  selectedModel,
  isProcessing,
  onModelChange,
  onAnalyzeImage,
  onFollowUpImage,
  onSendMessage,
}) => {
  return (
    <UnifiedChatInput
      mode={mode}
      selectedModel={selectedModel}
      isProcessing={isProcessing}
      onModelChange={onModelChange}
      onAnalyzeImage={onAnalyzeImage}
      onFollowUpImage={onFollowUpImage}
      onSendMessage={onSendMessage}
    />
  );
};

export default FollowUpChatInput;

