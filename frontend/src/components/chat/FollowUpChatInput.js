/**
 * FollowUpChatInput Component
 * 
 * Compact single-line chat input for follow-up messages
 * Now uses UnifiedChatInput for follow-up mode
 */

import React from 'react';
import PropTypes from 'prop-types';
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
  // Runtime validation for critical props
  if (process.env.NODE_ENV === 'development') {
    if (!onModelChange) {
      console.error('FollowUpChatInput: onModelChange prop is required but was undefined');
    }
    if (!selectedModel) {
      console.error('FollowUpChatInput: selectedModel prop is required but was undefined');
    }
  }

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

FollowUpChatInput.propTypes = {
  selectedModel: PropTypes.string.isRequired,
  onModelChange: PropTypes.func.isRequired,
  isProcessing: PropTypes.bool,
  onAnalyzeImage: PropTypes.func,
  onFollowUpImage: PropTypes.func,
  onUploadClick: PropTypes.func,
  clearPreview: PropTypes.func,
  currentSession: PropTypes.object,
  chatInput: PropTypes.string,
  setChatInput: PropTypes.func,
  onSendMessage: PropTypes.func,
  onKeyPress: PropTypes.func
};

export default FollowUpChatInput;