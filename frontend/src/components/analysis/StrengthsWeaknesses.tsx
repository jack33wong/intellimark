/**
 * Strengths and Weaknesses Component
 */

import React from 'react';

interface StrengthsWeaknessesProps {
  strengths: string[];
  weaknesses: string[];
}

const StrengthsWeaknesses: React.FC<StrengthsWeaknessesProps> = ({ strengths, weaknesses }) => {
  return (
    <div className="strengths-weaknesses">
      <div className="strengths-section">
        <h3>Strengths</h3>
        <ul>
          {strengths.map((strength, index) => (
            <li key={index}>{strength}</li>
          ))}
        </ul>
      </div>
      <div className="weaknesses-section">
        <h3>Areas for Improvement</h3>
        <ul>
          {weaknesses.map((weakness, index) => (
            <li key={index}>{weakness}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default StrengthsWeaknesses;

