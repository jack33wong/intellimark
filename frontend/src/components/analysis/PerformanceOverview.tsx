/**
 * Performance Overview Component
 */

import React from 'react';

interface PerformanceOverviewProps {
  performance: {
    overallScore: string;
    percentage: number;
    grade?: string;
    summary: string;
  };
  grade?: string | null;
}

const PerformanceOverview: React.FC<PerformanceOverviewProps> = ({ performance, grade }) => {
  return (
    <div className="performance-overview">
      <h2>Performance Overview</h2>
      <div className="performance-stats">
        <div className="stat-item">
          <span className="stat-label">Score</span>
          <span className="stat-value">{performance.overallScore}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Percentage</span>
          <span className="stat-value">{performance.percentage}%</span>
        </div>
        {(performance.grade || grade) && (
          <div className="stat-item">
            <span className="stat-label">Grade</span>
            <span className="stat-value grade">{performance.grade || grade}</span>
          </div>
        )}
      </div>
      <div className="performance-summary">
        <p>{performance.summary}</p>
      </div>
    </div>
  );
};

export default PerformanceOverview;

