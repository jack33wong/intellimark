/**
 * Analysis Page Component
 * Main page for viewing performance analysis reports grouped by subject
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { AnalysisReport } from '../components/analysis';
import MarkingResultsTable from '../components/analysis/MarkingResultsTable';
import './AnalysisPage.css';

interface MarkingResult {
  sessionId: string;
  timestamp: string;
  examMetadata: {
    examBoard: string;
    examCode: string;
    examSeries: string;
    qualification: string;
    tier?: string;
  };
  overallScore: {
    awardedMarks: number;
    totalMarks: number;
  };
  grade?: string;
  modelUsed: string;
}

interface SubjectMarkingResult {
  markingResults: MarkingResult[];
  statistics: any;
  analysis: any;
  reAnalysisNeeded: boolean;
}

const AnalysisPage: React.FC = () => {
  const { user, getAuthToken } = useAuth();
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [activeSubject, setActiveSubject] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [markingResults, setMarkingResults] = useState<MarkingResult[]>([]);
  const [reAnalysisNeeded, setReAnalysisNeeded] = useState(false);

  // Fetch subjects from subjectMarkingResults
  const fetchSubjects = useCallback(async () => {
    if (!user?.uid) {
      setAvailableSubjects([]);
      setLoading(false);
      return;
    }

    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('Authentication token not available.');
        setLoading(false);
        return;
      }

      // Fetch all subject marking results for this user
      const response = await fetch(`/api/analysis/subjects`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken && { 'Authorization': `Bearer ${authToken}` })
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch subjects');
      }
      
      const data = await response.json();
      
      if (data.success && data.subjects) {
        const subjects = data.subjects.sort();
        setAvailableSubjects(subjects);
        
        // Default to Mathematics if available, otherwise first subject
        if (subjects.length > 0 && !activeSubject) {
          const mathIndex = subjects.findIndex((s: string) => 
            s.toLowerCase().includes('math') || s.toLowerCase() === 'mathematics'
          );
          setActiveSubject(mathIndex >= 0 ? subjects[mathIndex] : subjects[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load subjects:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, getAuthToken, activeSubject]);

  // Fetch marking results for active subject
  const fetchMarkingResults = useCallback(async (subject: string) => {
    if (!user?.uid || !subject) {
      setMarkingResults([]);
      return;
    }

    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        return;
      }

      const response = await fetch(`/api/analysis/${encodeURIComponent(subject)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.subjectMarkingResult) {
          const result: SubjectMarkingResult = data.subjectMarkingResult;
          setMarkingResults(result.markingResults || []);
          setReAnalysisNeeded(result.reAnalysisNeeded || false);
        }
      }
    } catch (error) {
      console.error('Failed to load marking results:', error);
    }
  }, [user?.uid, getAuthToken]);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  useEffect(() => {
    if (activeSubject) {
      fetchMarkingResults(activeSubject);
    }
  }, [activeSubject, fetchMarkingResults]);

  if (loading) {
    return (
      <div className="analysis-page">
        <div className="analysis-loading">Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="analysis-page">
      <div className="analysis-page-header">
        <h1>Performance Analysis</h1>
      </div>

      {availableSubjects.length > 0 ? (
        <>
          <div className="subject-tabs-container">
            {availableSubjects.map((subject) => (
              <button
                key={subject}
                className={`subject-tab ${activeSubject === subject ? 'active' : ''}`}
                onClick={() => setActiveSubject(subject)}
              >
                {subject}
              </button>
            ))}
          </div>

          <div className="analysis-content">
            {activeSubject && (
              <>
                {/* Marking Results Table - Show immediately */}
                {markingResults.length > 0 && (
                  <div className="marking-results-section">
                    <h2>Marking Results</h2>
                    <MarkingResultsTable 
                      markingResults={markingResults}
                      subject={activeSubject}
                      onDelete={() => fetchMarkingResults(activeSubject)}
                      getAuthToken={getAuthToken}
                    />
                  </div>
                )}
                
                {/* Analysis Report - May trigger in background */}
                <div className="analysis-section">
                  <h2>Performance Analysis</h2>
                  <AnalysisReport
                    subject={activeSubject}
                    reAnalysisNeeded={reAnalysisNeeded}
                  />
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className="no-sessions">
          <p>No marking sessions found.</p>
          <p className="hint">Upload and mark some homework to see analysis reports.</p>
        </div>
      )}
    </div>
  );
};

export default AnalysisPage;
