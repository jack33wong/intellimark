/**
 * Analysis Report Component
 * Main component for displaying analysis report
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import PerformanceOverview from './PerformanceOverview';
import StrengthsWeaknesses from './StrengthsWeaknesses';
import TopicAnalysis from './TopicAnalysis';
import Recommendations from './Recommendations';
import './AnalysisReport.css';

interface AnalysisResult {
  performance: {
    overallScore: string;
    percentage: number;
    grade?: string;
    summary: string;
  };
  strengths: string[];
  weaknesses: string[];
  topicAnalysis: Array<{
    topic: string;
    performance: 'strong' | 'weak' | 'average';
    score: string;
    recommendation: string;
  }>;
  recommendations: {
    immediate: string[];
    studyFocus: string[];
    practiceAreas: string[];
  };
  nextSteps: string[];
}

interface AnalysisReportProps {
  sessionId: string;
  detectedQuestion?: any;
  studentScore?: any;
  grade?: string | null;
}

const AnalysisReport: React.FC<AnalysisReportProps> = ({
  sessionId,
  detectedQuestion,
  studentScore,
  grade
}) => {
  const { user, getAuthToken } = useAuth();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    loadOrGenerateAnalysis();
  }, [sessionId]);
  
  const loadOrGenerateAnalysis = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      
      const authToken = user ? await getAuthToken() : null;
      const response = await fetch(`/api/analysis/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        },
        body: JSON.stringify({
          sessionId,
          model: 'auto' // Or get from user selection
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setAnalysis(data.analysis);
      } else {
        setError(data.error || 'Failed to generate analysis');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  };
  
  if (isGenerating) {
    return (
      <div className="analysis-loading">
        <p>Generating analysis...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="analysis-error">
        <p>Error: {error}</p>
        <button onClick={loadOrGenerateAnalysis} className="retry-button">Retry</button>
      </div>
    );
  }
  
  if (!analysis) {
    return (
      <div className="analysis-empty-state">
        <p>No analysis available.</p>
        <button onClick={loadOrGenerateAnalysis} className="generate-button">Generate Analysis</button>
      </div>
    );
  }
  
  return (
    <div className="analysis-report">
      <PerformanceOverview 
        performance={analysis.performance}
        grade={grade}
      />
      
      <StrengthsWeaknesses 
        strengths={analysis.strengths}
        weaknesses={analysis.weaknesses}
      />
      
      <TopicAnalysis 
        topics={analysis.topicAnalysis}
      />
      
      <Recommendations 
        recommendations={analysis.recommendations}
        nextSteps={analysis.nextSteps}
      />
    </div>
  );
};

export default AnalysisReport;

