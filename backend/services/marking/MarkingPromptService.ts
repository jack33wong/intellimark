import { normalizeLatexDelimiters } from '../../utils/TextNormalizationUtils.js';
import type { NormalizedMarkingScheme } from '../../types/marking.js';

/**
 * Service dedicated to constructing prompts for the AI marking process.
 */
export class MarkingPromptService {
    /**
     * Formats general marking guidance into a markdown block.
     */
    public static formatGeneralMarkingGuidance(guidance: any): string {
        if (!guidance) return '';
        if (typeof guidance === 'string') return guidance;

        let formatted = '## GENERAL MARKING GUIDANCE\n';
        if (Array.isArray(guidance)) {
            guidance.forEach(item => {
                if (typeof item === 'string') {
                    formatted += `- ${item}\n`;
                } else if (item.scenario) {
                    formatted += `- ${item.scenario}${item.outcome ? `: ${item.outcome}` : ''}\n`;
                }
            });
        } else if (typeof guidance === 'object') {
            Object.entries(guidance).forEach(([key, value]) => {
                formatted += `- **${key}**: ${value}\n`;
            });
        }

        formatted += '\n';
        return formatted;
    }

    /**
     * Mutates the normalizedScheme in-place to replace 'cao' with actual answers.
     */
    public static replaceCaoInScheme(normalizedScheme: NormalizedMarkingScheme): void {
        if (!normalizedScheme.marks || normalizedScheme.marks.length === 0) {
            if (!normalizedScheme.subQuestionMarks) return;
        }

        if (normalizedScheme.marks) {
            normalizedScheme.marks.forEach((mark: any) => {
                if (typeof mark.answer === 'string' && mark.answer.toLowerCase() === 'cao') {
                    mark.answer = this.resolveCao(mark.answer, normalizedScheme);
                }
            });
        }

        if (normalizedScheme.subQuestionMarks) {
            Object.keys(normalizedScheme.subQuestionMarks).forEach(key => {
                const marks = normalizedScheme.subQuestionMarks[key];
                if (Array.isArray(marks)) {
                    marks.forEach((mark: any) => {
                        if (typeof mark.answer === 'string' && mark.answer.toLowerCase() === 'cao') {
                            mark.answer = this.resolveCao(mark.answer, normalizedScheme, key);
                        }
                    });
                }
            });
        }
    }

    private static resolveCao(markText: string, normalizedScheme: NormalizedMarkingScheme, subKey?: string): string {
        if (!markText || markText.toLowerCase() !== 'cao') return markText;
        if (subKey && normalizedScheme.subQuestionAnswersMap && normalizedScheme.subQuestionAnswersMap[subKey]) {
            return normalizedScheme.subQuestionAnswersMap[subKey];
        }
        if (normalizedScheme.questionLevelAnswer) {
            return normalizedScheme.questionLevelAnswer;
        }
        return markText;
    }

    /**
     * Formats the marking scheme into a concise text-based format for the AI prompt.
     */
    public static formatMarkingSchemeForPrompt(normalizedScheme: NormalizedMarkingScheme): string {
        const hasGenericSignature = normalizedScheme.marks.some((m: any) =>
            String(m.answer).includes("undefined") || (m.mark && m.mark.startsWith('M') && !m.answer)
        );

        if (normalizedScheme.isGeneric || hasGenericSignature) {
            let genericHeader = `\n[GENERIC_GCSE_LOGIC]`;
            if (normalizedScheme.totalMarks) genericHeader += ` [MAX SCORE: ${normalizedScheme.totalMarks}]`;

            return `
${genericHeader}
> [INSTRUCTION]: You are the CHIEF EXAMINER.
> 1. **GET BUDGET**: Search for "(Total X marks)".
> 2. **SOLVE & MARK**: Award marks for valid steps.
> 3. **CUT (Guillotine)**: Do not exceed the budget.
`;
        }

        let output = '';
        const hasSubQuestions = normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0;

        if (hasSubQuestions) {
            const subQuestions = Object.keys(normalizedScheme.subQuestionMarks!).sort();
            for (const subQ of subQuestions) {
                let marks = normalizedScheme.subQuestionMarks![subQ];
                if (!Array.isArray(marks) && (marks as any).marks) marks = (marks as any).marks;

                const subLabel = subQ.replace(/^\d+/, '');
                const maxScore = normalizedScheme.subQuestionMaxScores ?
                    (normalizedScheme.subQuestionMaxScores[subQ] ?? normalizedScheme.subQuestionMaxScores[subLabel]) : undefined;

                output += `[${subQ}]`;
                if (maxScore !== undefined) output += ` [MAX SCORE: ${maxScore}]`;
                output += '\n';

                const expandedMarks: any[] = [];
                if (Array.isArray(marks)) {
                    marks.forEach((m: any) => {
                        const atomics = this.extractAtomicMarks(m);
                        expandedMarks.push(...atomics);
                    });
                }

                expandedMarks.forEach((m: any) => {
                    output += `- ${m.mark}: ${m.answer}\n`;
                });
                output += '\n';
            }
        } else {
            output += `[${normalizedScheme.questionNumber}]`;
            if (normalizedScheme.totalMarks) output += ` [MAX SCORE: ${normalizedScheme.totalMarks}]`;
            output += '\n';

            const expandedMarks: any[] = [];
            normalizedScheme.marks.forEach((m: any) => {
                const atomics = this.extractAtomicMarks(m);
                expandedMarks.push(...atomics);
            });

            expandedMarks.forEach((m: any) => {
                output += `- ${m.mark}: ${m.answer}\n`;
            });
        }

        if (normalizedScheme.questionLevelAnswer) {
            output += `\nFINAL ANSWER: ${normalizedScheme.questionLevelAnswer}\n`;
        }

        return `
> [INSTRUCTION]: You are the CHIEF EXAMINER.
> 1. **MATCH**: Match the student's work strictly to the M1/A1/B1 definitions below.
> 2. **STRICT SILO RULE (CRITICAL)**:
>    - You MUST respect the [MAX SCORE] for each sub-question.
>    - **OVERFLOW CHECK:** If you find 4 valid marks, but [6a] only allows 2, you MUST check if the other 2 marks belong to [6b].
>    - **DO NOT** lump all marks into the first bucket. Distribute them based on which sub-question they answer.

[OFFICIAL SCHEME]
${output.trim()}
`.trim();
    }

