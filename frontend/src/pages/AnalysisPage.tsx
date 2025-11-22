/**
 * Analysis Page Component
 * Redesigned with hierarchical structure: Qualification → Subject → Exam Board → Paper Code Set
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { 
  AnalysisReport,
  QualificationSelector,
  ExamBoardSelector,
  PaperCodeSetSelector,
  PaperCodeAggregatedStats,
  MarkingResultsTable
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

const AnalysisPage: React.FC = () => {
  const { user, getAuthToken } = useAuth();
  
  // Level 1: Qualification
  const [selectedQualification, setSelectedQualification] = useState<string>('GCSE');
  const [availableQualifications, setAvailableQualifications] = useState<string[]>([]);
  
  // Level 2: Subject
  const [selectedSubject, setSelectedSubject] = useState<string>('');
  const [availableSubjects, setAvailableSubjects] = useState<string[]>([]);
  
  // Level 3: Exam Board
  const [selectedExamBoard, setSelectedExamBoard] = useState<string>('');
  const [availableExamBoards, setAvailableExamBoards] = useState<string[]>([]);
  
  // Level 4: Paper Code Set
  const [selectedPaperCodeSet, setSelectedPaperCodeSet] = useState<string[] | null>(null);
  const [availablePaperCodeSets, setAvailablePaperCodeSets] = useState<PaperCodeSet[]>([]);
  
  // Data
  const [allMarkingResults, setAllMarkingResults] = useState<MarkingResult[]>([]);
  const [filteredMarkingResults, setFilteredMarkingResults] = useState<MarkingResult[]>([]);
  const [paperCodeStats, setPaperCodeStats] = useState<PaperCodeStat[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [reAnalysisNeeded, setReAnalysisNeeded] = useState(false);

  // Extract paper code from examCode (e.g., "1MA1/1H" -> "1H")
  const extractPaperCode = (examCode: string): string | null => {
    if (!examCode || !examCode.includes('/')) return null;
    const parts = examCode.split('/');
    return parts.length > 1 ? parts[parts.length - 1].trim() : null;
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
          // Extract exam boards
          const examBoards = Array.from(
            new Set(data.gradeBoundaries.map((gb: any) => gb.exam_board))
          ).sort() as string[];

          // Extract paper code sets from first grade boundary entry
          const firstGB = data.gradeBoundaries[0];
          if (firstGB && firstGB.subjects && firstGB.subjects.length > 0) {
            const subjectData = firstGB.subjects[0];
            const paperCodeSets: PaperCodeSet[] = (subjectData.tiers || []).map((tier: any) => ({
              tier: tier.tier_level,
              paperCodes: tier.paper_codes || []
            }));

            setAvailableExamBoards(examBoards);
            setAvailablePaperCodeSets(paperCodeSets);
            if (paperCodeSets.length > 0 && !selectedPaperCodeSet) {
              // Default to higher tier if available
              const higherTier = paperCodeSets.find(s => 
                s.tier.toLowerCase().includes('higher')
              );
              setSelectedPaperCodeSet(higherTier ? higherTier.paperCodes : paperCodeSets[0].paperCodes);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch grade boundaries:', error);
    }
  }, [getAuthToken, selectedExamBoard, selectedPaperCodeSet]);

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
      return;
    }

    try {
      const authToken = await getAuthToken();
      if (!authToken) return;

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
          setAllMarkingResults(result.markingResults || []);
          setReAnalysisNeeded(result.reAnalysisNeeded || false);

          // Extract unique qualifications
          const qualifications = Array.from(
            new Set(result.markingResults?.map((mr: MarkingResult) => mr.examMetadata.qualification) || [])
          ).sort() as string[];
          if (qualifications.length > 0 && availableQualifications.length === 0) {
            setAvailableQualifications(qualifications);
            setSelectedQualification(qualifications[0]);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load marking results:', error);
    }
  }, [user?.uid, getAuthToken, availableQualifications.length]);

  // Filter and aggregate marking results
  useEffect(() => {
    let filtered = allMarkingResults;

    // Filter by qualification
    if (selectedQualification) {
      filtered = filtered.filter(mr =>
        mr.examMetadata.qualification === selectedQualification
      );
    }

    // Filter by exam board
    if (selectedExamBoard) {
      filtered = filtered.filter(mr =>
        mr.examMetadata.examBoard === selectedExamBoard
      );
    }

    // Filter by paper code set
    if (selectedPaperCodeSet && selectedPaperCodeSet.length > 0) {
      filtered = filtered.filter(mr => {
        const paperCode = extractPaperCode(mr.examMetadata.examCode);
        return paperCode && selectedPaperCodeSet.includes(paperCode);
      });
    }

    // Sort by date (newest first), then by exam code
    filtered.sort((a, b) => {
      const dateCompare = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.examMetadata.examCode.localeCompare(b.examMetadata.examCode);
    });

    setFilteredMarkingResults(filtered);

    // Calculate paper code stats
    if (selectedPaperCodeSet && selectedPaperCodeSet.length > 0) {
      const stats: PaperCodeStat[] = selectedPaperCodeSet.map(paperCode => {
        const results = filtered.filter(mr => {
          const pc = extractPaperCode(mr.examMetadata.examCode);
          return pc === paperCode;
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

      setPaperCodeStats(stats);
    } else {
      setPaperCodeStats([]);
    }
  }, [allMarkingResults, selectedQualification, selectedExamBoard, selectedPaperCodeSet]);

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

  // Reset exam board and paper code set when qualification or subject changes
  useEffect(() => {
    setSelectedExamBoard('');
    setSelectedPaperCodeSet(null);
    setAvailableExamBoards([]);
    setAvailablePaperCodeSets([]);
  }, [selectedQualification, selectedSubject]);

  // Normalize exam board name for comparison (handles variations like "Pearson Edexcel" vs "Edexcel")
  const normalizeExamBoard = (board: string): string => {
    if (!board) return '';
    const normalized = board.toLowerCase().trim();
    // Map common variations
    if (normalized.includes('edexcel')) return 'Pearson Edexcel';
    if (normalized.includes('aqa')) return 'AQA';
    if (normalized.includes('ocr')) return 'OCR';
    if (normalized.includes('wjec')) return 'WJEC';
    if (normalized.includes('eduqas')) return 'Eduqas';
    return board; // Return original if no match
  };

  // Set default exam board based on most recent marking result
  useEffect(() => {
    // Wait for both marking results and available exam boards to be ready
    if (!selectedExamBoard && allMarkingResults.length > 0 && availableExamBoards.length > 0 && selectedQualification && selectedSubject) {
      // Get all marking results for this qualification and subject, sorted by newest first
      const relevantResults = allMarkingResults
        .filter(mr =>
          mr.examMetadata.qualification === selectedQualification &&
          mr.examMetadata.examBoard
        )
        .sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      
      if (relevantResults.length > 0) {
        // Get unique exam boards from marking results (in order of most recent)
        const boardsFromResults = Array.from(
          new Set(relevantResults.map(mr => mr.examMetadata.examBoard))
        );
        
        // Try exact match first
        const exactMatch = boardsFromResults.find(board => 
          availableExamBoards.includes(board)
        );
        
        if (exactMatch) {
          setSelectedExamBoard(exactMatch);
          return;
        }
        
        // Try normalized match
        const normalizedMatch = boardsFromResults.find(resultBoard => {
          const normalizedResult = normalizeExamBoard(resultBoard);
          return availableExamBoards.some(availableBoard => 
            normalizeExamBoard(availableBoard) === normalizedResult
          );
        });
        
        if (normalizedMatch) {
          // Find the corresponding available exam board
          const matchingAvailableBoard = availableExamBoards.find(availableBoard =>
            normalizeExamBoard(availableBoard) === normalizeExamBoard(normalizedMatch)
          );
          if (matchingAvailableBoard) {
            setSelectedExamBoard(matchingAvailableBoard);
            return;
          }
        }
        
        // If no match, find which available exam board has the most results (with normalization)
        const boardCounts = new Map<string, number>();
        relevantResults.forEach(mr => {
          const resultBoard = mr.examMetadata.examBoard;
          const matchingAvailableBoard = availableExamBoards.find(availableBoard =>
            normalizeExamBoard(availableBoard) === normalizeExamBoard(resultBoard)
          );
          if (matchingAvailableBoard) {
            boardCounts.set(matchingAvailableBoard, (boardCounts.get(matchingAvailableBoard) || 0) + 1);
          }
        });
        
        if (boardCounts.size > 0) {
          // Get the exam board with most results
          const bestBoard = Array.from(boardCounts.entries())
            .sort((a, b) => b[1] - a[1])[0][0];
          setSelectedExamBoard(bestBoard);
        } else {
          // No matching board found, use first available
          setSelectedExamBoard(availableExamBoards[0]);
        }
      } else {
        // No results for this qualification/subject, use first available
        setSelectedExamBoard(availableExamBoards[0]);
      }
    } else if (availableExamBoards.length > 0 && !selectedExamBoard) {
      // Fallback: if no marking results yet, use first available
      setSelectedExamBoard(availableExamBoards[0]);
    }
  }, [availableExamBoards, allMarkingResults, selectedQualification, selectedSubject, selectedExamBoard]);

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
      <div className="analysis-page-header">
        <h1>Performance Analysis</h1>
      </div>

      {availableSubjects.length > 0 ? (
        <>
          {/* Level 1: Qualification */}
          {availableQualifications.length > 0 && (
            <QualificationSelector
              selectedQualification={selectedQualification}
              availableQualifications={availableQualifications}
              onChange={setSelectedQualification}
            />
          )}

          {/* Level 2: Subject */}
          <div className="subject-tabs-container">
            {availableSubjects.map((subject) => (
              <button
                key={subject}
                className={`subject-tab ${selectedSubject === subject ? 'active' : ''}`}
                onClick={() => setSelectedSubject(subject)}
              >
                {subject}
              </button>
            ))}
          </div>

          {/* Level 3 & 4: Exam Board and Paper Code Set (side by side in single container) */}
          {selectedSubject && (availableExamBoards.length > 0 || availablePaperCodeSets.length > 0) && (
            <div className="exam-board-paper-code-container">
              {availableExamBoards.length > 0 && (
                <ExamBoardSelector
                  selectedExamBoard={selectedExamBoard}
                  availableExamBoards={availableExamBoards}
                  onChange={setSelectedExamBoard}
                />
              )}
              {selectedExamBoard && availablePaperCodeSets.length > 0 && (
                <PaperCodeSetSelector
                  selectedPaperCodeSet={selectedPaperCodeSet}
                  availablePaperCodeSets={availablePaperCodeSets}
                  onChange={setSelectedPaperCodeSet}
                />
              )}
            </div>
          )}

          <div className="analysis-content">
            {selectedSubject && (
              <>
                {/* Paper Code Aggregated Stats */}
                {selectedPaperCodeSet && paperCodeStats.length > 0 && (
                  <div className="aggregated-stats-section">
                    <PaperCodeAggregatedStats
                      stats={paperCodeStats}
                      paperCodeSet={selectedPaperCodeSet}
                    />
                  </div>
                )}

                {/* Marking Results Table */}
                {filteredMarkingResults.length > 0 && (
                  <div className="marking-results-section">
                    <h2>Marking Results</h2>
                    {selectedPaperCodeSet && (
                      <p className="filter-indicator">
                        Showing results for paper codes: {selectedPaperCodeSet.join(', ')}
                      </p>
                    )}
                    <MarkingResultsTable
                      markingResults={filteredMarkingResults}
                      subject={selectedSubject}
                      onDelete={() => fetchMarkingResults(selectedSubject)}
                      getAuthToken={getAuthToken}
                    />
                  </div>
                )}

                {/* Analysis Report */}
                <div className="analysis-section">
                  <h2>Performance Analysis</h2>
                  <AnalysisReport
                    subject={selectedSubject}
                    qualification={selectedQualification}
                    examBoard={selectedExamBoard}
                    paperCodeSet={selectedPaperCodeSet}
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
