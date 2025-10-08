/**
 * ModelSelector Component (TypeScript)
 * A dropdown for selecting the AI model.
 */
import React, { useState, useEffect, useRef } from 'react';
import './ModelSelector.css'; // Assuming styles are in this file

// Define the type for the props this component receives
interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  size?: 'main' | 'small';
  onError?: (error: Error) => void; // Add the optional onError prop
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  size = 'main',
  // onError is accepted but not used within this component currently
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const models = [
    { id: 'auto', name: 'Auto (Recommended)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  ];

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (modelId: string) => {
    onModelChange(modelId);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedModelName = models.find(m => m.id === selectedModel)?.name || 'Select Model';

  return (
    <div className={`model-selector ${size}`} ref={dropdownRef}>
      <button
        type="button"
        className="model-selector-button"
        onClick={handleToggle}
        disabled={disabled}
      >
        <div className="model-selector-content">
          <span className="model-selector-label">{selectedModelName}</span>
          <span className="model-selector-arrow">▼</span>
        </div>
      </button>
      {isOpen && (
        <div className="model-selector-dropdown">
          {models.map((model) => (
            <div
              key={model.id}
              className={`dropdown-item ${selectedModel === model.id ? 'selected' : ''}`}
              onClick={() => handleSelect(model.id)}
            >
              {model.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;

