/**
 * Exam Board Selector Component
 * Custom dropdown for selecting exam board (Pearson Edexcel, AQA, etc.)
 * Follows ModelSelector pattern for consistent design
 */

import React, { useState, useEffect, useRef } from 'react';
import './ExamBoardSelector.css';

interface ExamBoardSelectorProps {
  selectedExamBoard: string;
  availableExamBoards: string[];
  onChange: (examBoard: string) => void;
}

const ExamBoardSelector: React.FC<ExamBoardSelectorProps> = ({
  selectedExamBoard,
  availableExamBoards,
  onChange
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    setIsOpen(!isOpen);
  };

  const handleSelect = (examBoard: string) => {
    onChange(examBoard);
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

  if (availableExamBoards.length === 0) {
    return null;
  }

  return (
    <div className="exam-board-selector-container" ref={dropdownRef}>
      <button
        type="button"
        className="exam-board-selector-button"
        onClick={handleToggle}
      >
        <div className="exam-board-selector-content">
          <span className="exam-board-selector-label">{selectedExamBoard || 'Select Exam Board'}</span>
          <span className="exam-board-selector-arrow">▼</span>
        </div>
      </button>
      {isOpen && (
        <div className="exam-board-selector-dropdown">
          {availableExamBoards.map((board) => (
            <div
              key={board}
              className={`exam-board-selector-option ${selectedExamBoard === board ? 'selected' : ''}`}
              onClick={() => handleSelect(board)}
            >
              {board}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExamBoardSelector;

