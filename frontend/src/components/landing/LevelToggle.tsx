import React from 'react';
import './LevelToggle.css';

interface LevelToggleProps {
  level: 'GCSE' | 'A-Level';
  onChange: (level: 'GCSE' | 'A-Level') => void;
  primaryColor?: string;
}

const LevelToggle: React.FC<LevelToggleProps> = ({ 
  level, 
  onChange, 
  primaryColor = '#7f00ff' 
}) => {
  return (
    <div className="level-toggle-container">
      <div className="level-toggle">
        <button
          className={`level-toggle__btn ${level === 'GCSE' ? 'level-toggle__btn--active' : ''}`}
          onClick={() => onChange('GCSE')}
          style={{
            backgroundColor: level === 'GCSE' ? primaryColor : 'transparent',
            borderColor: primaryColor,
            color: level === 'GCSE' ? '#ffffff' : primaryColor
          }}
        >
          GCSE (9-1)
        </button>
        <button
          className={`level-toggle__btn ${level === 'A-Level' ? 'level-toggle__btn--active' : ''}`}
          onClick={() => onChange('A-Level')}
          style={{
            backgroundColor: level === 'A-Level' ? primaryColor : 'transparent',
            borderColor: primaryColor,
            color: level === 'A-Level' ? '#ffffff' : primaryColor
          }}
        >
          A-Level
        </button>
      </div>
    </div>
  );
};

export default LevelToggle;
