/**
 * ModelSelector Component (TypeScript)
 * A dropdown for selecting the AI model.
 */
import React, { useState, useEffect, useRef } from 'react';
import './ModelSelector.css'; // Assuming styles are in this file
import { Check } from 'lucide-react';
import { useModels } from '../../contexts/ModelContext';

// Define the type for the props this component receives
interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  disabled?: boolean;
  size?: 'main' | 'small';
  dropdownDirection?: 'up' | 'down';
  onError?: (error: Error) => void; // Add the optional onError prop
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  onModelChange,
  disabled = false,
  size = 'main',
  dropdownDirection = 'up',
  // onError is accepted but not used within this component currently
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { models } = useModels();

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

  const selectedModelData = models.find(m => m.id === selectedModel);
  const selectedModelName = selectedModelData?.label || selectedModelData?.name || selectedModel || 'Select Model';

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
        <div className={`model-selector-dropdown direction-${dropdownDirection}`}>
          <div className="model-selector-header">Gemini</div>
          <div className="model-selector-options">
            {models.map((model) => (
              <div
                key={model.id}
                className={`model-selector-option ${selectedModel === model.id ? 'selected' : ''}`}
                onClick={() => handleSelect(model.id)}
              >
                <div className="model-option-info">
                  <div className="model-option-header">
                    <span className="model-option-label">{model.label}</span>

                  </div>
                  <div className="model-option-description">{model.description}</div>
                </div>
                {selectedModel === model.id && (
                  <div className="model-option-check">
                    <Check size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelSelector;

