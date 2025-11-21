/**
 * Exam Board Selector Component
 * Dropdown for selecting exam board (Pearson Edexcel, AQA, etc.)
 */

import React from 'react';
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
  if (availableExamBoards.length === 0) {
    return null;
  }

  return (
    <div className="exam-board-selector-container">
      <label htmlFor="exam-board-selector" className="selector-label">
        Exam Board:
      </label>
      <select
        id="exam-board-selector"
        className="exam-board-selector"
        value={selectedExamBoard}
        onChange={(e) => onChange(e.target.value)}
      >
        {availableExamBoards.map((board) => (
          <option key={board} value={board}>
            {board}
          </option>
        ))}
      </select>
    </div>
  );
};

export default ExamBoardSelector;

