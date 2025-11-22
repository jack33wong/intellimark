/**
 * Paper Code Set Selector Component
 * Custom dropdown for selecting paper code set (e.g., [1H 2H 3H], [1F 2F 3F])
 * Follows ModelSelector pattern for consistent design
 */

import React, { useState, useEffect, useRef } from 'react';
import './PaperCodeSetSelector.css';

interface PaperCodeSet {
  tier: string; // "Higher" | "Foundation"
  paperCodes: string[]; // ["1H", "2H", "3H"]
}

interface PaperCodeSetSelectorProps {
  selectedPaperCodeSet: string[] | null;
  availablePaperCodeSets: PaperCodeSet[];
  onChange: (paperCodeSet: string[] | null) => void;
}

const PaperCodeSetSelector: React.FC<PaperCodeSetSelectorProps> = ({
  selectedPaperCodeSet,
  availablePaperCodeSets,
  onChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getDisplayName = (set: PaperCodeSet): string => {
    return `[${set.paperCodes.join(' ')}] (${set.tier})`;
  };

  const getSelectedDisplayName = (): string => {
    if (!selectedPaperCodeSet) {
      return 'All Paper Codes';
    }
    const matchingSet = availablePaperCodeSets.find(
      set => JSON.stringify(set.paperCodes) === JSON.stringify(selectedPaperCodeSet)
    );
    return matchingSet ? getDisplayName(matchingSet) : 'All Paper Codes';
  };

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = (paperCodeSet: string[] | null) => {
    onChange(paperCodeSet);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (availablePaperCodeSets.length === 0) {
    return null;
  }

  const isSelected = (paperCodes: string[] | null): boolean => {
    if (!selectedPaperCodeSet && !paperCodes) return true;
    if (!selectedPaperCodeSet || !paperCodes) return false;
    return JSON.stringify(selectedPaperCodeSet) === JSON.stringify(paperCodes);
  };

  return (
    <div className="paper-code-set-selector-container" ref={dropdownRef}>
      <button
        type="button"
        className="paper-code-set-selector-button"
        onClick={handleToggle}
      >
        <div className="paper-code-set-selector-content">
          <span className="paper-code-set-selector-label">{getSelectedDisplayName()}</span>
          <span className="paper-code-set-selector-arrow">▼</span>
        </div>
      </button>
      {isOpen && (
        <div className="paper-code-set-selector-dropdown">
          <div
            className={`paper-code-set-selector-option ${isSelected(null) ? 'selected' : ''}`}
            onClick={() => handleSelect(null)}
          >
            All Paper Codes
          </div>
          {availablePaperCodeSets.map((set, index) => (
            <div
              key={index}
              className={`paper-code-set-selector-option ${isSelected(set.paperCodes) ? 'selected' : ''}`}
              onClick={() => handleSelect(set.paperCodes)}
            >
              {getDisplayName(set)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PaperCodeSetSelector;

