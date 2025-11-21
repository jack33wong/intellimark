/**
 * Paper Code Set Selector Component
 * Dropdown for selecting paper code set (e.g., [1H 2H 3H], [1F 2F 3F])
 */

import React from 'react';
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
  if (availablePaperCodeSets.length === 0) {
    return null;
  }

  const getDisplayName = (set: PaperCodeSet): string => {
    return `[${set.paperCodes.join(' ')}] (${set.tier})`;
  };

  return (
    <div className="paper-code-set-selector-container">
      <label htmlFor="paper-code-set-selector" className="selector-label">
        Paper Code Set:
      </label>
      <select
        id="paper-code-set-selector"
        className="paper-code-set-selector"
        value={selectedPaperCodeSet ? JSON.stringify(selectedPaperCodeSet) : ''}
        onChange={(e) => {
          const value = e.target.value;
          onChange(value ? JSON.parse(value) : null);
        }}
      >
        <option value="">All Paper Codes</option>
        {availablePaperCodeSets.map((set, index) => (
          <option key={index} value={JSON.stringify(set.paperCodes)}>
            {getDisplayName(set)}
          </option>
        ))}
      </select>
    </div>
  );
};

export default PaperCodeSetSelector;

