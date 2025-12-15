/**
 * Question Navigator Component
 * 
 * Display modes:
 * 1. 'table': Grid view for Chat Mode (side-by-side with gallery)
 * 2. 'ribbon': Horizontal scroll view for Split Mode (sticky header)
 */
import React from 'react';
import type { DetectedQuestion, MarkingContext } from '../../types';
import './css/QuestionNavigator.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface QuestionNavigatorProps {
    detectedQuestion: DetectedQuestion | null;
    markingContext?: MarkingContext; // Added source for actual scores
    studentScore?: {
        totalMarks?: number;
        awardedMarks?: number;
        scoreText?: string;
    };
    mode: 'table' | 'ribbon';
    onNavigate?: (questionNumber: string, sourceImageIndex: number) => void;
    activeQuestionId?: string; // For highlighting current question
}

interface GroupedQuestion {
    questionNumber: string; // The main number, e.g., "1", "2"
    totalMarks: number;     // Sum of sub-questions
    awardedMarks: number | null; // Sum of awarded, or null if any missing
    sourceImageIndex: number; // Index of the first sub-question
    subQuestions: string[]; // List of sub-question numbers
    hasResults: boolean;
}

// Helper to check if a question matches the active ID (e.g. "3a" matches "3" or "3a")
const isActive = (qNum: string, activeId?: string) => {
    if (!activeId) return false;
    return qNum === activeId || qNum.startsWith(activeId) || activeId.startsWith(qNum);
};


