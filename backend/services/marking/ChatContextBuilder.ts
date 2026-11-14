import {
    MarkingContext,
    MarkingContextQuestionResult,
    QuestionPart,
    Mark
} from '../../types/index.js';
import {
    resolveSubjectProfile,
    SUBJECT_PROFILES,
    type SubjectProfile
} from '../../config/subjectProfiles.js';

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
        gradeBoundaryResult?: any,
        standardizedPages?: import('../../types/markingRouter.js').StandardizedPage[]
    }): Promise<MarkingContext> {

        // 1. Build Question Results with clean nested structure
        const questionResults: MarkingContextQuestionResult[] = data.allQuestionResults.map(qr => {
            // Find matching detection result (for text) and scheme
            const detection = data.detectionResults.find(d =>
                String(d.questionNumber) === String(qr.questionNumber)
            );
            const questionText = detection?.questionText || qr.questionText || '';

            // Look up scheme
            let scheme = undefined;
            for (const s of data.markingSchemesMap.values()) {
                if (String(s.questionNumber) === String(qr.questionNumber)) {
                    scheme = s;
                    break;
                }
            }
            const schemeSummary = this.extractSchemeSummary(scheme);

            // Build parts directly from annotations - NO PARSING!
            // Each annotation has:
            // - unified_line_id: "8ai", "line_8ai_M1", etc. (contains correct full identifier!)
            // - studentText or classificationText: clean student work the AI chose
            // - text: mark code, action: icon, reasoning: feedback

            const questionNumber = String(qr.questionNumber);
            const partMap: Record<string, { part: string; marks: Mark[] }> = {};


            // Smart mapping: use BOTH annotation.subQuestion AND mark codes
            const subQuestionMarks = qr.markingScheme?.questionMarks?.subQuestionMarks;

            (qr.annotations || []).forEach((a: any) => {
                // Use annotation.subQuestion directly as the part
                const part = a.subQuestion || '';

                // Clean student text
                let studentWork = a.studentText || a.classificationText || '';

                // [VISUAL] Override text for drawings with AI observation if available
                if ((a.isDrawing || a.ocr_match_status === 'VISUAL') && (a as any).visualObservation) {
                    studentWork = `[DRAWING] ${(a as any).visualObservation}`;
                }

                if (!partMap[part]) {
                    partMap[part] = {
                        part: part,
                        marks: []
                    };
                }

                // FIX: Group marks if they refer to same work block (e.g. M1, A1 on same line)
                // Check if we already have a mark entry for this EXACT student work in this part
                const existingGroup = partMap[part].marks.find(m => m.work === studentWork && studentWork !== '');

                if (existingGroup) {
                    // Append this mark to existing entry
                    existingGroup.code = `${existingGroup.code} ${a.text || ''}`.trim();
                    // Merge icons if likely tick/cross
                    if (a.action && a.action !== 'tick' && existingGroup.icon === 'tick') existingGroup.icon = a.action;

                    // Merge reasoning with pipe separator
                    if (a.reasoning) {
                        existingGroup.reasoning = existingGroup.reasoning
                            ? `${existingGroup.reasoning} | ${a.reasoning}`
                            : a.reasoning;
                    }

                    // Keep stepId of first (primary) mark, or update if this one is more specific?
                    // Let's keep first one as anchor.
                } else {
                    // Create new entry
                    partMap[part].marks.push({
                        code: a.text || '',
                        icon: a.action || 'tick',
                        reasoning: a.reasoning || '',
                        lineId: a.line_id || '',
                        work: studentWork, // Associate work directly with this mark
                        unifiedLineId: a.unified_line_id
                    });
                }
            });

            // Convert map to array
            const parts: QuestionPart[] = Object.values(partMap)
                .map(p => ({
                    part: p.part,
                    marks: p.marks
                }))
                .sort((a, b) => {
                    // Sort: main question first (empty part), then by sub-question
                    if (a.part === '') return -1;
                    if (b.part === '') return 1;

                    // Smart sort for sub-questions: ai, aii, b, etc.
                    // Extract letter (a, b, c) and roman numeral (i, ii, iii)
                    const parseSubQ = (subQ: string) => {
                        const match = subQ.match(/^([a-z]+)(i*)$/);
                        if (match) {
                            return {
                                letter: match[1],
                                roman: match[2].length // i=1, ii=2, iii=3
                            };
                        }
                        return { letter: subQ, roman: 0 };
                    };

                    const parsedA = parseSubQ(a.part);
                    const parsedB = parseSubQ(b.part);

                    // Sort by letter first (a before b)
                    if (parsedA.letter !== parsedB.letter) {
                        return parsedA.letter.localeCompare(parsedB.letter);
                    }

                    // Then by roman numeral (i before ii)
                    return parsedA.roman - parsedB.roman;
                });

            return {
                number: String(qr.questionNumber),
                text: (qr.databaseQuestionText || questionText).substring(0, 1000),
                scheme: qr.promptMarkingScheme || schemeSummary || '',
                totalMarks: qr.score?.totalMarks || 0,
                earnedMarks: qr.score?.awardedMarks || 0,
                hasScheme: !!scheme,
                pageIndex: qr.pageIndex,
                parts: parts,
                studentWork: typeof qr.studentWork === 'string' ? qr.studentWork : undefined,
                rubricEvaluation: (qr as any).rubricEvaluation || undefined
            };
        });


        // 2. Build Exam Info
        let examInfo = undefined;
        let detectedSubject: string | undefined = (data.questionDetection as any)?.detectedSubject;
        if (data.questionDetection?.match) {
            const m = data.questionDetection.match;
            // Estimate total marks from all questions
            const estimatedTotal = questionResults.reduce((sum, q) => sum + q.totalMarks, 0);
            const rawTextHint = questionResults
                .map(q => [q.text, q.scheme].filter(Boolean).join(' '))
                .join('\n');
            const cleanMatchSubject = m.subject && !/^(unknown|n\/a|general)$/i.test(String(m.subject).trim())
                ? m.subject
                : undefined;
            const resolvedProfile = resolveSubjectProfile({
                detectedSubject: (data.questionDetection as any)?.detectedSubject || m.detectedSubject,
                subject: cleanMatchSubject,
                paperCode: m.paperCode,
                paperTitle: m.paperTitle,
                rawTextHint
            });
            detectedSubject = resolvedProfile.key;

            examInfo = {
                examBoard: m.board || 'Unknown',
                subject: cleanMatchSubject || resolvedProfile.displayName,
                examCode: m.paperCode || 'Unknown',
                examSeries: m.year || 'Unknown',
                tier: m.tier || 'Unknown',
                totalMarks: estimatedTotal
            };
        }

        let grade = undefined;
        if (data.gradeBoundaryResult && data.gradeBoundaryResult.boundaries) {
            grade = {
                achieved: data.gradeBoundaryResult.grade,
                predicted: data.gradeBoundaryResult.predictedGrade,
                boundaryType: data.gradeBoundaryResult.boundaryType,
                boundaries: data.gradeBoundaryResult.boundaries
            };
        }

        return {
            sessionType: 'Marking',
            ...(detectedSubject ? { detectedSubject } : {}),
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
     * Builds MarkingContext for Question/Model Answer/Marking Scheme Mode.
     * Extracts context from the aggregated detectedQuestion structure.
     */
    static async buildQuestionModeContext(data: {
        detectedQuestion: any,
        sessionType?: 'Question' | 'Marking' | 'Mixed',
        subjectProfile?: SubjectProfile,
        examPaperHint?: string | null
    }): Promise<MarkingContext> {
        // 1. Extract Paper & Questions (merge examPapers with any unmatched detectedQuestion.questions, and fall back when examPapers is empty)
        const paper = data.detectedQuestion?.examPapers?.[0];
        const examPaperQuestions = (data.detectedQuestion?.examPapers || []).flatMap((ep: any) => ep.questions || []);
        const rootQuestions = Array.isArray(data.detectedQuestion?.questions) ? data.detectedQuestion.questions : [];

        const normalizeQNum = (q: any) => String(q?.questionNumber || q?.number || '').trim().toLowerCase();
        const rootByNum = new Map<string, any>();
        for (const rq of rootQuestions) {
            const num = normalizeQNum(rq);
            if (num && !rootByNum.has(num)) rootByNum.set(num, rq);
        }

        const questions = examPaperQuestions.length > 0
            ? [
                ...examPaperQuestions.map((epq: any) => {
                    if (epq.sourceImageIndex === undefined && epq.pageIndex === undefined) {
                        const matchedRoot = rootByNum.get(normalizeQNum(epq));
                        if (matchedRoot?.sourceImageIndex !== undefined) {
                            return { ...epq, sourceImageIndex: matchedRoot.sourceImageIndex };
                        }
                    }
                    return epq;
                }),
                ...rootQuestions.filter((rq: any) => {
                    const num = normalizeQNum(rq);
                    const inExamPapers = examPaperQuestions.some((epq: any) =>
                        (num && normalizeQNum(epq) === num) ||
                        (rq.extractedQuestionText && epq.extractedQuestionText && rq.extractedQuestionText === epq.extractedQuestionText)
                    );
                    return !inExamPapers && (rq.detection?.found === false || !rq.databaseQuestionText);
                })
            ]
            : rootQuestions;

        const questionResults: MarkingContextQuestionResult[] = questions.map((q: any) => {
            const rawText = (q.questionText || q.text || '').substring(0, 2000);
            const databaseQuestionText = q.databaseQuestionText
                ? String(q.databaseQuestionText).substring(0, 2000)
                : undefined;
            const extractedQuestionText = (
                q.extractedQuestionText ||
                (!databaseQuestionText ? rawText : '') ||
                ''
            ).substring(0, 2000);

            return {
                number: String(q.questionNumber || q.number || ''),
                text: rawText,
                ...(extractedQuestionText ? { extractedQuestionText } : {}),
                ...(databaseQuestionText ? { databaseQuestionText } : {}),
                scheme: typeof q.markingScheme === 'string'
                    ? q.markingScheme
                    : (q.markingScheme ? JSON.stringify(q.markingScheme) : ''),
                totalMarks: q.marks || 0,
                earnedMarks: 0,
                hasScheme: !!q.markingScheme,
                pageIndex: q.sourceImageIndex ?? q.pageIndex ?? 0,
                parts: []
            };
        });

        // 2. Build Exam Info
        let examInfo = undefined;
        const m = data.detectedQuestion?.match || paper; // Fallback to paper metadata if no match object
        let detectedSubject: string | undefined =
            data.detectedQuestion?.detectedSubject ||
            m?.detectedSubject ||
            (data.subjectProfile && data.subjectProfile.key !== 'MATHS' ? data.subjectProfile.key : undefined);

        const rawTextHint = questionResults
            .map(q => [q.text, q.extractedQuestionText, q.databaseQuestionText, q.scheme].filter(Boolean).join(' '))
            .join('\n');

        if (m) {
            const examCode = m.examCode || m.paperCode || 'Unknown';
            const cleanMatchSubject = m.subject && !/^(unknown|n\/a|general)$/i.test(String(m.subject).trim())
                ? m.subject
                : undefined;
            const cleanDetectedSubject = data.detectedQuestion?.subject && !/^(unknown|n\/a|general)$/i.test(String(data.detectedQuestion.subject).trim())
                ? data.detectedQuestion.subject
                : undefined;
            const resolvedProfile = resolveSubjectProfile({
                detectedSubject,
                subject: cleanMatchSubject || cleanDetectedSubject || (data.subjectProfile?.key === 'UNIVERSAL_BYOMS' ? data.subjectProfile.displayName : undefined),
                paperCode: (examCode !== 'Unknown' && examCode !== 'Generic Question')
                    ? examCode
                    : (data.examPaperHint || undefined),
                paperTitle: m.paperTitle,
                rawTextHint
            });
            detectedSubject = resolvedProfile.key;

            examInfo = {
                examBoard: m.examBoard || m.board || 'Unknown',
                subject: cleanMatchSubject || resolvedProfile.displayName,
                examCode,
                examSeries: m.examSeries || m.year || 'Unknown',
                tier: m.tier || 'Unknown',
                totalMarks: questions.reduce((sum: number, q: any) => sum + (q.marks || 0), 0)
            };
        } else if (!detectedSubject && (data.examPaperHint || rawTextHint.trim())) {
            const resolvedFromHints = resolveSubjectProfile({
                paperCode: data.examPaperHint || undefined,
                rawTextHint
            });
            if (resolvedFromHints.key !== 'MATHS') {
                detectedSubject = resolvedFromHints.key;
            }
        }

        return {
            sessionType: data.sessionType || 'Question',
            ...(detectedSubject ? { detectedSubject } : {}),
            totalQuestionsMarked: questions.length,
            overallScore: {
                awarded: 0,
                total: examInfo?.totalMarks || 0,
                percentage: 0,
                scoreText: 'N/A'
            },
            examInfo,
            questionResults,
            followUpHistory: []
        };
    }

    /**
     * Resolves the SubjectProfile from a stored MarkingContext (and optional focused question ID).
     * Works for both matched papers (using examInfo) and unmatched Question Mode uploads (using question text/scheme).
     */
    static resolveSubjectProfile(markingContext?: MarkingContext, contextQuestionId?: string | null): SubjectProfile {
        if (!markingContext) {
            return SUBJECT_PROFILES.MATHS;
        }
        const questions = Array.isArray(markingContext.questionResults) ? markingContext.questionResults : [];
        const focusedQuestions = contextQuestionId
            ? questions.filter(q => String(q.number) === String(contextQuestionId))
            : [];
        const sourceQuestions = focusedQuestions.length > 0 ? focusedQuestions : questions;
        const rawTextHint = sourceQuestions
            .map(q => {
                const rubricHint = q.rubricEvaluation
                    ? [
                        q.rubricEvaluation.rubricStamp,
                        ...(q.rubricEvaluation.aoBreakdown || []).map((a: any) => `${a.ao} ${a.levelLabel || ''}`)
                    ].filter(Boolean).join(' ')
                    : '';
                return [q.text, q.extractedQuestionText, q.databaseQuestionText, q.scheme, rubricHint].filter(Boolean).join(' ');
            })
            .join('\n');

        return resolveSubjectProfile({
            detectedSubject: markingContext.detectedSubject,
            subject: markingContext.examInfo?.subject,
            paperCode: markingContext.examInfo?.examCode && markingContext.examInfo.examCode !== 'Unknown'
                ? markingContext.examInfo.examCode
                : undefined,
            rawTextHint
        });
    }

    /**
     * Formats the stored MarkingContext into a prompt string for the AI.
     * This is called for every text-based follow-up message.
     * Now uses clean nested parts[] structure - no parsing needed!
     */
    static formatContextAsPrompt(markingContext: MarkingContext, contextQuestionId?: string | null): string {
        let prompt = '';

        if (markingContext.sessionType === 'Question') {
            prompt += `Here is the Question Mode session context for the student's uploaded question(s):\n\n`;
            prompt += `** Session Type **: Question Mode (No initial student work was marked from the image; the student may ask for explanations, type an answer to be marked, or clarify/dispute a matched question.)\n`;
            if (markingContext.examInfo) {
                const e = markingContext.examInfo;
                const isGenericPlaceholderExam =
                    e.examCode === 'Generic Question' ||
                    (
                        /^(unknown|n\/a)$/i.test(String(e.examSeries || '').trim()) &&
                        /^(unknown|n\/a|generic question)$/i.test(String(e.examCode || '').trim()) &&
                        /^(unknown|n\/a)$/i.test(String(e.examBoard || '').trim())
                    );
                if (!isGenericPlaceholderExam) {
                    prompt += `** Exam **: ${e.examSeries} ${e.examCode} ${e.examBoard} \n`;
                }
                if (e.subject) {
                    prompt += `** Subject **: ${e.subject} \n`;
                }
            }
            prompt += `\n`;
        } else {
            prompt += `Here is the global state of the student's exam:\n\n`;

            // Global Performance
            prompt += `\n** OVERALL PERFORMANCE **\n`;
            prompt += `** Total Score **: ${markingContext.overallScore.scoreText} (${markingContext.overallScore.percentage}%)\n`;
            if (markingContext.grade) {
                prompt += `** Grade Achieved **: ${markingContext.grade.achieved || 'N/A'} \n`;
                if (markingContext.grade.predicted) {
                    prompt += `** Predicted Grade **: ${markingContext.grade.predicted} \n`;
                }
                if (markingContext.grade.boundaries && Object.keys(markingContext.grade.boundaries).length > 0) {
                    prompt += `** Grade Boundaries (${markingContext.grade.boundaryType}) **: \n`;
                    const sortedBoundaries = Object.entries(markingContext.grade.boundaries)
                        .sort((a, b) => parseInt(b[0]) - parseInt(a[0]));
                    for (const [g, mark] of sortedBoundaries) {
                        prompt += `- Grade ${g}: ${mark} marks\n`;
                    }
                }
            }

            if (markingContext.examInfo) {
                const e = markingContext.examInfo;
                const isGenericPlaceholderExam =
                    e.examCode === 'Generic Question' ||
                    (
                        /^(unknown|n\/a)$/i.test(String(e.examSeries || '').trim()) &&
                        /^(unknown|n\/a|generic question)$/i.test(String(e.examCode || '').trim()) &&
                        /^(unknown|n\/a)$/i.test(String(e.examBoard || '').trim())
                    );
                if (!isGenericPlaceholderExam) {
                    // Unify with Sidebar format: Series Code Board
                    prompt += `** Exam **: ${e.examSeries} ${e.examCode} ${e.examBoard} \n`;
                } else if (e.subject) {
                    prompt += `** Subject **: ${e.subject} \n`;
                }
            }

            if (markingContext.grade) {
                prompt += `** Grade Achieved **: ${markingContext.grade.achieved} \n`;
            }

            // Add Universal Score Breakdown Map
            prompt += `\n## Score Breakdown Map\n`;
            for (const q of markingContext.questionResults) {
                prompt += `- Question ${q.number}: ${q.earnedMarks}/${q.totalMarks} marks\n`;
            }
            prompt += `\n`;
        }

        // 2. Question Details - iterate parts[] directly
        let questionsToInclude = markingContext.questionResults;

        // Filter to specific question if context is active
        if (contextQuestionId) {
            questionsToInclude = markingContext.questionResults.filter(q => String(q.number) === String(contextQuestionId));
            if (questionsToInclude.length > 0) {
                prompt += `## Deep Focus: Question ${contextQuestionId}\n`;
                prompt += `The user is currently viewing Question ${contextQuestionId}. Here are the deep details for this specific question:\n\n`;
            } else {
                // Fallback to all if not found
                questionsToInclude = markingContext.questionResults;
                prompt += `## Detailed Question Results\n\n`;
            }
        } else {
            prompt += `## Detailed Question Results\n\n`;
        }

        const formatPartLabel = (qNum: string, pNum: string) => pNum.toLowerCase().startsWith(qNum.toLowerCase()) ? pNum : `${qNum}${pNum}`;

        for (const q of questionsToInclude) {
            prompt += `### Question ${q.number}: ${q.text} \n`;
            if (q.extractedQuestionText && q.extractedQuestionText.trim() !== q.text.trim()) {
                prompt += `** Uploaded Question Text (Extracted from Student Image) **:\n${q.extractedQuestionText}\n`;
            }

            if (markingContext.sessionType === 'Question') {
                // QUESTION MODE: Show Scheme/Solution only
                if (q.totalMarks > 0) {
                    prompt += `** Maximum Marks **: ${q.totalMarks}\n`;
                }
                if (q.scheme) {
                    prompt += `** Reference Solution / Marking Scheme **: \n${q.scheme} \n`;
                } else {
                    prompt += `(No specific marking scheme available)\n`;
                }
            } else {
                // MARKING MODE: Show Student Work + Marks + Scheme
                prompt += `** Your Answer **:\n`;
                const rawFullTranscript = (q as any).studentWork
                    ? String((q as any).studentWork)
                        .split('\n')
                        .map((l: string) => l.replace(/\[ID:[^\]]+\]\s*/g, '').trim())
                        .filter((l: string) => l && !/^student'?s?\s*work:?$/i.test(l))
                        .join('\n')
                    : '';
                if (rawFullTranscript) {
                    prompt += `${rawFullTranscript}\n`;
                } else {
                    q.parts.forEach(part => {
                        // Display each mark's work
                        part.marks.forEach(mark => {
                            if (mark.work) {
                                if (part.part) {
                                    prompt += `[${formatPartLabel(q.number, part.part)}] ${mark.work}\n`;
                                } else {
                                    prompt += `${mark.work}\n`;
                                }
                            }
                        });
                    });
                }

                prompt += `** Your Marks ** (Total: ${q.earnedMarks}/${q.totalMarks}):\n`;

                // Show marks grouped by part
                q.parts.forEach(part => {
                    if (part.part) {
                        // Sub-question marks
                        prompt += `[${formatPartLabel(q.number, part.part)}]\n`;
                    }
                    part.marks.forEach(m => {
                        const cleanReasoning = m.reasoning ? m.reasoning.replace(/\|/g, '. ').replace(/\.\s*\./g, '.').trim() : '';
                        prompt += `  - [${m.icon}] ${m.code} ${cleanReasoning ? `(${cleanReasoning})` : ''}\n`;
                    });
                });

                // Show Level-of-Response Rubric Evaluation & 3-Part Coaching Block if present
                if (q.rubricEvaluation) {
                    const r = q.rubricEvaluation;
                    prompt += `\n** Level-of-Response Rubric Evaluation **:\n`;
                    if (r.rubricStamp) prompt += `- Rubric Stamp: ${r.rubricStamp}\n`;
                    if (Array.isArray(r.aoBreakdown) && r.aoBreakdown.length > 0) {
                        for (const ao of r.aoBreakdown) {
                            prompt += `- ${ao.ao} (${ao.skill || ''}): Level ${ao.level} (${ao.levelLabel || ''}) — ${ao.awardedMarks}/${ao.maxMarks} marks\n`;
                        }
                    }
                    if (r.coaching) {
                        if (r.coaching.rationale) prompt += `- Why This Level Was Awarded: ${r.coaching.rationale}\n`;
                        if (r.coaching.nextLevelGap) prompt += `- How to Reach the Next Level: ${r.coaching.nextLevelGap}\n`;
                        if (r.coaching.upgradeRewrite?.originalQuote && r.coaching.upgradeRewrite?.upgradedVersion) {
                            prompt += `- Concrete Upgrade Rewrite:\n  * Student Original: "${r.coaching.upgradeRewrite.originalQuote}"\n  * Upgraded Version: "${r.coaching.upgradeRewrite.upgradedVersion}"\n`;
                        }
                    }
                }

                // Show marking scheme
                if (q.scheme) {
                    prompt += `** Marking criteria **: \n${q.scheme} \n`;
                    prompt += `> [!IMPORTANT]\n> STRICTLY follow the provided marking criteria above. Do not deviate. \n`;
                }
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

        // Start your response naturally.

        // The following block seems to be intended for a different context where 'messages' and 'chatContext' are available.
        // As they are not defined in this function, this block will be commented out to avoid errors,
        // or if the user intends to add these variables, they should be defined.
        /*
        if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            const lastUserMessage = messages[messages.length - 1].content;
            // console.log(`\n🔍 [DEBUG CONTEXT CHAT PROMPT]`);
            // console.log(`   - Message: "${lastUserMessage}"`);
            // console.log(`   - Context Length: ${chatContext.length} chars`);
        }
        */
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
