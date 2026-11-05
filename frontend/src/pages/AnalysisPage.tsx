/**
 * Analysis Page Component
 * Redesigned with hierarchical structure: Qualification → Subject → Exam Board → Paper Code Set
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Search, Filter, Loader2, Menu } from 'lucide-react';
import SEO from '../components/common/SEO';
import {
  AnalysisReport,
  QualificationSelector,
  ExamBoardSelector,
  PaperCodeSetSelector,
  PaperCodeAggregatedStats,
  MarkingResultsTableEnhanced,
  ExamSeriesTierReminder,
  normalizeExamBoard,
  normalizeExamSeries,
  groupMarkingResults,
  extractPaperCode,
  matchesPaperCode
} from '../components/analysis';
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

interface PaperCodeSet {
  tier: string;
  paperCodes: string[];
}

interface PaperCodeStat {
  paperCode: string;
  totalAttempts: number;
  averageScore: {
    awarded: number;
    total: number;
    percentage: number;
  };
  highestGrade: string;
  averageGrade: string;
}

interface AnalysisPageProps {
  setSidebarOpen?: (open: boolean) => void;
}

const AnalysisPage: React.FC<AnalysisPageProps> = ({ setSidebarOpen }) => {
  const { user, getAuthToken } = useAuth();

  // Level 1: Qualification
  const [selectedQualification, setSelectedQualification] = useState<string>('GCSE');
  const [availableQualifications, setAvailableQualifications] = useState<string[]>([]);

  // Level 2: Subject
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  const [subjectLoading, setSubjectLoading] = useState<boolean>(false);

  // Level 3: Exam Board
  const [selectedExamBoard, setSelectedExamBoard] = useState<string>('');

  // Level 4: Paper Code Set
  const [selectedPaperCodeSet, setSelectedPaperCodeSet] = useState<string[] | null>(null);

  // Data
  const [allMarkingResults, setAllMarkingResults] = useState<MarkingResult[]>([]);
  const [gradeBoundaries, setGradeBoundaries] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [reAnalysisNeeded, setReAnalysisNeeded] = useState(false);

  const isInvalidBoard = (b?: string) =>
    !b || ['unknown', 'n/a', 'none', 'undefined', 'null'].includes(b.trim().toLowerCase());

  // Reset helpers for synchronous tab/filter transitions
  const handleSubjectChange = (newSubject: string) => {
    if (newSubject === selectedSubject) return;
    setSubjectLoading(true);
    setSelectedSubject(newSubject);
    setSelectedExamBoard('');
    setSelectedPaperCodeSet(null);
    setAvailableQualifications([]);
    setAllMarkingResults([]);
    setGradeBoundaries([]);
  };

  const handleQualificationChange = (newQual: string) => {
    setSelectedQualification(newQual);
    setSelectedExamBoard('');
    setSelectedPaperCodeSet(null);
  };

  const handleExamBoardChange = (newBoard: string) => {
    setSelectedExamBoard(newBoard);
    setSelectedPaperCodeSet(null);
  };

  // Fetch grade boundaries structure
  const fetchGradeBoundaries = useCallback(async (qualification: string, subject: string) => {
    if (!qualification || !subject) return;

    try {
      const authToken = await getAuthToken();
      if (!authToken) return;

      const response = await fetch(
        `/api/analysis/grade-boundaries?qualification=${encodeURIComponent(qualification)}&subject=${encodeURIComponent(subject)}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.gradeBoundaries) {
          setGradeBoundaries(data.gradeBoundaries);
        } else {
          setGradeBoundaries([]);
        }
      } else {
        setGradeBoundaries([]);
      }
    } catch (error) {
      console.error('Failed to fetch grade boundaries:', error);
      setGradeBoundaries([]);
    }
  }, [getAuthToken]);

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
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/analysis/subjects`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.subjects) {
          const subjects = data.subjects.sort();
          setAvailableSubjects(subjects);

          // Default to Mathematics if available
          if (subjects.length > 0 && !selectedSubject) {
            const mathIndex = subjects.findIndex((s: string) =>
              s.toLowerCase().includes('math') || s.toLowerCase() === 'mathematics'
            );
            setSelectedSubject(mathIndex >= 0 ? subjects[mathIndex] : subjects[0]);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load subjects:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, getAuthToken, selectedSubject]);

  // Fetch marking results for subject
  const fetchMarkingResults = useCallback(async (subject: string) => {
    if (!user?.uid || !subject) {
      setAllMarkingResults([]);
      setSubjectLoading(false);
      return;
    }

    try {
      setSubjectLoading(true);
      const authToken = await getAuthToken();
      if (!authToken) {
        setSubjectLoading(false);
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
          const results = result.markingResults || [];
          setAllMarkingResults(results);
          setReAnalysisNeeded(result.reAnalysisNeeded || false);

          // Extract unique qualifications
          const qualifications = Array.from(
            new Set(results.map((mr: MarkingResult) => mr.examMetadata?.qualification).filter(Boolean))
          ).sort() as string[];
          const availableQuals = qualifications.length > 0 ? qualifications : ['GCSE'];
          setAvailableQualifications(availableQuals);
          if (!selectedQualification || !availableQuals.includes(selectedQualification)) {
            setSelectedQualification(availableQuals[0]);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load marking results:', error);
    } finally {
      setSubjectLoading(false);
    }
  }, [user?.uid, getAuthToken, selectedQualification]);

  // Fetch subjects on mount
  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  // Fetch marking results when subject changes
  useEffect(() => {
    if (selectedSubject) {
      fetchMarkingResults(selectedSubject);
    }
  }, [selectedSubject, fetchMarkingResults]);

  // Fetch grade boundaries when qualification or subject changes
  useEffect(() => {
    if (selectedQualification && selectedSubject) {
      fetchGradeBoundaries(selectedQualification, selectedSubject);
    }
  }, [selectedQualification, selectedSubject, fetchGradeBoundaries]);

  // Extract available exam boards synchronously from grade boundaries and marking results
  const availableExamBoards = useMemo(() => {
    if (!selectedSubject) return [];

    const boardsFromGB = gradeBoundaries
      .filter((gb: any) => !selectedQualification || gb.qualification === selectedQualification)
      .map((gb: any) => gb.exam_board)
      .filter((b: string) => !isInvalidBoard(b));

    const boardsFromResults = allMarkingResults
      .filter(mr => !selectedQualification || mr.examMetadata?.qualification === selectedQualification)
      .map(mr => mr.examMetadata?.examBoard)
      .filter((b: string) => !isInvalidBoard(b));

    const combined = Array.from(new Set([...boardsFromGB, ...boardsFromResults])).filter(Boolean) as string[];
    combined.sort();
    return combined;
  }, [gradeBoundaries, allMarkingResults, selectedSubject, selectedQualification]);

  // Synchronously compute effective exam board (defaulting cleanly without render lag)
  const effectiveExamBoard = useMemo(() => {
    if (availableExamBoards.length === 0) return '';
    // If selectedExamBoard is still valid in availableExamBoards, keep it
    if (selectedExamBoard && availableExamBoards.some(b => normalizeExamBoard(b) === normalizeExamBoard(selectedExamBoard))) {
      return selectedExamBoard;
    }

    // Default based on most recent marking result (ignoring invalid/unknown boards)
    const relevantResults = allMarkingResults
      .filter(mr =>
        (!selectedQualification || mr.examMetadata?.qualification === selectedQualification) &&
        !isInvalidBoard(mr.examMetadata?.examBoard)
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (relevantResults.length > 0) {
      const mostRecentBoard = relevantResults[0].examMetadata.examBoard;
      const matchingBoard = availableExamBoards.find(b => normalizeExamBoard(b) === normalizeExamBoard(mostRecentBoard));
      if (matchingBoard) return matchingBoard;
    }

    // Default to Pearson Edexcel if available
    const edexcel = availableExamBoards.find(b => normalizeExamBoard(b) === 'Pearson Edexcel');
    if (edexcel) return edexcel;

    return availableExamBoards[0];
  }, [availableExamBoards, selectedExamBoard, allMarkingResults, selectedQualification]);

  // Derive available paper code sets specifically for effectiveExamBoard
  const availablePaperCodeSets = useMemo(() => {
    if (!selectedSubject) {
      return [];
    }

    const tierMap = new Map<string, PaperCodeSet>();

    // 1. Look in gradeBoundaries for effectiveExamBoard
    if (effectiveExamBoard && gradeBoundaries.length > 0) {
      const relevantGB = gradeBoundaries.filter((gb: any) =>
        normalizeExamBoard(gb.exam_board) === normalizeExamBoard(effectiveExamBoard) &&
        (!selectedQualification || gb.qualification === selectedQualification)
      );

      relevantGB.forEach((gb: any) => {
        (gb.subjects || []).forEach((subjectData: any) => {
          (subjectData.tiers || []).forEach((tier: any) => {
            const tierName = tier.tier_level || 'Single Tier';
            const tierKey = tierName.toLowerCase();
            const rawCodes: string[] = tier.paper_codes || [];
            // Normalize to short codes for clean display and reliable matching
            const paperCodes = rawCodes.map((c: string) => extractPaperCode(c) || c);

            if (!tierMap.has(tierKey) || paperCodes.length > (tierMap.get(tierKey)?.paperCodes.length || 0)) {
              tierMap.set(tierKey, {
                tier: tierName,
                paperCodes
              });
            }
          });
        });
      });
    }

    // 2. If no grade boundaries yielded paper codes, derive from marking results for this board
    if (tierMap.size === 0 && allMarkingResults.length > 0) {
      const relevantResults = allMarkingResults.filter(mr =>
        (!selectedQualification || mr.examMetadata?.qualification === selectedQualification) &&
        (!effectiveExamBoard || normalizeExamBoard(mr.examMetadata?.examBoard || '') === normalizeExamBoard(effectiveExamBoard))
      );

      const resultsByTier = new Map<string, Set<string>>();
      relevantResults.forEach(mr => {
        const tierName = mr.examMetadata?.tier && mr.examMetadata.tier !== 'N/A'
          ? mr.examMetadata.tier
          : 'Single Tier';
        const pc = extractPaperCode(mr.examMetadata?.examCode || '') || mr.examMetadata?.examCode;
        if (pc) {
          if (!resultsByTier.has(tierName)) {
            resultsByTier.set(tierName, new Set());
          }
          resultsByTier.get(tierName)!.add(pc);
        }
      });

      resultsByTier.forEach((codes, tierName) => {
        const tierKey = tierName.toLowerCase();
        tierMap.set(tierKey, {
          tier: tierName,
          paperCodes: Array.from(codes).sort()
        });
      });
    }

    return Array.from(tierMap.values());
  }, [effectiveExamBoard, gradeBoundaries, allMarkingResults, selectedSubject, selectedQualification]);

  // Synchronously compute effective paper code set
  const effectivePaperCodeSet = useMemo(() => {
    if (availablePaperCodeSets.length === 0) return null;
    if (selectedPaperCodeSet && availablePaperCodeSets.some(s =>
      JSON.stringify(s.paperCodes) === JSON.stringify(selectedPaperCodeSet)
    )) {
      return selectedPaperCodeSet;
    }
    const higherTier = availablePaperCodeSets.find(s => s.tier.toLowerCase().includes('higher'));
    return higherTier ? higherTier.paperCodes : availablePaperCodeSets[0].paperCodes;
  }, [availablePaperCodeSets, selectedPaperCodeSet]);

  // Filter marking results synchronously
  const filteredMarkingResults = useMemo(() => {
    let filtered = allMarkingResults;

    if (selectedQualification) {
      filtered = filtered.filter(mr =>
        mr.examMetadata?.qualification === selectedQualification
      );
    }

    if (effectiveExamBoard) {
      filtered = filtered.filter(mr =>
        normalizeExamBoard(mr.examMetadata?.examBoard || '') === normalizeExamBoard(effectiveExamBoard)
      );
    }

    return filtered.slice().sort((a, b) => {
      const dateCompare = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (dateCompare !== 0) return dateCompare;
      return (a.examMetadata?.examCode || '').localeCompare(b.examMetadata?.examCode || '');
    });
  }, [allMarkingResults, selectedQualification, effectiveExamBoard]);

  // Calculate paper code stats synchronously
  const paperCodeStats = useMemo(() => {
    if (!effectivePaperCodeSet || effectivePaperCodeSet.length === 0) {
      return [];
    }

    return effectivePaperCodeSet.map(paperCode => {
      const results = filteredMarkingResults.filter(mr => {
        return matchesPaperCode(mr.examMetadata?.examCode || '', paperCode);
      });

      if (results.length === 0) {
        return {
          paperCode,
          totalAttempts: 0,
          averageScore: { awarded: 0, total: 0, percentage: 0 },
          highestGrade: '-',
          averageGrade: '-'
        };
      }

      const totalAwarded = results.reduce((sum, r) => sum + r.overallScore.awardedMarks, 0);
      const totalPossible = results.reduce((sum, r) => sum + r.overallScore.totalMarks, 0);
      const avgAwarded = Math.round(totalAwarded / results.length);
      const avgTotal = Math.round(totalPossible / results.length);
      const avgPercentage = avgTotal > 0 ? Math.round((avgAwarded / avgTotal) * 100) : 0;

      const grades = results.filter(r => r.grade).map(r => r.grade!);
      const highestGrade = grades.length > 0
        ? grades.reduce((highest, grade) => {
          const numHighest = parseInt(highest, 10) || 0;
          const numGrade = parseInt(grade, 10) || 0;
          return numGrade > numHighest ? grade : highest;
        })
        : '-';

      const gradeCounts = new Map<string, number>();
      grades.forEach(g => gradeCounts.set(g, (gradeCounts.get(g) || 0) + 1));
      let maxCount = 0;
      let averageGrade = '-';
      gradeCounts.forEach((count, grade) => {
        if (count > maxCount) {
          maxCount = count;
          averageGrade = grade;
        }
      });

      return {
        paperCode,
        totalAttempts: results.length,
        averageScore: { awarded: avgAwarded, total: avgTotal, percentage: avgPercentage },
        highestGrade,
        averageGrade
      };
    });
  }, [filteredMarkingResults, effectivePaperCodeSet]);

  // Compute if all filters are ready for analysis
  const filtersReady = useMemo(() => {
    if (loading || subjectLoading) return false;
    if (!selectedSubject) return false;
    if (availableQualifications.length > 0 && !selectedQualification) return false;
    if (availableExamBoards.length > 0 && !effectiveExamBoard) return false;
    return true;
  }, [loading, subjectLoading, selectedSubject, availableQualifications.length, selectedQualification, availableExamBoards.length, effectiveExamBoard]);

  if (loading) {
    return (
      <div className="analysis-page">
        <div className="analysis-loading">
          <div className="loading-spinner" />
          <span>Loading analysis...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-page">
      <SEO title='Analysis' />
      <div className="analysis-max-container">
        <div className="analysis-page-header">
          <div className="header-titles">
            <div className="analysis-title-row">
              {setSidebarOpen && (
                <button
                  className="mobile-sidebar-toggle"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open sidebar"
                >
                  <Menu size={20} />
                </button>
              )}
              <h1>Performance Analysis</h1>
            </div>
          </div>
        </div>

        {availableSubjects.length > 0 ? (
          <>
            {/* Level 2: Subject Tabs */}
            <div className="subject-tabs-container">
              {availableSubjects.map((subject) => (
                <button
                  key={subject}
                  className={`subject-tab ${selectedSubject === subject ? 'active' : ''}`}
                  onClick={() => handleSubjectChange(subject)}
                >
                  {subject}
                </button>
              ))}
            </div>

            {/* Selectors Row */}
            {selectedSubject && (availableQualifications.length > 0 || availableExamBoards.length > 0 || availablePaperCodeSets.length > 0) && (
              <div className="selectors-row-container">
                {availableQualifications.length > 0 && (
                  <QualificationSelector
                    selectedQualification={selectedQualification}
                    availableQualifications={availableQualifications}
                    onChange={handleQualificationChange}
                  />
                )}
                {availableExamBoards.length > 0 && (
                  <ExamBoardSelector
                    selectedExamBoard={effectiveExamBoard}
                    availableExamBoards={availableExamBoards}
                    onChange={handleExamBoardChange}
                  />
                )}
                {effectiveExamBoard && availablePaperCodeSets.length > 0 && (
                  <PaperCodeSetSelector
                    selectedPaperCodeSet={effectivePaperCodeSet}
                    availablePaperCodeSets={availablePaperCodeSets}
                    onChange={setSelectedPaperCodeSet}
                  />
                )}
              </div>
            )}

            <div className="analysis-content">
              {selectedSubject && (
                <>
                  {/* Exam Series and Tier Reminder (Missing Attempts Banner) */}
                  {effectiveExamBoard && gradeBoundaries.length > 0 && availablePaperCodeSets.length > 0 && (
                    <div className="reminder-section">
                      <ExamSeriesTierReminder
                        markingResults={allMarkingResults}
                        gradeBoundaries={gradeBoundaries}
                        availablePaperCodeSets={availablePaperCodeSets}
                        selectedExamBoard={effectiveExamBoard}
                        selectedQualification={selectedQualification}
                        selectedSubject={selectedSubject}
                      />
                    </div>
                  )}

                  {/* Paper Code Aggregated Stats */}
                  {effectivePaperCodeSet && paperCodeStats.length > 0 && (
                    <div className="aggregated-stats-section">
                      <PaperCodeAggregatedStats
                        stats={paperCodeStats}
                        paperCodeSet={effectivePaperCodeSet}
                      />
                    </div>
                  )}

                  {/* Marking Results Table & Integrated Graph */}
                  {filteredMarkingResults.length > 0 && (
                    <div className="marking-results-section">
                      <h3 className="section-title">Marking Results</h3>
                      <MarkingResultsTableEnhanced
                        markingResults={filteredMarkingResults}
                        paperCodeSets={availablePaperCodeSets}
                        subject={selectedSubject}
                        onDelete={() => fetchMarkingResults(selectedSubject)}
                        getAuthToken={getAuthToken}
                      />
                    </div>
                  )}

                  {/* Bottom: Analysis Report (Summary Cards) */}
                  {filtersReady ? (
                    <div className="analysis-summary-section">
                      <AnalysisReport
                        key={`${selectedSubject}-${selectedQualification}-${effectiveExamBoard}-${effectivePaperCodeSet?.join(',')}`}
                        subject={selectedSubject}
                        qualification={selectedQualification}
                        examBoard={effectiveExamBoard}
                        paperCodeSet={effectivePaperCodeSet}
                        reAnalysisNeeded={reAnalysisNeeded}
                      />
                    </div>
                  ) : (
                    <div className="analysis-section-placeholder">
                      <div className="analysis-loading">
                        <div className="loading-spinner"></div>
                        <p>Loading filters...</p>
                      </div>
                    </div>
                  )}
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
    </div>
  );
};

export default AnalysisPage;