const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({
    detectedQuestion,
    markingContext,
    mode,
    onNavigate,
    activeQuestionId
}) => {
    // Flatten all questions first (memoized or simple calculation, but must be safe)
    const allQuestions = detectedQuestion?.examPapers?.flatMap(paper =>
        paper.questions.map(q => ({
            ...q,
            examPaper: paper
        }))
    ) || [];

    // Group questions by main number
    const groupedQuestions = React.useMemo(() => {
        if (allQuestions.length === 0) return [];

        const groups: Record<string, GroupedQuestion> = {};
        const order: string[] = []; // Maintain order

        // 1. First pass: Structure the groups based on DetectedQuestion (Schema)
        allQuestions.forEach(q => {
            // Regex to extract main number: 
            // "15a" -> "15"
            // "2(b)(i)" -> "2"
            // "3" -> "3"
            const match = q.questionNumber.match(/^(\d+)/);
            const mainNum = match ? match[1] : q.questionNumber;

            if (!groups[mainNum]) {
                groups[mainNum] = {
                    questionNumber: mainNum,
                    totalMarks: 0,
                    awardedMarks: 0, // We will calculate this next
                    sourceImageIndex: q.sourceImageIndex || 0,
                    subQuestions: [],
                    hasResults: false
                };
                order.push(mainNum);
            }

            groups[mainNum].totalMarks += (q.marks || 0);
            groups[mainNum].subQuestions.push(q.questionNumber);
        });

        // 2. Second pass: Aggregate actual RESULTS from MarkingContext
        // We iterate through the GROUPS to sum up results found in context
        if (markingContext && markingContext.questionResults) {
            const normalize = (s: string) => s.toLowerCase().replace(/[\(\)\.]/g, '').trim();

            Object.values(groups).forEach(group => {
                let groupAwarded = 0;
                let subResCount = 0;
                let foundAny = false;

                // For each sub-question in this group (from schema), try to find result
                // BUT markingContext results might also use "15a" or "15(a)"
                // OR sometimes markingContext has one entry "15" that sums it up?
                // Let's assume granular results primarily.

                // Strategy: Look for all results that "belong" to this main number
                // This handles cases where schema has 15a, 15b, but results have 15a, 15b

                // Filter results that match this main number prefix
                const relevantResults = markingContext.questionResults.filter(r => {
                    const rMatch = r.questionNumber.match(/^(\d+)/);
                    const rMain = rMatch ? rMatch[1] : r.questionNumber;
                    return rMain === group.questionNumber;
                });

                if (relevantResults.length > 0) {
                    group.hasResults = true;
                    // If we have granular results, sum them
                    // Be careful not to double count if logic is complex, but assuming unique rows per subQ
                    groupAwarded = relevantResults.reduce((sum, r) => sum + r.awardedMarks, 0);

                    // Update the total marks from results if available (often more accurate than detection)
                    // But detection has the structure. Let's trust result totals if they exist.
                    const resultsTotal = relevantResults.reduce((sum, r) => sum + r.totalMarks, 0);
                    if (resultsTotal > 0) {
                        group.totalMarks = resultsTotal;
                    }

                    // CRITICAL FIX: Update sourceImageIndex if marking results have it (Backfill from AI analysis)
                    // 1. Try new field 'pageIndex' on the QuestionResult
                    // 2. Fallback to 'pageIndex' on the first Annotation (for historical data)
                    const validPageResult = relevantResults.find(r =>
                        (r.pageIndex !== undefined && r.pageIndex >= 0) ||
                        (r.annotations && r.annotations.some((a: any) => a.pageIndex !== undefined && a.pageIndex >= 0))
                    );

                    if (validPageResult) {
                        if (validPageResult.pageIndex !== undefined && validPageResult.pageIndex >= 0) {
                            group.sourceImageIndex = validPageResult.pageIndex;
                        } else if (validPageResult.annotations && validPageResult.annotations.length > 0) {
                            // Find first annotation with valid page index
                            const validAnnotation = validPageResult.annotations.find((a: any) => a.pageIndex !== undefined && a.pageIndex >= 0);
                            if (validAnnotation) {
                                group.sourceImageIndex = (validAnnotation as any).pageIndex;
                            }
                        }
                    }
                }

                group.awardedMarks = group.hasResults ? groupAwarded : null;
            });
        }

        return order.map(k => groups[k]);
    }, [allQuestions, markingContext]);

    // Helper to determine color for a group
    const getGroupColor = (q: GroupedQuestion) => {
        if (!q.hasResults || q.awardedMarks === null) return 'neutral';
        if (q.totalMarks > 0) {
            if (q.awardedMarks === q.totalMarks) return 'green';
            if (q.awardedMarks === 0) return 'red';
            return 'yellow';
        }
        return 'neutral';
    };

    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    const handleScroll = (direction: 'left' | 'right') => {
        if (scrollContainerRef.current) {
            const scrollAmount = 200;
            const newScrollLeft = scrollContainerRef.current.scrollLeft + (direction === 'right' ? scrollAmount : -scrollAmount);
            scrollContainerRef.current.scrollTo({
                left: newScrollLeft,
                behavior: 'smooth'
            });
        }
    };

    if (!detectedQuestion || !detectedQuestion.examPapers) return null;

    const handleQuestionClick = (q: GroupedQuestion) => {

        if (onNavigate) {
            // Default to 0 if sourceImageIndex is missing
            onNavigate(q.questionNumber, q.sourceImageIndex || 0);
        }
    };

    if (mode === 'ribbon') {
        return (
            <div className="question-navigator-ribbon">
                <button
                    className="nav-arrow left"
                    aria-label="Previous"
                    onClick={() => handleScroll('left')}
                >
                    <ChevronLeft size={16} />
                </button>
                <div className="ribbon-scroll-container" ref={scrollContainerRef}>
                    {groupedQuestions.map((q, idx) => {
                        const color = getGroupColor(q);
                        return (
                            <button
                                key={`${q.questionNumber}-${idx}`}
                                className={`ribbon-item ${isActive(q.questionNumber, activeQuestionId) ? 'active' : ''} score-${color}-bg`}
                                onClick={() => handleQuestionClick(q)}
                            >
                                <span className="q-label">Q{q.questionNumber}</span>
                                <span className={`score-text ${color}`}>
                                    {q.hasResults ? `${q.awardedMarks}/${q.totalMarks}` : `${q.totalMarks}`}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <button
                    className="nav-arrow right"
                    aria-label="Next"
                    onClick={() => handleScroll('right')}
                >
                    <ChevronRight size={16} />
                </button>
            </div>
        );
    }

    // Table Mode
    return (
        <div className="question-navigator-table-wrapper">
            <div className="question-navigator-table-container">
                <table className="question-navigator-table">
                    <thead>
                        <tr>
                            <th style={{ width: '40%' }}>Question</th>
                            <th style={{ width: '60%', textAlign: 'right' }}>Score</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groupedQuestions.map((q, idx) => {
                            const scoreText = q.hasResults
                                ? `${q.awardedMarks} / ${q.totalMarks}`
                                : `- / ${q.totalMarks || '-'}`;
                            const color = getGroupColor(q);

                            return (
                                <tr
                                    key={`${q.questionNumber}-${idx}`}
                                    onClick={() => handleQuestionClick(q)}
                                    className="clickable-row"
                                >
                                    <td className="col-question">
                                        Q{q.questionNumber}
                                    </td>
                                    <td className={`col-score right-align score-${color}`}>
                                        {scoreText}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default QuestionNavigator;
