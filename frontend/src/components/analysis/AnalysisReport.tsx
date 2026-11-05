/**
 * Analysis Report Component
 * Main component for displaying analysis report
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
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
  const inProgressRetriesRef = useRef(0);

  useEffect(() => {
    if (subject) {
      // Reset state when filters change and load analysis
      inProgressRetriesRef.current = 0;
      setAnalysis(null);
      setError(null);
      setIsGenerating(false);
      setIsLoading(true);
      setReAnalysisNeeded(reAnalysisNeededProp);
      loadAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, qualification, examBoard, paperCodeSet]);

  useEffect(() => {
    setReAnalysisNeeded(reAnalysisNeededProp);
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

      // Trigger analysis generation (backend will check cache first)
      await triggerBackgroundAnalysis();
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
        ? ''
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
          qualification: qualification || undefined,
          examBoard: examBoard || undefined,
          paperCodeSet: (paperCodeSet && paperCodeSet.length > 0) ? paperCodeSet : undefined,
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

        // If the analysis is already in progress on the server, wait and re-check for the completed report
        if (errorMessage.toLowerCase().includes('in progress') && inProgressRetriesRef.current < 5) {
          inProgressRetriesRef.current += 1;
          console.log(`⏳ Analysis is in progress on server (retry ${inProgressRetriesRef.current}/5)...`);
          setIsGenerating(true);
          setTimeout(() => {
            setIsGenerating(false);
            loadAnalysis();
          }, 2500);
          return;
        }

        setError(errorMessage);
        setIsLoading(false);
        return;
      }

      const data = await response.json();

      if (data.success) {
        inProgressRetriesRef.current = 0;
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
    <div className="analysis-summary-grid">
      {/* 1. Performance Summary */}
      <div className="summary-card">
        <div className="card-header">
          <h3>Performance Summary</h3>
        </div>
        <div className="card-body">
          <p>{analysis.performance.summary}</p>
        </div>
      </div>

      {/* 2. Grade Improvement Strategy */}
      <div className="summary-card gold">
        <div className="card-header">
          <h3>Grade Improvement Strategy</h3>
        </div>
        <div className="card-body">
          <div className="grade-analysis-text">
            <p>{analysis.performance.gradeAnalysis}</p>
          </div>
        </div>
      </div>

      {/* 3. Strengths */}
      <div className="summary-card success">
        <div className="card-header">
          <h3>Strengths</h3>
        </div>
        <div className="card-body">
          <ul className="stat-bullet-list">
            {analysis.strengths.map((s, i) => (
              <li key={i}><span className="bullet-icon">✓</span> {s}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* 4. Areas for Improvement */}
      <div className="summary-card danger">
        <div className="card-header">
          <h3>Areas for Improvement</h3>
        </div>
        <div className="card-body">
          <ul className="stat-bullet-list">
            {analysis.weaknesses.map((w, i) => (
              <li key={i}><span className="bullet-icon">✕</span> {w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AnalysisReport;
