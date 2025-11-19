/**
 * Topic Analysis Component
 * Enhanced visual presentation with better hierarchy
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
  
  // Group topics by performance level for better visual organization
  const groupedTopics = {
    strong: topics.filter(t => t.performance === 'strong'),
    average: topics.filter(t => t.performance === 'average'),
    weak: topics.filter(t => t.performance === 'weak')
  };
  
  return (
    <div className="topic-analysis">
      <h2>Topic Analysis</h2>
      
      {/* Strong Performance Topics */}
      {groupedTopics.strong.length > 0 && (
        <div className="topic-group">
          <h3 className="topic-group-title strong">Strong Performance</h3>
          <div className="topics-list">
            {groupedTopics.strong.map((topic, index) => (
              <TopicCard key={index} topic={topic} />
            ))}
          </div>
        </div>
      )}
      
      {/* Average Performance Topics */}
      {groupedTopics.average.length > 0 && (
        <div className="topic-group">
          <h3 className="topic-group-title average">Average Performance</h3>
          <div className="topics-list">
            {groupedTopics.average.map((topic, index) => (
              <TopicCard key={index} topic={topic} />
            ))}
          </div>
        </div>
      )}
      
      {/* Weak Performance Topics */}
      {groupedTopics.weak.length > 0 && (
        <div className="topic-group">
          <h3 className="topic-group-title weak">Areas for Improvement</h3>
          <div className="topics-list">
            {groupedTopics.weak.map((topic, index) => (
              <TopicCard key={index} topic={topic} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Topic Card Component
const TopicCard: React.FC<{ topic: { topic: string; performance: 'strong' | 'weak' | 'average'; score: string; recommendation: string } }> = ({ topic }) => {
  return (
    <div className={`topic-card topic-${topic.performance}`}>
      <div className="topic-card-header">
        <div className="topic-name-section">
          <h4 className="topic-name">{topic.topic}</h4>
          <span className={`performance-badge ${topic.performance}`}>
            {topic.performance.charAt(0).toUpperCase() + topic.performance.slice(1)}
          </span>
        </div>
        <div className="topic-score-section">
          <span className="topic-score">{topic.score}</span>
        </div>
      </div>
      <div className="topic-card-body">
        <p className="topic-recommendation">{topic.recommendation}</p>
      </div>
    </div>
  );
};

export default TopicAnalysis;
