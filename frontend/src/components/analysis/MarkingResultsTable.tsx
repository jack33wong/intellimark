/**
 * Marking Results Table Component
 * Displays marking results grouped by exam board with statistics
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Trash2, MapPin } from 'lucide-react';
import './MarkingResultsTable.css';

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
  const navigate = useNavigate();
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdownId) {
        const dropdown = dropdownRefs.current[openDropdownId];
        if (dropdown && !dropdown.contains(event.target as Node)) {
          setOpenDropdownId(null);
        }
      }
    };

    if (openDropdownId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openDropdownId]);

  // Sort marking results by exam code, then date (newest first)
  const sortedResults = [...markingResults].sort((a, b) => {
    // First sort by exam code
    const codeCompare = a.examMetadata.examCode.localeCompare(b.examMetadata.examCode);
    if (codeCompare !== 0) return codeCompare;
    
    // Then sort by date (newest first)
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  
  if (sortedResults.length === 0) {
    return (
      <div className="marking-results-empty">
        <p>No marking results found.</p>
      </div>
    );
  }
  
  const formatDate = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      const dateStr = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
      const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      return `${dateStr} ${timeStr}`;
    } catch {
      return timestamp;
    }
  };

  const handleDropdownToggle = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenDropdownId(prev => prev === sessionId ? null : sessionId);
  };

  const handleDelete = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenDropdownId(null);
    
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

  const handleLocateInMarking = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenDropdownId(null);
    
    // Fetch the session data and navigate to mark-homework
    // This matches the behavior of clicking on marking history in the sidebar
    try {
      const authToken = getAuthToken ? await getAuthToken() : null;
      if (!authToken) {
        alert('Authentication required');
        return;
      }

      const response = await fetch(`/api/messages/session/${sessionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.session) {
          // Dispatch custom event to trigger session load in App.tsx
          // This matches the pattern used by the sidebar
          const event = new CustomEvent('loadMarkingSession', {
            detail: { session: data.session }
          });
          window.dispatchEvent(event);
          navigate('/mark-homework');
        } else {
          // Fallback: navigate with sessionId in query
          navigate(`/mark-homework?sessionId=${sessionId}`);
        }
      } else {
        // Fallback: navigate with sessionId in query
        navigate(`/mark-homework?sessionId=${sessionId}`);
      }
    } catch (error) {
      console.error('Failed to fetch session:', error);
      // Fallback: navigate with sessionId in query
      navigate(`/mark-homework?sessionId=${sessionId}`);
    }
  };
  
  return (
    <div className="marking-results-container">
      <div className="marking-results-table-wrapper">
        <table className="marking-results-table">
          <thead>
            <tr>
              <th>Exam Code</th>
              <th>Exam Series</th>
              <th>Score</th>
              <th>Grade</th>
              <th>Model Used</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((result, index) => (
              <tr key={`${result.sessionId}-${index}`}>
                <td>{result.examMetadata.examCode}</td>
                <td>{result.examMetadata.examSeries}</td>
                <td className="score-cell">
                  <span className="score-text">{result.overallScore.awardedMarks}/{result.overallScore.totalMarks}</span>
                  <span className="score-percentage">({result.overallScore.totalMarks > 0 ? Math.round((result.overallScore.awardedMarks / result.overallScore.totalMarks) * 100) : 0}%)</span>
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
                  <div className="marking-result-actions-container">
                    <button
                      className="marking-result-dropdown-btn"
                      onClick={(e) => handleDropdownToggle(result.sessionId, e)}
                      title="Actions"
                      ref={(el) => {
                        if (el) {
                          buttonRefs.current[result.sessionId] = el;
                        }
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {openDropdownId === result.sessionId && (
                      <div 
                        className="marking-result-dropdown"
                        ref={(el) => {
                          if (el) {
                            dropdownRefs.current[result.sessionId] = el;
                            // Position dropdown relative to button
                            const button = buttonRefs.current[result.sessionId];
                            if (button) {
                              const rect = button.getBoundingClientRect();
                              el.style.top = `${rect.bottom + window.scrollY + 8}px`;
                              el.style.right = `${window.innerWidth - rect.right}px`;
                            }
                          }
                        }}
                      >
                        <div 
                          className="dropdown-item" 
                          onClick={(e) => handleLocateInMarking(result.sessionId, e)}
                        >
                          <MapPin size={16} />
                          <span>Locate in Marking</span>
                        </div>
                        <div 
                          className={`dropdown-item danger ${deletingSessionId === result.sessionId ? 'disabled' : ''}`}
                          onClick={(e) => {
                            if (deletingSessionId !== result.sessionId) {
                              handleDelete(result.sessionId, e);
                            }
                          }}
                        >
                          <Trash2 size={16} />
                          <span>{deletingSessionId === result.sessionId ? 'Deleting...' : 'Delete'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MarkingResultsTable;

