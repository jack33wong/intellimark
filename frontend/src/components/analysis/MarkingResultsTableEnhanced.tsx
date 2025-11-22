/**
 * Enhanced Marking Results Table Component
 * Displays marking results with hierarchical grouping, collapsible sections, and grade trend chart
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Trash2, MapPin, ChevronDown, ChevronRight } from 'lucide-react';
import {
  groupMarkingResults,
  getGroupIndicator,
  getExamCodeIndicator,
  extractPaperCode,
  type MarkingResult,
  type GroupedMarkingResult,
  type ExamCodeGroup
} from './markingResultsUtils';
import GradeTrendChart from './GradeTrendChart';
import './MarkingResultsTableEnhanced.css';

interface PaperCodeSet {
  tier: string;
  paperCodes: string[];
}

interface MarkingResultsTableEnhancedProps {
  markingResults: MarkingResult[];
  paperCodeSets: PaperCodeSet[]; // All available paper code sets from grade boundaries
  subject: string;
  onDelete?: () => void;
  getAuthToken?: () => Promise<string | null>;
}

const MarkingResultsTableEnhanced: React.FC<MarkingResultsTableEnhancedProps> = ({
  markingResults,
  paperCodeSets,
  subject,
  onDelete,
  getAuthToken
}) => {
  const navigate = useNavigate();
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedExamCodes, setExpandedExamCodes] = useState<Set<string>>(new Set());
  const dropdownRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});

  // Group marking results for all paper code sets
  const allGroupedResults = useMemo(() => {
    if (!paperCodeSets || paperCodeSets.length === 0) return [];
    
    // Group results for each paper code set
    const results: Array<{ paperCodeSet: PaperCodeSet; grouped: GroupedMarkingResult[] }> = [];
    
    paperCodeSets.forEach(paperCodeSet => {
      const grouped = groupMarkingResults(markingResults, paperCodeSet.paperCodes);
      // Always include paper code sets, even if they have no records
      // This ensures all paper code sets from grade boundaries are shown
      results.push({ paperCodeSet, grouped });
    });
    
    return results;
  }, [markingResults, paperCodeSets]);

  // Helper functions for keys
  const getGroupKey = (group: GroupedMarkingResult): string => {
    return `${group.paperCodeSetKey}_${group.examSeries}`;
  };

  const getExamCodeKey = (group: GroupedMarkingResult, examCode: string): string => {
    return `${getGroupKey(group)}_${examCode}`;
  };

  // Auto-expand first group and first exam code with records
  useEffect(() => {
    if (allGroupedResults.length > 0) {
      // Find first paper code set with records
      const firstPaperCodeSetWithRecords = allGroupedResults.find(result => 
        result.grouped.some(group => group.examCodeGroups.some(eg => eg.records.length > 0))
      );

      if (firstPaperCodeSetWithRecords) {
        const firstGroupWithRecords = firstPaperCodeSetWithRecords.grouped.find(group => {
          return group.examCodeGroups.some(eg => eg.records.length > 0);
        });

        if (firstGroupWithRecords) {
          const groupKey = getGroupKey(firstGroupWithRecords);
          
          // Expand the group
          setExpandedGroups(prev => {
            if (!prev.has(groupKey)) {
              const next = new Set(prev);
              next.add(groupKey);
              return next;
            }
            return prev;
          });

          // Find first exam code with records in this group
          const firstExamCodeWithRecords = firstGroupWithRecords.examCodeGroups.find(
            eg => eg.records.length > 0
          );

          if (firstExamCodeWithRecords) {
            const examCodeKey = getExamCodeKey(firstGroupWithRecords, firstExamCodeWithRecords.examCode || '');
            
            // Expand the exam code
            setExpandedExamCodes(prev => {
              if (!prev.has(examCodeKey)) {
                const next = new Set(prev);
                next.add(examCodeKey);
                return next;
              }
              return prev;
            });
          }
        }
      }
    }
  }, [allGroupedResults]);

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
          const event = new CustomEvent('loadMarkingSession', {
            detail: { session: data.session }
          });
          window.dispatchEvent(event);
          navigate('/mark-homework');
        } else {
          navigate(`/mark-homework?sessionId=${sessionId}`);
        }
      } else {
        navigate(`/mark-homework?sessionId=${sessionId}`);
      }
    } catch (error) {
      console.error('Failed to fetch session:', error);
      navigate(`/mark-homework?sessionId=${sessionId}`);
    }
  };

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const toggleExamCode = (examCodeKey: string) => {
    setExpandedExamCodes(prev => {
      const next = new Set(prev);
      if (next.has(examCodeKey)) {
        next.delete(examCodeKey);
      } else {
        next.add(examCodeKey);
      }
      return next;
    });
  };

  const renderIndicator = (color: 'green' | 'yellow' | 'red') => {
    const colorMap = {
      green: '#22c55e',
      yellow: '#fbbf24',
      red: '#ef4444'
    };
    return (
      <span
        className="status-indicator"
        style={{ backgroundColor: colorMap[color] }}
        title={
          color === 'green' ? 'All exam codes have results' :
          color === 'yellow' ? 'Partial set (some exam codes have results)' :
          'No results found'
        }
      />
    );
  };

  if (allGroupedResults.length === 0) {
    return (
      <div className="marking-results-enhanced-container">
        <div className="marking-results-empty">
          <p>No marking results found for the available paper code sets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="marking-results-enhanced-container">
      <div className="marking-results-layout">
        {/* Left Column: Table */}
        <div className="marking-results-table-column">
          {allGroupedResults.map(({ paperCodeSet, grouped }) => (
            grouped.map((group) => {
            const groupKey = getGroupKey(group);
            const isExpanded = expandedGroups.has(groupKey);
            const indicator = getGroupIndicator(group);
            const tierLabel = group.tier ? ` (${group.tier})` : '';

            return (
              <div key={groupKey} className="marking-results-group">
                {/* Paper Code Set + Exam Series Header */}
                <div
                  className="group-header"
                  onClick={() => toggleGroup(groupKey)}
                >
                  {renderIndicator(indicator)}
                  <span className="group-title">
                    Paper Code Set: [{group.paperCodeSet.join(' ')}]{paperCodeSet.tier ? ` (${paperCodeSet.tier})` : tierLabel} - Exam Series: {group.examSeries}
                  </span>
                  {isExpanded ? (
                    <ChevronDown size={16} className="chevron-icon" />
                  ) : (
                    <ChevronRight size={16} className="chevron-icon" />
                  )}
                </div>

                {isExpanded && (
                  <div className="group-content">
                    {group.examCodeGroups.map((examCodeGroup) => {
                      if (examCodeGroup.records.length === 0 && !examCodeGroup.examCode) {
                        return null; // Skip empty groups without exam codes
                      }

                      const examCodeKey = getExamCodeKey(group, examCodeGroup.examCode || '');
                      const isExamCodeExpanded = expandedExamCodes.has(examCodeKey);
                      const examCodeIndicator = getExamCodeIndicator(examCodeGroup);
                      const paperCode = extractPaperCode(examCodeGroup.examCode || '');

                      return (
                        <div key={examCodeKey} className="exam-code-group">
                          {/* Exam Code Header */}
                          <div
                            className="exam-code-header"
                            onClick={() => examCodeGroup.records.length > 0 && toggleExamCode(examCodeKey)}
                          >
                            {renderIndicator(examCodeIndicator)}
                            <span className="exam-code-title">
                              Exam Code: {examCodeGroup.examCode || (paperCode ? `[${paperCode}]` : 'N/A')}
                              {examCodeGroup.records.length > 0 && (
                                <span className="record-count"> ({examCodeGroup.records.length} record{examCodeGroup.records.length !== 1 ? 's' : ''})</span>
                              )}
                            </span>
                            {examCodeGroup.records.length > 0 && (
                              isExamCodeExpanded ? (
                                <ChevronDown size={14} className="chevron-icon" />
                              ) : (
                                <ChevronRight size={14} className="chevron-icon" />
                              )
                            )}
                          </div>

                          {/* Individual Records Table */}
                          {isExamCodeExpanded && examCodeGroup.records.length > 0 && (
                            <div className="records-table-container">
                              <table className="records-table">
                                <thead>
                                  <tr>
                                    <th>Score</th>
                                    <th>Grade</th>
                                    <th>Model Used</th>
                                    <th>Date</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {examCodeGroup.records.map((result, index) => (
                                    <tr key={`${result.sessionId}-${index}`}>
                                      <td className="score-cell">
                                        <span className="score-text">
                                          {result.overallScore.awardedMarks}/{result.overallScore.totalMarks}
                                        </span>
                                        <span className="score-percentage">
                                          ({result.overallScore.totalMarks > 0
                                            ? Math.round((result.overallScore.awardedMarks / result.overallScore.totalMarks) * 100)
                                            : 0}%)
                                        </span>
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
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
            })
          ))}
        </div>

        {/* Right Column: Chart */}
        <div className="marking-results-chart-column">
          <GradeTrendChart
            allGroupedResults={allGroupedResults}
          />
        </div>
      </div>
    </div>
  );
};

export default MarkingResultsTableEnhanced;

