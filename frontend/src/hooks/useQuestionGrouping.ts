import { useMemo } from 'react';
import type { DetectedQuestion, MarkingContext } from '../types';

export interface GroupedQuestion {
    questionNumber: string; // The main number, e.g., "1", "2"
    totalMarks: number;     // Sum of sub-questions
    awardedMarks: number | null; // Sum of awarded, or null if any missing
    sourceImageIndex: number; // Index of the first sub-question
    subQuestions: string[]; // List of sub-question numbers
    hasResults: boolean;
}

export const useQuestionGrouping = (
    detectedQuestion: DetectedQuestion | null,
    markingContext?: MarkingContext
) => {
    // Flatten all questions first
    const allQuestions = useMemo(() => detectedQuestion?.examPapers?.flatMap(paper =>
        paper.questions.map(q => ({
            ...q,
            examPaper: paper
        }))
    ) || [], [detectedQuestion]);

    // Group questions by main number
    const groupedQuestions = useMemo(() => {
        if (allQuestions.length === 0) return [];

        const groups: Record<string, GroupedQuestion> = {};
        const order: string[] = []; // Maintain order

        // 1. First pass: Structure the groups based on DetectedQuestion (Schema)
        allQuestions.forEach(q => {
            // Regex to extract main number: "15a" -> "15"
            const match = q.questionNumber.match(/^(\d+)/);
            const mainNum = match ? match[1] : q.questionNumber;

            if (!groups[mainNum]) {
                groups[mainNum] = {
                    questionNumber: mainNum,
                    totalMarks: 0,
                    awardedMarks: 0,
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
        if (markingContext && markingContext.questionResults) {
            Object.values(groups).forEach(group => {
                let groupAwarded = 0;

                // Filter results that match this main number prefix
                const relevantResults = markingContext.questionResults.filter(r => {
                    const rMatch = r.questionNumber.match(/^(\d+)/);
                    const rMain = rMatch ? rMatch[1] : r.questionNumber;
                    return rMain === group.questionNumber;
                });

                if (relevantResults.length > 0) {
                    group.hasResults = true;
                    groupAwarded = relevantResults.reduce((sum, r) => sum + r.awardedMarks, 0);

                    // Update total marks from results if available
                    const resultsTotal = relevantResults.reduce((sum, r) => sum + r.totalMarks, 0);
                    if (resultsTotal > 0) {
                        group.totalMarks = resultsTotal;
                    }

                    // CRITICAL: Update sourceImageIndex if marking results have it (Backfill from AI analysis)
                    const validPageResult = relevantResults.find(r =>
                        (r.pageIndex !== undefined && r.pageIndex >= 0) ||
                        (r.annotations && r.annotations.some((a: any) => a.pageIndex !== undefined && a.pageIndex >= 0))
                    );

                    if (validPageResult) {
                        if (validPageResult.pageIndex !== undefined && validPageResult.pageIndex >= 0) {
                            group.sourceImageIndex = validPageResult.pageIndex;
                        } else if (validPageResult.annotations && validPageResult.annotations.length > 0) {
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

    return { groupedQuestions, getGroupColor };
};
