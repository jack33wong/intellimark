/**
 * Qualification Selector Component
 * Custom dropdown for selecting qualification (GCSE, A-Level)
 * Follows ModelSelector pattern for consistent design
 */

import React, { useState, useEffect, useRef } from 'react';
import './QualificationSelector.css';

interface QualificationSelectorProps {
  selectedQualification: string;
  availableQualifications: string[];
  onChange: (qualification: string) => void;
}

const QualificationSelector: React.FC<QualificationSelectorProps> = ({
  selectedQualification,
  availableQualifications,
  onChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = (qualification: string) => {
    onChange(qualification);
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

  if (availableQualifications.length === 0) {
    return null;
  }

  return (
    <div className="qualification-selector-container" ref={dropdownRef}>
      <button
        type="button"
        className="qualification-selector-button"
        onClick={handleToggle}
      >
        <div className="qualification-selector-content">
          <span className="qualification-selector-label">{selectedQualification || 'Select Qualification'}</span>
          <span className="qualification-selector-arrow">▼</span>
        </div>
      </button>
      {isOpen && (
        <div className="qualification-selector-dropdown">
          {availableQualifications.map((qual) => (
            <div
              key={qual}
              className={`qualification-selector-option ${selectedQualification === qual ? 'selected' : ''}`}
              onClick={() => handleSelect(qual)}
            >
              {qual}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default QualificationSelector;

