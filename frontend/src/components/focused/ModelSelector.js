/**
 * Focused ModelSelector Component
 * Simple, maintainable, single-purpose component for AI model selection
 */

import React, { useState, useCallback } from 'react';
import { createValidationError } from '../../utils/errorUtils';
import './ModelSelector.css';

// Available AI models
const AVAILABLE_MODELS = [
  { value: 'chatgpt-4o', label: 'GPT-4o', description: 'Latest GPT-4 model' },
  { value: 'chatgpt-4o-mini', label: 'GPT-4o Mini', description: 'Faster, cheaper GPT-4' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet', description: 'Anthropic Claude' },
  { value: 'claude-3-haiku', label: 'Claude 3 Haiku', description: 'Fast Claude model' }
];

const ModelSelector = ({ 
  selectedModel, 
  onModelChange, 
  onError, 
  disabled = false, 
  className = '',
  showDescriptions = true,
  size = 'medium' // 'small', 'medium', 'large'
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Handle model selection
  const handleModelSelect = useCallback((model) => {
    if (disabled) return;
    
    if (!model || !model.value) {
      const error = createValidationError('Invalid model selected');
      onError?.(error);
      return;
    }
    
    onModelChange?.(model.value);
    setIsOpen(false);
  }, [disabled, onModelChange, onError]);

  // Handle dropdown toggle
  const handleToggle = useCallback(() => {
    if (!disabled) {
      setIsOpen(prev => !prev);
    }
  }, [disabled]);

  // Handle click outside to close
  const handleClickOutside = useCallback((event) => {
    if (event.target.closest('.model-selector')) {
      return;
    }
    setIsOpen(false);
  }, []);

  // Add click outside listener
  React.useEffect(() => {
    if (isOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [isOpen, handleClickOutside]);

  // Get selected model info
  const selectedModelInfo = AVAILABLE_MODELS.find(model => model.value === selectedModel) || AVAILABLE_MODELS[0];

  return (
    <div className={`model-selector ${className} ${size} ${disabled ? 'disabled' : ''}`}>
      <button
        type="button"
        className="model-selector-button"
        onClick={handleToggle}
        disabled={disabled}
      >
        <div className="model-selector-content">
          <span className="model-selector-label">{selectedModelInfo.label}</span>
          <span className="model-selector-arrow">
            {isOpen ? '▲' : '▼'}
          </span>
        </div>
      </button>
      
      {isOpen && (
        <div className="model-selector-dropdown">
          {AVAILABLE_MODELS.map((model) => (
            <button
              key={model.value}
              type="button"
              className={`model-selector-option ${selectedModel === model.value ? 'selected' : ''}`}
              onClick={() => handleModelSelect(model)}
            >
              <div className="model-option-content">
                <span className="model-option-label">{model.label}</span>
                {showDescriptions && (
                  <span className="model-option-description">{model.description}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
