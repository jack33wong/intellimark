/**
 * Paper Code Aggregated Stats Component
 * Shows aggregated statistics for each paper code in the selected set (column-based layout)
 */

import React from 'react';
import './PaperCodeAggregatedStats.css';

interface PaperCodeStat {
  paperCode: string;
  totalAttempts: number;
  averageScore: {
    awarded: number;
    total: number;
    percentage: number;
  };
  highestGrade: string;
  averageGrade: string;
}

interface PaperCodeAggregatedStatsProps {
  stats: PaperCodeStat[];
  paperCodeSet: string[] | null;
}

const PaperCodeAggregatedStats: React.FC<PaperCodeAggregatedStatsProps> = ({
  stats,
  paperCodeSet
}) => {
  if (!paperCodeSet || paperCodeSet.length === 0 || stats.length === 0) {
    return null;
  }

  return (
    <div className="paper-code-aggregated-stats">
      <div className="paper-code-stats-grid">
        {stats.map((stat) => (
          <div 
            key={stat.paperCode} 
            className={`paper-code-stat-card ${stat.totalAttempts === 0 ? 'no-attempts' : ''}`}
          >
            <h3>Paper Code: {stat.paperCode}</h3>
            <div className="stat-list">
              <div className="stat-item">
                <span className="stat-label">Total Attempts:</span>
                <span className="stat-value">{stat.totalAttempts}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Average Score:</span>
                <span className="stat-value">
                  {stat.totalAttempts > 0 
                    ? `${stat.averageScore.awarded}/${stat.averageScore.total} (${stat.averageScore.percentage}%)`
                    : '-'
                  }
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Highest Grade:</span>
                <span className="stat-value grade">{stat.highestGrade}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Average Grade:</span>
                <span className="stat-value grade">{stat.averageGrade}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PaperCodeAggregatedStats;

