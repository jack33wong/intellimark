/**
 * Topic Analysis Component
 */

import React from 'react';

interface TopicAnalysisProps {
  topics: Array<{
    topic: string;
    performance: 'strong' | 'weak' | 'average';
    score: string;
    recommendation: string;
  }>;
}

const TopicAnalysis: React.FC<TopicAnalysisProps> = ({ topics }) => {
  if (topics.length === 0) {
    return null;
  }
  
  return (
    <div className="topic-analysis">
      <h2>Topic Analysis</h2>
      <div className="topics-list">
        {topics.map((topic, index) => (
          <div key={index} className={`topic-item topic-${topic.performance}`}>
            <div className="topic-header">
              <span className="topic-name">{topic.topic}</span>
              <span className="topic-score">{topic.score}</span>
            </div>
            <div className="topic-performance">
              <span className={`performance-badge ${topic.performance}`}>
                {topic.performance.charAt(0).toUpperCase() + topic.performance.slice(1)}
              </span>
            </div>
            <p className="topic-recommendation">{topic.recommendation}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TopicAnalysis;

