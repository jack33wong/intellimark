/**
 * Performance Overview Component
 */

import React from 'react';

interface PerformanceOverviewProps {
  performance: {
    overallScore: string;
    percentage: number;
    grade?: string; // Highest grade
    averageGrade?: string; // Average grade
    summary: string;
    gradeAnalysis?: string; // Strategic grade improvement analysis
  };
  grade?: string | null; // Legacy support
}

const PerformanceOverview: React.FC<PerformanceOverviewProps> = ({ performance, grade }) => {
  return (
    <div className="performance-overview">
      <h2>Performance Overview</h2>
      <div className="performance-stats">
        <div className="stat-item">
          <span className="stat-label">Score:</span>
          <span className="stat-value">{performance.overallScore}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Percentage:</span>
          <span className="stat-value">{performance.percentage}%</span>
        </div>
        {(performance.grade || grade) && (
          <div className="stat-item">
            <span className="stat-label">Highest Grade:</span>
            <span className="stat-value grade">{performance.grade || grade}</span>
          </div>
        )}
        {performance.averageGrade && (
          <div className="stat-item">
            <span className="stat-label">Average Grade:</span>
            <span className="stat-value grade">{performance.averageGrade}</span>
          </div>
        )}
      </div>
      <div className="performance-summary">
        <p>{performance.summary}</p>
      </div>
      {performance.gradeAnalysis && (
        <div className="grade-analysis">
          <h3>Grade Strategy</h3>
          <div className="grade-analysis-text">
            {performance.gradeAnalysis.split('\n').map((line, index) => (
              <p key={index}>{line || '\u00A0'}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PerformanceOverview;

