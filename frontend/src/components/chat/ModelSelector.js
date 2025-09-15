/**
 * ModelSelector Component
 * 
 * Reusable model selector dropdown with consistent styling
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Bot, ChevronDown } from 'lucide-react';
import './ModelSelector.css';

const ModelSelector = ({
  selectedModel,
  onModelSelect,
  isProcessing,
  className = '',
  size = 'main' // 'main' or 'followup'
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setIsDropdownOpen(!isDropdownOpen);
  }, [isDropdownOpen]);

  const handleSelect = useCallback((model) => {
    onModelSelect(model);
    setIsDropdownOpen(false);
  }, [onModelSelect]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      const dropdownClass = size === 'followup' ? '.followup-ai-model-dropdown' : '.ai-model-dropdown';
      if (isDropdownOpen && !event.target.closest(dropdownClass)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen, size]);

  const getModelDisplayName = (model) => {
    switch (model) {
      case 'chatgpt-4o': return 'GPT-4o';
      case 'gemini-2.5-pro': return 'Gemini 2.5 Pro';
      case 'chatgpt-5': return 'GPT-5';
      default: return 'AI Model';
    }
  };

  const buttonClass = size === 'followup' ? 'followup-model-button' : 'ai-model-button';
  const dropdownClass = size === 'followup' ? 'followup-model-dropdown' : 'ai-model-dropdown';
  const menuClass = size === 'followup' ? 'followup-model-dropdown-menu' : 'ai-model-dropdown-menu';
  const optionClass = size === 'followup' ? 'followup-model-option' : 'ai-model-option';

  return (
    <div className={`${dropdownClass} ${className}`}>
      <button
        className={buttonClass}
        onClick={handleToggle}
        disabled={isProcessing}
      >
        <Bot size={size === 'followup' ? 16 : 20} />
        <span>{getModelDisplayName(selectedModel)}</span>
        <ChevronDown 
          size={size === 'followup' ? 14 : 18} 
          className={isDropdownOpen ? 'rotated' : ''} 
        />
      </button>

      {isDropdownOpen && (
        <div className={menuClass}>
          <button
            className={`${optionClass} ${selectedModel === 'chatgpt-4o' ? 'selected' : ''}`}
            onClick={() => handleSelect('chatgpt-4o')}
          >
            GPT-4o
          </button>
          <button
            className={`${optionClass} ${selectedModel === 'gemini-2.5-pro' ? 'selected' : ''}`}
            onClick={() => handleSelect('gemini-2.5-pro')}
          >
            Gemini 2.5 Pro
          </button>
          <button
            className={`${optionClass} ${selectedModel === 'chatgpt-5' ? 'selected' : ''}`}
            onClick={() => handleSelect('chatgpt-5')}
          >
            GPT-5
          </button>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
