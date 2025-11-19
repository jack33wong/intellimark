/**
 * Next Steps Component
 * Displays actionable next steps for improvement
 */

import React from 'react';

interface NextStepsProps {
  nextSteps: string[];
}

const NextSteps: React.FC<NextStepsProps> = ({ nextSteps }) => {
  if (nextSteps.length === 0) {
    return null;
  }
  
  return (
    <div className="next-steps">
      <h2>Recommended Next Steps</h2>
      <ul className="next-steps-list">
        {nextSteps.map((step, index) => (
          <li key={index} className="next-step-item">
            <span className="step-number">{index + 1}</span>
            <span className="step-text">{step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NextSteps;

