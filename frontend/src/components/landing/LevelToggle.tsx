import React from 'react';
import './LevelToggle.css';

export type LevelToggleOption = 'gcse-maths' | 'gcse-english' | 'alevel-maths';

interface LevelToggleProps {
  level: LevelToggleOption | 'GCSE' | 'A-Level';
  onChange: (level: any) => void;
  primaryColor?: string;
  hideAlevel?: boolean;
}

export const LevelToggle: React.FC<LevelToggleProps> = ({ 
  level, 
  onChange, 
  primaryColor = '#7f00ff',
  hideAlevel = false
}) => {
  const is3Way = level === 'gcse-maths' || level === 'gcse-english' || level === 'alevel-maths';

  if (!is3Way) {
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
  }

  return (
    <div className="level-toggle-container">
      <div className="level-toggle level-toggle--3way">
        <button
          type="button"
          className={`level-toggle__btn ${level === 'gcse-maths' ? 'level-toggle__btn--active' : ''}`}
          onClick={() => onChange('gcse-maths')}
          style={{
            backgroundColor: level === 'gcse-maths' ? primaryColor : 'transparent',
            borderColor: level === 'gcse-maths' ? primaryColor : 'rgba(0, 0, 0, 0.12)',
            color: level === 'gcse-maths' ? '#ffffff' : '#475569'
          }}
        >
          <span className="level-toggle__icon">📐</span>
          <span>GCSE Maths (9-1)</span>
        </button>
        <button
          type="button"
          className={`level-toggle__btn ${level === 'gcse-english' ? 'level-toggle__btn--active' : ''}`}
          onClick={() => onChange('gcse-english')}
          style={{
            backgroundColor: level === 'gcse-english' ? primaryColor : 'transparent',
            borderColor: level === 'gcse-english' ? primaryColor : 'rgba(0, 0, 0, 0.12)',
            color: level === 'gcse-english' ? '#ffffff' : '#475569'
          }}
        >
          <span className="level-toggle__icon">✍️</span>
          <span>GCSE English Language</span>
          <span className="level-toggle__badge-new">NEW</span>
        </button>
        {!hideAlevel && (
          <button
            type="button"
            className={`level-toggle__btn ${level === 'alevel-maths' ? 'level-toggle__btn--active' : ''}`}
            onClick={() => onChange('alevel-maths')}
            style={{
              backgroundColor: level === 'alevel-maths' ? primaryColor : 'transparent',
              borderColor: level === 'alevel-maths' ? primaryColor : 'rgba(0, 0, 0, 0.12)',
              color: level === 'alevel-maths' ? '#ffffff' : '#475569'
            }}
          >
            <span className="level-toggle__icon">🎓</span>
            <span>A-Level Maths</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default LevelToggle;
