/**
 * Analysis Page Component
 * Main page for viewing performance analysis reports
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import MarkingHistoryService from '../services/markingHistoryService';
import { AnalysisReport } from '../components/analysis';
import type { UnifiedSession } from '../types';
import './AnalysisPage.css';

const AnalysisPage: React.FC = () => {
  const { user, getAuthToken } = useAuth();
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<UnifiedSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch sessions with marking results
  const fetchSessions = useCallback(async () => {
    if (!user?.uid) {
      setSessions([]);
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

      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 100, authToken) as {
        success: boolean;
        sessions?: UnifiedSession[];
        total?: number;
        limit?: number;
      };
      
      if (response.success && response.sessions) {
        // Filter to only sessions with marking results
        // Check for: messageType === 'Marking' OR messages with studentScore
        const markingSessions = response.sessions.filter((session: UnifiedSession) => {
          // Check session-level messageType
          if (session.messageType === 'Marking' || session.messageType === 'Mixed') {
            return true;
          }
          
          // Check for messages with studentScore (marking results)
          return session.messages?.some((msg: any) => 
            msg.role === 'assistant' && 
            msg.studentScore &&
            (msg.type === 'marking_annotated' || msg.imageDataArray || msg.imageData)
          );
        });
        
        const sortedSessions = markingSessions.sort((a: UnifiedSession, b: UnifiedSession) =>
          new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
        );
        
        setSessions(sortedSessions);
        
        // Auto-select first session if available
        if (sortedSessions.length > 0 && !selectedSession) {
          setSelectedSession(sortedSessions[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, getAuthToken, selectedSession]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  const getStudentScore = (session: UnifiedSession): any => {
    const markingMessage = session.messages?.find((msg: any) => 
      msg.role === 'assistant' && 
      msg.studentScore &&
      (msg.type === 'marking_annotated' || msg.imageDataArray || msg.imageData)
    );
    return markingMessage?.studentScore;
  };

  const getGrade = (session: UnifiedSession): string | null => {
    const markingMessage = session.messages?.find((msg: any) => 
      msg.role === 'assistant' && 
      msg.studentScore &&
      (msg.type === 'marking_annotated' || msg.imageDataArray || msg.imageData)
    ) as any; // Type assertion for grade property which may not be in type definition
    return markingMessage?.grade || null;
  };

  const getDetectedQuestion = (session: UnifiedSession): any => {
    const markingMessage = session.messages?.find((msg: any) => 
      msg.role === 'assistant' && 
      msg.detectedQuestion &&
      (msg.type === 'marking_annotated' || msg.imageDataArray || msg.imageData || msg.studentScore)
    );
    return markingMessage?.detectedQuestion;
  };

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
        <p>Select a marking session to view detailed analysis</p>
      </div>

      <div className="analysis-page-content">
        <div className="analysis-session-list">
          {sessions.length === 0 ? (
            <div className="no-sessions">
              <p>No marking sessions found.</p>
              <p className="hint">Upload and mark some homework to see analysis reports.</p>
            </div>
          ) : (
            sessions.map((session) => {
              const studentScore = getStudentScore(session);
              return (
                <div
                  key={session.id}
                  className={`session-item ${selectedSession?.id === session.id ? 'active' : ''}`}
                  onClick={() => setSelectedSession(session)}
                >
                  <div className="session-title">{session.title}</div>
                  <div className="session-meta">
                    <span className="session-date">{formatDate(session.updatedAt || session.createdAt)}</span>
                    {studentScore && (
                      <span className="session-score">
                        {studentScore.scoreText}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="analysis-report-container">
          {selectedSession ? (
            <AnalysisReport
              sessionId={selectedSession.id}
              detectedQuestion={getDetectedQuestion(selectedSession)}
              studentScore={getStudentScore(selectedSession)}
              grade={getGrade(selectedSession)}
            />
          ) : (
            <div className="analysis-empty-state">
              <p>Select a session to view analysis</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalysisPage;

