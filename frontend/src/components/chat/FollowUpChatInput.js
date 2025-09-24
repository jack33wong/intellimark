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
  currentSession,
  chatInput,
  setChatInput,
  onSendMessage,
  onKeyPress,
  onModelChange
}) => {
  console.log('🔍 FollowUpChatInput - received props:', { selectedModel, onModelChange: !!onModelChange });
  console.log('🚨 FOLLOWUP CHAT INPUT IS LOADING - NEW CODE IS ACTIVE!');
  console.log('🔍 FollowUpChatInput - onModelChange function:', onModelChange);
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
      chatInput={chatInput}
      setChatInput={setChatInput}
      onSendMessage={onSendMessage}
      onKeyPress={onKeyPress}
      onModelChange={onModelChange}
    />
  );
};

export default FollowUpChatInput;