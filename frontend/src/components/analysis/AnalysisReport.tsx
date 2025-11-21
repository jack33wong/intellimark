/**
 * Analysis Report Component
 * Main component for displaying analysis report
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import StrengthsWeaknesses from './StrengthsWeaknesses';
import TopicAnalysis from './TopicAnalysis';
import NextSteps from './NextSteps';
import './AnalysisReport.css';

interface AnalysisResult {
  performance: {
    overallScore: string;
    percentage: number;
    grade?: string;
    averageGrade?: string;
    summary: string;
    gradeAnalysis?: string; // Strategic grade improvement analysis
  };
  strengths: string[];
  weaknesses: string[];
  topicAnalysis: Array<{
    topic: string;
    performance: 'strong' | 'weak' | 'average';
    score: string;
    recommendation: string;
  }>;
  nextSteps: string[];
}

interface AnalysisReportProps {
  subject: string; // Required: subject name
  qualification?: string; // Optional: qualification filter
  examBoard?: string; // Optional: exam board filter
  paperCodeSet?: string[] | null; // Optional: paper code set filter
  reAnalysisNeeded?: boolean; // Flag passed from parent
}

const AnalysisReport: React.FC<AnalysisReportProps> = ({
  subject,
  qualification,
  examBoard,
  paperCodeSet,
  reAnalysisNeeded: reAnalysisNeededProp = false
}) => {
  const { user, getAuthToken } = useAuth();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reAnalysisNeeded, setReAnalysisNeeded] = useState(reAnalysisNeededProp);
  
  useEffect(() => {
    if (subject) {
      // Reset state when filters change
      setAnalysis(null);
      setError(null);
      setIsGenerating(false);
      setReAnalysisNeeded(reAnalysisNeededProp);
      // Load analysis when filters change
      loadAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, qualification, examBoard, paperCodeSet]);
  
  useEffect(() => {
    setReAnalysisNeeded(reAnalysisNeededProp);
    
    // Don't trigger analysis automatically when flag changes - only when user explicitly visits the page
    // Analysis will be triggered in loadAnalysis() when component first loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reAnalysisNeededProp]);
  
  const loadAnalysis = async () => {
    if (!subject) return;
    
    try {
      const authToken = user ? await getAuthToken() : null;
      
      if (!authToken) {
        setError('Authentication required');
        return;
      }
      
      // Get existing analysis
      const getResponse = await fetch(`/api/analysis/${encodeURIComponent(subject)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      if (getResponse.ok) {
        const getData = await getResponse.json();
        if (getData.success && getData.subjectMarkingResult) {
          const analysisData = getData.subjectMarkingResult.analysis;
          const needsReAnalysis = getData.subjectMarkingResult.reAnalysisNeeded || false;
          
          if (analysisData) {
            setAnalysis(analysisData);
          }
          setReAnalysisNeeded(needsReAnalysis);
          
          // Only trigger re-analysis when user explicitly visits the analysis page
          // This happens when:
          // 1. Component first loads (subject changes) AND flag is true
          // 2. User clicks "Generate Analysis" button
          // NOT when flag changes due to deletion (that's handled by the useEffect watching reAnalysisNeededProp being removed)
          if (needsReAnalysis && !isGenerating) {
            // Trigger analysis when user visits the page and flag is set
            triggerBackgroundAnalysis();
          }
        }
      }
    } catch (err) {
      console.error('Failed to load analysis:', err);
    }
  };
  
  const triggerBackgroundAnalysis = async () => {
    if (!subject || isGenerating) return;
    
    try {
      setIsGenerating(true);
      setError(null);
      
      const authToken = user ? await getAuthToken() : null;
      
      if (!authToken) {
        return;
      }
      
      // Generate analysis in background with filters
      const response = await fetch(`/api/analysis/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ 
          subject, 
          qualification,
          examBoard,
          paperCodeSet,
          model: 'auto' 
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setAnalysis(data.analysis);
        setReAnalysisNeeded(false);
      } else {
        setError(data.error || 'Failed to generate analysis');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Show loading spinner if generating in background
  if (isGenerating) {
    return (
      <div className="analysis-loading">
        <div className="loading-spinner"></div>
        <p>Generating analysis...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="analysis-error">
        <p>Error: {error}</p>
        <button onClick={triggerBackgroundAnalysis} className="retry-button">Retry</button>
      </div>
    );
  }
  
  if (!analysis) {
    return (
      <div className="analysis-empty-state">
        <p>No analysis available.</p>
        {!reAnalysisNeeded && (
          <button onClick={triggerBackgroundAnalysis} className="generate-button">Generate Analysis</button>
        )}
      </div>
    );
  }
  
  return (
    <div className="analysis-report">
      <StrengthsWeaknesses 
        strengths={analysis.strengths}
        weaknesses={analysis.weaknesses}
      />
      
      <TopicAnalysis 
        topics={analysis.topicAnalysis}
      />
      
      <NextSteps 
        nextSteps={analysis.nextSteps}
      />
    </div>
  );
};

export default AnalysisReport;
