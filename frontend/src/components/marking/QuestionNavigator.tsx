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
import { useQuestionGrouping, GroupedQuestion } from '../../hooks/useQuestionGrouping';

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
    idPrefix?: string; // To prevent ID collisions between Ribbon and Table instances
}



// Helper to check if a question matches the active ID (e.g. "3a" matches "3" but "3" does NOT match "30")
const isActive = (qNum: string, activeId?: string) => {
    if (!activeId) return false;
    if (qNum === activeId) return true;

    // Check if qNum is a sub-question of activeId (e.g. active="1", q="1a")
    // MUST ensure the next character is NOT a digit (to prevent 1 matching 10)
    if (qNum.startsWith(activeId)) {
        const nextChar = qNum[activeId.length];
        return isNaN(parseInt(nextChar, 10));
    }

    // Check if activeId is a sub-question of qNum (e.g. active="1a", q="1")
    if (activeId.startsWith(qNum)) {
        const nextChar = activeId[qNum.length];
        return isNaN(parseInt(nextChar, 10));
    }

    return false;
};


const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({
    detectedQuestion,
    markingContext,
    mode,
    onNavigate,
    activeQuestionId,
    idPrefix = 'nav' // Default prefix
}) => {
    // Use shared hook for grouping logic
    const { groupedQuestions, getGroupColor } = useQuestionGrouping(detectedQuestion, markingContext);

    const scrollContainerRef = React.useRef<HTMLDivElement>(null);

    // Auto-scroll to active question
    React.useEffect(() => {
        if (activeQuestionId) {
            // Find the item that satisfies isActive (handles sub-questions)
            const match = groupedQuestions.find(q => isActive(q.questionNumber, activeQuestionId));
            if (match) {
                const el = document.getElementById(`${idPrefix}-item-${match.questionNumber}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }
        }
    }, [activeQuestionId, idPrefix, groupedQuestions]);

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
                <div className="ribbon-label">Question Breakdown</div>
                <div className="ribbon-nav-row">
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
                                    id={`${idPrefix}-item-${q.questionNumber}`}
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
            </div>
        );
    }

    // Table Mode - Now rendered as horizontal ribbon
    return (
        <div className="question-navigator-table-horizontal">
            <div className="table-ribbon-scroll-container">
                {groupedQuestions.map((q, idx) => {
                    const color = getGroupColor(q);
                    const scoreText = q.hasResults
                        ? `${q.awardedMarks}/${q.totalMarks}`
                        : `${q.totalMarks}`;

                    return (
                        <button
                            key={`${q.questionNumber}-${idx}`}
                            id={`${idPrefix}-item-${q.questionNumber}`}
                            className={`table-ribbon-item ${isActive(q.questionNumber, activeQuestionId) ? 'active' : ''} score-${color}-bg`}
                            onClick={() => handleQuestionClick(q)}
                        >
                            <span className="q-label">Q{q.questionNumber}</span>
                            <span className={`score-text ${color}`}>
                                {scoreText}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default QuestionNavigator;
