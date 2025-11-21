/**
 * Qualification Selector Component
 * Dropdown for selecting qualification (GCSE, A-Level)
 */

import React from 'react';
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
  return (
    <div className="qualification-selector-container">
      <label htmlFor="qualification-selector" className="selector-label">
        Qualification:
      </label>
      <select
        id="qualification-selector"
        className="qualification-selector"
        value={selectedQualification}
        onChange={(e) => onChange(e.target.value)}
      >
        {availableQualifications.map((qual) => (
          <option key={qual} value={qual}>
            {qual}
          </option>
        ))}
      </select>
    </div>
  );
};

export default QualificationSelector;

