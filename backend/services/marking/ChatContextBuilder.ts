
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
            // Start Fix: Look up scheme by properties since key is compound (e.g. "1_Edexcel_...")
            // The key in markingSchemesMap is compound, so we cannot just use .get(questionNumber)
            // We iterate to find the matching scheme object where scheme.questionNumber matches.
            let scheme = undefined;
            for (const s of data.markingSchemesMap.values()) {
                if (String(s.questionNumber) === String(qr.questionNumber)) {
                    scheme = s;
                    break;
                }
            }
            // End Fix
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
                questionText: (qr.databaseQuestionText || questionText).substring(0, 1000), // Prioritize database text
                totalMarks: qr.score?.totalMarks || 0,
                awardedMarks: qr.score?.awardedMarks || 0,
                scoreText: qr.score?.scoreText || `${qr.score?.awardedMarks || 0}/${qr.score?.totalMarks || 0}`,
                hasMarkingScheme: !!scheme,
                annotationCount: qr.annotations?.length || 0,
                annotations: annotations,
                schemeSummary: qr.promptMarkingScheme || schemeSummary, // Use exact prompt scheme if available
                studentWork: qr.studentWork || detection?.question?.text || '', // Use Classification Student Work
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
        // Change header to be less technical
        let prompt = `Here is the student's work and the marking results for context:\n\n`;

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
            // Fallback for Question Text
            const displayText = q.questionText || q.databaseQuestionText || '(Text not detected)';
            prompt += `### Question ${q.questionNumber}: ${displayText} \n`;

            // Fallback for Student Answer (Use classification blocks if raw student work is empty)
            let studentWorkText = q.studentWork;
            if (!studentWorkText && q.classificationBlocks?.length) {
                // Approximate reconstruction from blocks
                studentWorkText = q.classificationBlocks.map((b: any) => b.text).join(' ');
            }

            // Explicitly show Student Work (OCR) if available
            if (studentWorkText) {
                prompt += `** Student's Answer **: "${studentWorkText}" \n`;
            }

            // Render Revision History if exists (Simulated Duplication)
            if (q.revisionHistory?.length) {
                q.revisionHistory.forEach((rev, idx) => {
                    prompt += `\n--- Previous Attempt ${idx + 1} for Q${q.questionNumber} ---\n`;
                    prompt += `** Result **: ${rev.scoreText} \n`;
                    prompt += `** Reason for change **: ${rev.reason} \n`;
                    if (rev.annotations?.length) {
                        prompt += `** Previous Annotations **:\n`;
                        rev.annotations.forEach((a: any) => {
                            prompt += `- [${a.action}] ${a.text} ${a.reasoning ? `(${a.reasoning})` : ''}\n`;
                        });
                    }
                    prompt += `--------------------------------------\n`;
                });
            }

            prompt += `** Your Marks ** (Total: ${q.totalMarks}):\n`;

            // Group Annotations by Sub-Question (e.g. 15a, 15b)
            const annsBySubQ: Record<string, any[]> = {};
            const unassignedAnns: any[] = [];

            q.annotations.forEach(a => {
                const sId = (a.step_id || '').toLowerCase(); // e.g. "step_15c_m1"
                const uId = (a.unified_step_id || '').toLowerCase(); // e.g. "15c"

                // Extract sub-question part (e.g. "c" from "15c")
                // Heuristic: Check if ID contains specific sub-q label
                // Simplest: If ID contains "_{part}" or just "{part}"? 
                // Better: Check if ID contains question number + letter

                const qNumStr = String(q.questionNumber).toLowerCase();
                let assigned = false;

                // Try to find a pattern like "15c" or "_c"
                // This assumes standard naming conventions. 
                // Let's rely on finding standard sub-question suffixes a,b,c...i,ii
                const commonParts = ['a', 'b', 'c', 'd', 'e', 'f', 'i', 'ii', 'iii', 'iv'];
                for (const part of commonParts) {
                    const label = `${qNumStr}${part}`; // e.g. "15c"
                    // Check if ID specifically references this part
                    // e.g. step_id="15c_m1" or unified="15c"
                    if (sId.includes(`_${part}`) || sId.includes(label) || uId === label || uId.includes(label)) {
                        if (!annsBySubQ[part]) annsBySubQ[part] = [];
                        annsBySubQ[part].push(a);
                        assigned = true;
                        break;
                    }
                }

                if (!assigned) {
                    unassignedAnns.push(a);
                }
            });

            // Render Unassigned first
            if (unassignedAnns.length > 0) {
                unassignedAnns.forEach(a => {
                    prompt += `- [${a.action}] ${a.text} ${a.reasoning ? `(${a.reasoning})` : ''}\n`;
                });
            }

            // Render Sub-Questions sorted
            Object.keys(annsBySubQ).sort().forEach(part => {
                prompt += `[${q.questionNumber}${part}]\n`;
                annsBySubQ[part].forEach(a => {
                    prompt += `  - [${a.action}] ${a.text} ${a.reasoning ? `(${a.reasoning})` : ''}\n`;
                });
            });


            // Annotations with Student Text & Source
            if (q.annotations && q.annotations.length > 0) {
                // Note: We already listed marks above. This section adds detailed context if needed.
                // For now, the loop above covers it. Removing redundant block unless we want detailed debug info.
            }

            // VALIDATION: Strict Marking Scheme Enforcement
            const isPastPaper = !!markingContext.examInfo;

            if (q.schemeSummary) {
                prompt += `** Marking criteria **: \n${q.schemeSummary} \n`;
                prompt += `> [!IMPORTANT]\n> STRICTLY follow the provided marking criteria above. Do not deviate. \n`;
            } else if (isPastPaper) {
                // Warn if no scheme found for a past paper question
                console.warn(`[ChatContext] Warning: No marking criteria available for Q${q.questionNumber} despite being a Past Paper context.`);
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

        prompt += `Start your response by acknowledging the student's specific work if relevant.\n`;
        // DEBUG: Log the prompt to prove the fixes (Student Work, Layout, Jargon)
        console.log(`\n🔍 [DEBUG CONTEXT CHAT PROMPT]`);
        console.log(prompt);
        console.log(`---------------------------------------------------\n`);

        return prompt;
    }

    /**
     * Helper to extract key criteria from marking scheme structure
     * detailed text summary.
     */
    private static extractSchemeSummary(scheme: any): string | undefined {
        if (!scheme) return undefined;

        let summary = '';

        // 1. General Guidance (if available)
        if (scheme.generalMarkingGuidance) {
            const guidance = scheme.generalMarkingGuidance;
            // Extract strict rules if present
            if (guidance.precedence) summary += `[PRECEDENCE: ${guidance.precedence}]\n`;
            // Add general principles if short, or just summary
        }

        // 2. Extracted Rules
        // Check for answer map (it might be nested in questionMarks)
        const subQuestionAnswersMap = scheme.questionMarks?.subQuestionAnswersMap || scheme.subQuestionAnswersMap;

        // The scheme object might be complex (schemeWithTotalMarks)
        if (scheme.questionMarks) {
            const qm = scheme.questionMarks;

            // Simple Marks Array (questionMarks.marks)
            if (qm.marks && Array.isArray(qm.marks)) {
                summary += qm.marks.map((m: any) => {
                    let answer = m.answer;
                    // Replace 'cao' with actual answer if available (using subQuestionAnswersMap or fallback logic)
                    if (answer && answer.toLowerCase() === 'cao' && subQuestionAnswersMap) {
                        // Try to find matching answer key. 
                        // Note: marks array usually doesn't have sub-question key unless it's a flat list for a single sub-Q.
                        // For a flat list, we might assume there's only one answer in the map if the map size is 1.
                        // Or if the questionNumber itself (e.g. "1a") matches a key.
                        // However, scheme.subQuestionAnswersMap keys are usually "a", "b" etc.
                        // If we are in the flat list, we might not know which "part" this mark belongs to easily 
                        // unless we check scheme.questionNumber.
                        const qNumMatch = String(scheme.questionNumber).match(/([a-z]+|[ivx]+)$/i);
                        const subLabel = qNumMatch ? qNumMatch[1].toLowerCase() : String(scheme.questionNumber).toLowerCase();

                        if (subQuestionAnswersMap[subLabel]) {
                            answer = subQuestionAnswersMap[subLabel];
                        } else if (Object.keys(subQuestionAnswersMap).length === 1) {
                            // Fallback: if only one answer in map, assume it applies
                            answer = Object.values(subQuestionAnswersMap)[0];
                        }
                    }
                    return `- ${m.mark}: ${answer} ${m.comments ? `(${m.comments})` : ''}`;
                }).join('\n');
            }

            // Sub-question Marks (questionMarks.subQuestionMarks)
            if (qm.subQuestionMarks && typeof qm.subQuestionMarks === 'object') {
                for (const [subQ, marks] of Object.entries(qm.subQuestionMarks)) {
                    if (Array.isArray(marks)) {
                        // Extract sub-label (e.g. "11a" -> "a")
                        const match = subQ.match(/([a-z]+|[ivx]+)$/i);
                        const subLabel = match ? match[1].toLowerCase() : subQ.toLowerCase();

                        summary += `\n[${subQ}]\n` + marks.map((m: any) => {
                            let answer = m.answer;
                            // Replace 'cao' with actual answer
                            if (answer && answer.toLowerCase() === 'cao' && subQuestionAnswersMap && subQuestionAnswersMap[subLabel]) {
                                answer = subQuestionAnswersMap[subLabel];
                            }
                            return `  - ${m.mark}: ${answer}`;
                        }).join('\n');
                    }
                }
            }
            // Direct Marks Array (legacy/simple)
            else if (Array.isArray(qm)) {
                summary += qm.map((m: any) => `- ${m.mark}: ${m.answer}`).join('\n');
            }
        }
        // Direct Array (very simple case)
        else if (Array.isArray(scheme)) {
            summary += scheme.map(s => `${s.mark}: ${s.answer} `).join('; ');
        }
        // Fallback: Check if scheme itself has marks property
        else if (scheme.marks && Array.isArray(scheme.marks)) {
            summary += scheme.marks.map((m: any) => `- ${m.mark}: ${m.answer}`).join('\n');
        }

        if (!summary) return undefined;
        return summary.trim();
    }
}
