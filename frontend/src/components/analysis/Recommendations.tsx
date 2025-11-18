/**
 * Recommendations Component
 */

import React from 'react';

interface RecommendationsProps {
  recommendations: {
    immediate: string[];
    studyFocus: string[];
    practiceAreas: string[];
  };
  nextSteps: string[];
}

const Recommendations: React.FC<RecommendationsProps> = ({ recommendations, nextSteps }) => {
  return (
    <div className="recommendations">
      <h2>Recommendations</h2>
      
      {recommendations.immediate.length > 0 && (
        <div className="recommendation-section">
          <h3>Immediate Actions</h3>
          <ul>
            {recommendations.immediate.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      
      {recommendations.studyFocus.length > 0 && (
        <div className="recommendation-section">
          <h3>Study Focus Areas</h3>
          <ul>
            {recommendations.studyFocus.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      
      {recommendations.practiceAreas.length > 0 && (
        <div className="recommendation-section">
          <h3>Practice Areas</h3>
          <ul>
            {recommendations.practiceAreas.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      
      {nextSteps.length > 0 && (
        <div className="recommendation-section">
          <h3>Next Steps</h3>
          <ul>
            {nextSteps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Recommendations;