    private static extractAtomicMarks(markObj: any): any[] {
        const mark = String(markObj.mark || '');
        const isNumeric = /^\d+$/.test(mark);
        const comments = String(markObj.comments || '');
        const hasAtomicCodes = /([BMA][1-9]|SC[1-9])\s+for/i.test(comments);

        if (!isNumeric || !hasAtomicCodes) return [markObj];

        const results: any[] = [];
        const regex = /([BMA][1-9]|SC[1-9])\s*for\s*((?:(?![BMA][1-9]\s*for|SC[1-9]\s*for|Listing:|Ratios:|Alternative|Fractions).|[\n\r])*)/gi;
        let match;
        while ((match = regex.exec(comments)) !== null) {
            const markCode = match[1].toUpperCase();
            results.push({
                mark: markCode,
                value: parseInt(markCode.substring(1)) || 1,
                answer: match[2].trim().replace(/\n+/g, ' '),
                comments: ''
            });
        }

        const numericTargetMark = parseInt(mark) || 0;
        const currentExtractedTotal = results.reduce((sum, r) => sum + (r.value || 1), 0);
        if (numericTargetMark > currentExtractedTotal) {
            results.push({
                mark: `A${numericTargetMark - currentExtractedTotal}`,
                value: numericTargetMark - currentExtractedTotal,
                answer: markObj.answer || 'Correct solution.',
                comments: '(Auto-balanced)'
            });
        }
        return results.length > 0 ? results : [markObj];
    }

    /**
     * Formats the OCR text for the user prompt.
     */
    public static formatOcrTextForPrompt(ocrText: string): string {
        if (!ocrText) return '';
        let formattedOcrText = ocrText;
        try {
            const parsed = JSON.parse(ocrText);
            if (Array.isArray(parsed)) {
                formattedOcrText = parsed.map((block: any) => {
                    const text = block.text || '';
                    const page = block.pageIndex !== undefined ? `[Page ${block.pageIndex}] ` : '';
                    return `${page}${text}`;
                }).join('\n');
            } else if (parsed.blocks) {
                formattedOcrText = parsed.blocks.map((block: any) => {
                    const text = block.text || '';
                    const page = block.pageIndex !== undefined ? `[Page ${block.pageIndex}] ` : '';
                    return `${page}${text}`;
                }).join('\n');
            } else if (parsed.question && parsed.steps) {
                formattedOcrText = `Question: ${parsed.question}\n\nStudent's Work:\n${parsed.steps.map((step: any, index: number) => {
                    const normalizedText = normalizeLatexDelimiters(step.cleanedText || step.text || '');
                    const simplifiedStepId = `line_${index + 1}`;
                    return `${index + 1}. [${simplifiedStepId}] ${normalizedText}`;
                }).join('\n')}`;
            }
        } catch (error) {
            formattedOcrText = normalizeLatexDelimiters(ocrText);
        }
        return formattedOcrText;
    }

    /**
     * Logs the full prompt to the terminal in a formatted way.
     */
    public static logFullPrompt(questionNumber: string, systemPrompt: string, userPrompt: string): void {
        const BLUE = '\x1b[34m';
        const BOLD = '\x1b[1m';
        const RESET = '\x1b[0m';
        const CYAN = '\x1b[36m';

        console.log(`\n${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
        console.log(`${BOLD}${BLUE}[AI MARKING] Q${questionNumber}${RESET}`);
        console.log(`${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
        console.log(`${BOLD}${BLUE}------------------------------------------------------------${RESET}`);

        const userPromptSections = userPrompt.split(/\n(?=# )/);
        userPromptSections.forEach(section => {
            if (section.trim().startsWith('# MARKING TASK')) {
                console.log(`${BOLD}${CYAN}${section.trim()}${RESET}`);
            } else if (section.trim().startsWith('## MARKING SCHEME')) {
                const lines = section.trim().split('\n');
                console.log(`${BOLD}${CYAN}${lines[0]}${RESET}`);
                console.log(lines.slice(1).join('\n'));
            } else if (section.trim().startsWith('## STUDENT WORK')) {
                console.log(`${BOLD}${CYAN}${section.trim()}${RESET}`);
            } else if (section.trim().startsWith('## RAW OCR BLOCKS')) {
                const lines = section.trim().split('\n');
                console.log(`${BOLD}${CYAN}${lines[0]}${RESET}`);
                console.log(lines.slice(1).join('\n'));
            } else {
                console.log(section.trim());
            }
        });

        console.log(`${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
    }
}
