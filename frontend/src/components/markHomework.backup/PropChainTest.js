import React, { useState, useCallback } from 'react';
import ModelSelector from '../focused/ModelSelector';

// Clone the exact prop chain structure
const FollowUpChatInputClone = ({ selectedModel, onModelChange }) => {
  console.log('🔍 FollowUpChatInputClone - received props:', { selectedModel, onModelChange: !!onModelChange });
  
  return (
    <UnifiedChatInputClone
      mode="follow-up"
      selectedModel={selectedModel}
      onModelChange={onModelChange}
    />
  );
};

const UnifiedChatInputClone = ({ selectedModel, onModelChange, mode }) => {
  console.log('🔍 UnifiedChatInputClone - received props:', { selectedModel, onModelChange: !!onModelChange, mode });
  
  const handleModelSelect = useCallback((model) => {
    console.log('🔍 UnifiedChatInputClone - handleModelSelect called with:', model);
    console.log('🔍 UnifiedChatInputClone - calling onModelChange with:', model);
    onModelChange?.(model);
  }, [onModelChange]);

  return (
    <div style={{ padding: '10px', border: '1px solid green' }}>
      <h3>UnifiedChatInputClone (mode: {mode})</h3>
      <p>onModelChange received: {onModelChange ? 'YES' : 'NO'}</p>
      <ModelSelector
        selectedModel={selectedModel}
        onModelChange={handleModelSelect}
        isProcessing={false}
        size="small"
      />
      {console.log('🔍 UnifiedChatInputClone - passing to ModelSelector:', { selectedModel, onModelChange: !!handleModelSelect, isProcessing: false, size: 'small' })}
    </div>
  );
};

// Test component that reproduces the exact issue
const PropChainTest = () => {
  const [selectedModel, setSelectedModel] = useState('auto');
  
  const handleModelChange = useCallback((model) => {
    console.log('🔍 PropChainTest - handleModelChange called with:', model);
    setSelectedModel(model);
  }, []);

  console.log('🔍 PropChainTest - render, selectedModel:', selectedModel);

  return (
    <div style={{ padding: '20px', border: '2px solid red', margin: '10px' }}>
      <h2>🔗 Prop Chain Test</h2>
      <p>Current Model: {selectedModel}</p>
      <p>handleModelChange: {handleModelChange ? 'FUNCTION' : 'UNDEFINED'}</p>
      
      <FollowUpChatInputClone
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
      />
    </div>
  );
};

export default PropChainTest;
