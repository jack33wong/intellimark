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
        {stats.map((stat) => {
          const percentage = stat.totalAttempts > 0 ? stat.averageScore.percentage : 0;
          const radius = 30; // Reduced from 35
          const circumference = 2 * Math.PI * radius;
          const strokeDashoffset = circumference - (percentage / 100) * circumference;

          return (
            <div
              key={stat.paperCode}
              className={`paper-code-stat-card ${stat.totalAttempts === 0 ? 'no-attempts' : ''}`}
            >
              <div className="paper-card-header">
                <h3 className="paper-title">Paper Code: {stat.paperCode}</h3>
                <span className="attempts-badge">Total Attempts: {stat.totalAttempts}</span>
              </div>

              <div className="elegant-stat-container">
                {/* Left Side: Score Ring */}
                <div className="score-section">
                  <div className="progress-ring-container">
                    <svg className="progress-ring" width="70" height="70"> {/* Reduced from 80 */}
                      <circle
                        className="progress-ring__circle-bg"
                        stroke="rgba(255, 255, 255, 0.05)"
                        strokeWidth="5" // Reduced from 6
                        fill="transparent"
                        r={radius}
                        cx="35" // Adjusted for new width
                        cy="35"
                      />
                      <circle
                        className="progress-ring__circle"
                        stroke="#c084fc"
                        strokeWidth="5" // Reduced from 6
                        strokeDasharray={circumference}
                        style={{ strokeDashoffset }}
                        strokeLinecap="round"
                        fill="transparent"
                        r={radius}
                        cx="35" // Adjusted for new width
                        cy="35"
                      />
                    </svg>
                    <span className="percentage-text">{percentage}%</span>
                  </div>
                  <div className="score-info">
                    <span className="raw-score">{stat.averageScore.awarded}/{stat.averageScore.total}</span>
                    <span className="score-label">Average Score</span>
                  </div>
                </div>

                <div className="stat-separator"></div>

                {/* Right Side: Grades */}
                <div className="grades-section">
                  <div className="grade-box">
                    <span className="grade-number">{stat.highestGrade}</span>
                    <span className="grade-label">Highest Grade</span>
                  </div>
                  <div className="grade-box">
                    <span className="grade-number">{stat.averageGrade}</span>
                    <span className="grade-label">Average Grade</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PaperCodeAggregatedStats;

