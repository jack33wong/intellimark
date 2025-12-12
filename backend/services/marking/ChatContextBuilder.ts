
import {
    MarkingContext,
    MarkingContextQuestionResult
} from '../../types/index.js';

/**
 * Service to build and format marking context for follow-up chat.
 * Implements the "Store Once" pattern where context is built at marking time
 * and referenced during chat.
 */
export class ChatContextBuilder {

    /**
     * Builds the complete MarkingContext object to be stored in the AI message.
     * This is called ONCE when marking completes.
     */
    static async buildMarkingContext(data: {
        allQuestionResults: any[],
        questionDetection: any,
        markingSchemesMap: Map<string, any>,
        detectionResults: any[],
        overallScore: { awardedMarks: number; totalMarks: number; percentage: number; scoreText: string; },
        gradeBoundaryResult?: any
    }): Promise<MarkingContext> {

        // 1. Build Question Results
        const questionResults: MarkingContextQuestionResult[] = data.allQuestionResults.map(qr => {
            // Find matching detection result (for text) and scheme
            const detection = data.detectionResults.find(d =>
                String(d.questionNumber) === String(qr.questionNumber)
            );
            const questionText = detection?.questionText || qr.questionText || '';
            const scheme = data.markingSchemesMap.get(String(qr.questionNumber));
            const schemeSummary = this.extractSchemeSummary(scheme);

            // Extract compact annotation list
            const annotations = (qr.annotations || []).map((a: any) => ({
                text: a.text || '',
                action: a.action || '',
                reasoning: a.reasoning || undefined,
                studentText: a.classification_text || undefined, // Capture recognized student text
                sourceType: a.ocr_match_status === 'MATCHED' ? 'ocr' : 'classification' // Capture source
            })).filter((a: any) => a.text || a.reasoning);

            return {
                questionNumber: String(qr.questionNumber),
                questionText: questionText.substring(0, 200), // Truncate to save tokens
                totalMarks: qr.score?.totalMarks || 0,
                awardedMarks: qr.score?.awardedMarks || 0,
                scoreText: qr.score?.scoreText || `${qr.score?.awardedMarks || 0}/${qr.score?.totalMarks || 0}`,
                hasMarkingScheme: !!scheme,
                annotationCount: qr.annotations?.length || 0,
                annotations: annotations,
                schemeSummary: schemeSummary?.substring(0, 200),
                revisionHistory: [] // Initialize empty history
            };
        });

        // 2. Build Exam Info
        let examInfo = undefined;
        if (data.questionDetection?.match) {
            const m = data.questionDetection.match;
            // Estimate total marks from all questions
            const estimatedTotal = questionResults.reduce((sum, q) => sum + q.totalMarks, 0);

            examInfo = {
                examBoard: m.board || 'Unknown',
                subject: 'Mathematics', // Default
                examCode: m.paperCode || 'Unknown',
                examSeries: m.year || 'Unknown',
                tier: m.tier || 'Unknown',
                totalMarks: estimatedTotal
            };
        }

        // 3. Build Grade Info
        let grade = undefined;
        if (data.gradeBoundaryResult) {
            grade = {
                achieved: data.gradeBoundaryResult.grade,
                boundaryType: data.gradeBoundaryResult.boundaryType,
                boundaries: data.gradeBoundaryResult.gradeBoundaries
            };
        }

        return {
            sessionType: 'Marking',
            totalQuestionsMarked: questionResults.length,
            overallScore: {
                awarded: data.overallScore.awardedMarks,
                total: data.overallScore.totalMarks,
                percentage: data.overallScore.percentage,
                scoreText: data.overallScore.scoreText
            },
            examInfo,
            grade,
            questionResults,
            followUpHistory: []
        };
    }

    /**
     * Formats the stored MarkingContext into a prompt string for the AI.
     * This is called for every text-based follow-up message.
     */
    static formatContextAsPrompt(markingContext: MarkingContext): string {
        let prompt = `# Marking Session Context\n\n`;

        // 1. Overall Summary
        prompt += `** Overall Score **: ${markingContext.overallScore.scoreText} (${markingContext.overallScore.percentage}%) \n`;
        prompt += `** Questions Marked **: ${markingContext.totalQuestionsMarked} \n`;

        if (markingContext.examInfo) {
            const e = markingContext.examInfo;
            prompt += `** Exam **: ${e.examBoard} ${e.subject} ${e.examCode} (${e.examSeries}) \n`;
        }

        if (markingContext.grade) {
            prompt += `** Grade Achieved **: ${markingContext.grade.achieved} \n`;
            if (markingContext.grade.boundaries) {
                const b = markingContext.grade.boundaries;
                // Format boundaries compactly: "9:72, 8:64, ..."
                const bText = Object.entries(b)
                    .map(([isValidGrade, mark]) => `${isValidGrade}:${mark} `)
                    .join(', ');
                prompt += `** Grade Boundaries **: ${bText} \n`;
            }
        }

        prompt += `\n## Question Results\n\n`;

        // 2. Question Details
        for (const q of markingContext.questionResults) {

            // Render Revision History if exists (Simulated Duplication)
            if (q.revisionHistory?.length) {
                q.revisionHistory.forEach((rev, idx) => {
                    prompt += `### Q${q.questionNumber} (Previous Attempt ${idx + 1}) - ${rev.scoreText} \n`;
                    prompt += `** Status **: ${rev.reason} \n`;
                    if (rev.annotations?.length) {
                        prompt += `** Annotations **: ${rev.annotations.map((a: any) =>
                            `[${a.text}]${a.text || ''}`
                        ).join(', ')
                            } \n`;
                    }
                    prompt += `\n`;
                });
            }

            // Render Current Result
            prompt += `### Q${q.questionNumber} (Current Result) - ${q.scoreText} \n`;
            prompt += `** Question **: ${q.questionText} \n`;

            // Annotations with Student Text & Source
            if (q.annotations && q.annotations.length > 0) {
                prompt += `** Annotations **: ${q.annotations.map(a =>
                    `[${a.text}]${a.studentText ? `(Saw: "${a.studentText}" via ${a.sourceType})` : ''}${a.reasoning ? ` ${a.reasoning}` : ''}`
                ).join(', ')
                    } \n`;
            }

            if (q.schemeSummary) {
                prompt += `** Marking criteria **: ${q.schemeSummary} \n`;
            }
            prompt += `\n`;
        }

        // 3. Follow-Up History
        if (markingContext.followUpHistory && markingContext.followUpHistory.length > 0) {
            prompt += `## Recent Conversation History\n\n`;
            // Show last 10 exchanges
            const recentHistory = markingContext.followUpHistory.slice(-10);
            for (const entry of recentHistory) {
                prompt += `User: ${entry.userMessage} \n`;
                prompt += `AI: ${entry.aiResponse} \n\n`;
            }
        }

        return prompt;
    }

    /**
     * Helper to extract key criteria from marking scheme structure
     */
    private static extractSchemeSummary(scheme: any): string | undefined {
        if (!scheme) return undefined;

        // Handle different scheme formats
        if (Array.isArray(scheme)) {
            return scheme.map(s =>
                `${s.mark}: ${s.answer} `
            ).join('; ');
        }

        return undefined;
    }
}
