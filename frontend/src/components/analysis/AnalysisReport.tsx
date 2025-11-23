/**
 * Analysis Report Component
 * Main component for displaying analysis report
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import StrengthsWeaknesses from './StrengthsWeaknesses';
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
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    if (subject) {
      // Reset state when filters change
      setAnalysis(null);
      setError(null);
      setIsGenerating(false);
      setIsLoading(true);
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
        setIsLoading(false);
        return;
      }
      
      // When filters are active, check for cached analysis or generate new one
      if (examBoard && paperCodeSet && paperCodeSet.length > 0 && qualification) {
        // Trigger analysis generation (backend will check cache first)
        await triggerBackgroundAnalysis();
        return;
      }
      
      // No filters - get existing analysis (legacy support)
      const apiBaseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://api-f4ov4wv3qq-uc.a.run.app' 
        : (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001');
      
      const getResponse = await fetch(`${apiBaseUrl}/api/analysis/${encodeURIComponent(subject)}`, {
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
          
          // Handle both old structure (direct analysis) and new structure (nested)
          let analysisToUse = null;
          if (analysisData) {
            if (analysisData.performance || analysisData.strengths) {
              // Old structure - direct analysis object
              analysisToUse = analysisData;
            }
          }
          
          if (analysisToUse) {
            setAnalysis(analysisToUse);
          }
          setReAnalysisNeeded(needsReAnalysis);
          setIsLoading(false);
          
          if (needsReAnalysis && !isGenerating) {
            triggerBackgroundAnalysis();
          }
        } else {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Failed to load analysis:', err);
      setIsLoading(false);
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
      const apiBaseUrl = process.env.NODE_ENV === 'production' 
        ? 'https://api-f4ov4wv3qq-uc.a.run.app' 
        : (process.env.REACT_APP_API_BASE_URL || 'http://localhost:5001');
      
      const requestUrl = `${apiBaseUrl}/api/analysis/generate`;
      
      const response = await fetch(requestUrl, {
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
      
      if (!response.ok) {
        // Try to parse error response
        let errorData: any = null;
        try {
          const errorText = await response.text();
          errorData = JSON.parse(errorText);
        } catch (e) {
          // If parsing fails, create a default error object
          errorData = { error: `Failed to generate analysis: ${response.status} ${response.statusText}` };
        }
        
        // For actual errors, log and set error state
        const errorMessage = errorData?.error || `Failed to generate analysis: ${response.status} ${response.statusText}`;
        console.error(`❌ Analysis generation failed: ${response.status} ${response.statusText}`, errorMessage);
        setError(errorMessage);
        setIsLoading(false);
        return;
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Handle empty result (no marking results found)
        if (data.empty || !data.analysis) {
          setError(null);
          setAnalysis(null);
          setIsLoading(false);
        } else {
          setAnalysis(data.analysis);
          setReAnalysisNeeded(false);
          setIsLoading(false);
        }
      } else {
        setError(data.error || 'Failed to generate analysis');
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    } finally {
      setIsGenerating(false);
    }
  };
  
  // Show loading spinner if loading or generating
  if (isLoading || isGenerating) {
    return (
      <div className="analysis-loading">
        <div className="loading-spinner"></div>
        <p>{isGenerating ? 'Generating analysis...' : 'Loading analysis...'}</p>
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
  
  if (!analysis && !error) {
    return (
      <div className="analysis-empty-state">
        <p>No marking results found for the selected filters.</p>
        <p className="hint">Try selecting a different exam board or paper code set.</p>
      </div>
    );
  }
  
  if (!analysis) {
    return null;
  }
  
  return (
    <div className="analysis-report">
      {/* Performance Summary */}
      {analysis.performance.summary && (
        <div className="performance-summary-section">
          <h3>Performance Summary</h3>
          <p>{analysis.performance.summary}</p>
        </div>
      )}
      
      {/* Grade Analysis - How to maintain or achieve higher grade */}
      {analysis.performance.gradeAnalysis && (
        <div className="grade-analysis">
          <h3>Grade Improvement Strategy</h3>
          <div className="grade-analysis-text">
            <p>{analysis.performance.gradeAnalysis}</p>
          </div>
        </div>
      )}
      
      <StrengthsWeaknesses 
        strengths={analysis.strengths}
        weaknesses={analysis.weaknesses}
      />
    </div>
  );
};

export default AnalysisReport;
