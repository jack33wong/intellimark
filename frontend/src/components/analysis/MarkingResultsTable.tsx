/**
 * Marking Results Table Component
 * Displays marking results grouped by exam board with statistics
 */

import React, { useState } from 'react';
import './MarkingResultsTable.css';

interface MarkingResult {
  sessionId: string;
  sessionTitle?: string;
  timestamp: string;
  examMetadata: {
    examBoard: string;
    examCode: string;
    examSeries: string;
    qualification: string;
    tier?: string;
    paperTitle: string;
    subject: string;
  };
  overallScore: {
    awardedMarks: number;
    totalMarks: number;
    scoreText: string;
    percentage: number;
  };
  grade?: string;
  modelUsed: string;
}

interface ExamBoardGroup {
  examBoard: string;
  results: MarkingResult[];
  averageScore: {
    awarded: number;
    total: number;
    percentage: number;
  };
  averageGrade: string;
  highestGrade: string;
}

interface MarkingResultsTableProps {
  markingResults: MarkingResult[];
  subject: string;
  onDelete?: () => void; // Callback to refresh data after delete
  getAuthToken?: () => Promise<string | null>; // Auth token getter
}

const MarkingResultsTable: React.FC<MarkingResultsTableProps> = ({ 
  markingResults, 
  subject, 
  onDelete,
  getAuthToken 
}) => {
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  // Group marking results by exam board
  const groupByExamBoard = (results: MarkingResult[]): ExamBoardGroup[] => {
    const grouped = new Map<string, MarkingResult[]>();
    
    results.forEach(result => {
      const board = result.examMetadata.examBoard || 'Unknown';
      if (!grouped.has(board)) {
        grouped.set(board, []);
      }
      grouped.get(board)!.push(result);
    });
    
    // Calculate statistics for each exam board
    const boardGroups: ExamBoardGroup[] = [];
    
    grouped.forEach((results, examBoard) => {
      // Calculate average score
      const totalAwarded = results.reduce((sum, r) => sum + r.overallScore.awardedMarks, 0);
      const totalPossible = results.reduce((sum, r) => sum + r.overallScore.totalMarks, 0);
      const avgAwarded = results.length > 0 ? Math.round(totalAwarded / results.length) : 0;
      const avgTotal = results.length > 0 ? Math.round(totalPossible / results.length) : 0;
      const avgPercentage = avgTotal > 0 ? Math.round((avgAwarded / avgTotal) * 100) : 0;
      
      // Collect grades
      const grades = results.filter(r => r.grade).map(r => r.grade!);
      
      // Find highest grade (numeric comparison)
      const highestGrade = grades.length > 0
        ? grades.reduce((highest, grade) => {
            const numHighest = parseInt(highest, 10) || 0;
            const numGrade = parseInt(grade, 10) || 0;
            return numGrade > numHighest ? grade : highest;
          })
        : 'N/A';
      
      // Find most common grade (average grade)
      const gradeCounts = new Map<string, number>();
      grades.forEach(g => gradeCounts.set(g, (gradeCounts.get(g) || 0) + 1));
      let maxCount = 0;
      let averageGrade = 'N/A';
      gradeCounts.forEach((count, grade) => {
        if (count > maxCount) {
          maxCount = count;
          averageGrade = grade;
        }
      });
      
      boardGroups.push({
        examBoard,
        results: results.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        ),
        averageScore: {
          awarded: avgAwarded,
          total: avgTotal,
          percentage: avgPercentage
        },
        averageGrade,
        highestGrade
      });
    });
    
    // Sort by exam board name
    return boardGroups.sort((a, b) => a.examBoard.localeCompare(b.examBoard));
  };
  
  const boardGroups = groupByExamBoard(markingResults);
  
  if (boardGroups.length === 0) {
    return (
      <div className="marking-results-empty">
        <p>No marking results found.</p>
      </div>
    );
  }
  
  const formatDate = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return timestamp;
    }
  };

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to delete this marking result? This will trigger re-analysis.')) {
      return;
    }

    if (!getAuthToken) {
      console.error('Auth token getter not provided');
      return;
    }

    setDeletingSessionId(sessionId);

    try {
      const authToken = await getAuthToken();
      if (!authToken) {
        alert('Authentication required');
        return;
      }

      const response = await fetch(`/api/analysis/${encodeURIComponent(subject)}/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        // Refresh the data
        if (onDelete) {
          onDelete();
        }
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete marking result');
      }
    } catch (error) {
      console.error('Failed to delete marking result:', error);
      alert('Failed to delete marking result');
    } finally {
      setDeletingSessionId(null);
    }
  };
  
  return (
    <div className="marking-results-container">
      {boardGroups.map((group, groupIndex) => (
        <div key={group.examBoard} className="exam-board-group">
          <div className="exam-board-header">
            <h3 className="exam-board-name">{group.examBoard}</h3>
            <div className="exam-board-stats">
              <div className="stat-item">
                <span className="stat-label">Average Score:</span>
                <span className="stat-value">
                  {group.averageScore.awarded}/{group.averageScore.total} ({group.averageScore.percentage}%)
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Average Grade:</span>
                <span className="stat-value grade">{group.averageGrade}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Highest Grade:</span>
                <span className="stat-value grade highest">{group.highestGrade}</span>
              </div>
            </div>
          </div>
          
          <div className="marking-results-table-wrapper">
            <table className="marking-results-table">
              <thead>
                <tr>
                  <th>Exam Code</th>
                  <th>Exam Series</th>
                  <th>Qualification</th>
                  <th>Score</th>
                  <th>Grade</th>
                  <th>Model Used</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.results.map((result, index) => (
                  <tr key={`${result.sessionId}-${index}`}>
                    <td>{result.examMetadata.examCode}</td>
                    <td>{result.examMetadata.examSeries}</td>
                    <td>{result.examMetadata.qualification}</td>
                    <td className="score-cell">
                      <span className="score-text">{result.overallScore.scoreText}</span>
                      <span className="score-percentage">({result.overallScore.percentage}%)</span>
                    </td>
                    <td className="grade-cell">
                      {result.grade ? (
                        <span className="grade-badge">{result.grade}</span>
                      ) : (
                        <span className="no-grade">-</span>
                      )}
                    </td>
                    <td className="model-cell">{result.modelUsed || 'N/A'}</td>
                    <td className="date-cell">{formatDate(result.timestamp)}</td>
                    <td className="actions-cell">
                      <button
                        className="delete-button"
                        onClick={(e) => handleDelete(result.sessionId, e)}
                        disabled={deletingSessionId === result.sessionId}
                        title="Delete marking result"
                      >
                        {deletingSessionId === result.sessionId ? 'Deleting...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default MarkingResultsTable;

