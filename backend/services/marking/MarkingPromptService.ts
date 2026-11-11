import { normalizeLatexDelimiters, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';
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
     * Formats official chief examiner reports into clean, human-readable plain text/markdown.
     * Replaces raw JSON.stringify with structured sections and bullet points.
     */
    public static formatExaminerReport(report: any): string {
        if (!report) return '';
        if (typeof report === 'string') return report.trim();
        if (typeof report !== 'object') return String(report);

        const lines: string[] = [];

        // Question header if present
        const qNum = report.questionNumber;
        const maxM = report.maxMarks;
        const aos = Array.isArray(report.assessmentObjectives) ? report.assessmentObjectives.join(', ') : report.assessmentObjectives;
        if (qNum || maxM || aos) {
            const metaParts: string[] = [];
            if (maxM) metaParts.push(`Max Marks: ${maxM}`);
            if (aos) metaParts.push(`AOs: ${aos}`);
            const metaStr = metaParts.length > 0 ? ` (${metaParts.join(' | ')})` : '';
            if (qNum) {
                lines.push(`### Question ${qNum} Insights${metaStr}`);
            }
        }

        // What Worked Well
        if (report.whatWorkedWell) {
            lines.push(`- **What Worked Well**:`);
            if (Array.isArray(report.whatWorkedWell)) {
                report.whatWorkedWell.forEach((item: any) => lines.push(`  * ${String(item).trim()}`));
            } else {
                lines.push(`  ${String(report.whatWorkedWell).trim()}`);
            }
        }

        // Common Pitfalls
        if (report.commonPitfalls) {
            lines.push(`- **Common Pitfalls**:`);
            if (Array.isArray(report.commonPitfalls)) {
                report.commonPitfalls.forEach((item: any) => lines.push(`  * ${String(item).trim()}`));
            } else {
                lines.push(`  ${String(report.commonPitfalls).trim()}`);
            }
        }

        // Level Separators
        const separators = report.level3To4Separators || report.levelSeparators || report.whatSeparatesLevels;
        if (separators) {
            const title = report.level3To4Separators ? 'Level 3 to Level 4 Separators' : 'Level Separators / Key Distinctions';
            lines.push(`- **${title}**:`);
            if (Array.isArray(separators)) {
                separators.forEach((item: any) => lines.push(`  * ${String(item).trim()}`));
            } else {
                lines.push(`  ${String(separators).trim()}`);
            }
        }

        // Generic fallback for other fields
        const knownKeys = new Set([
            'questionNumber', 'maxMarks', 'assessmentObjectives',
            'whatWorkedWell', 'commonPitfalls',
            'level3To4Separators', 'levelSeparators', 'whatSeparatesLevels'
        ]);
        for (const [key, value] of Object.entries(report)) {
            if (!knownKeys.has(key) && value) {
                const formattedKey = key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/^./, str => str.toUpperCase())
                    .trim();
                if (Array.isArray(value)) {
                    lines.push(`- **${formattedKey}**:`);
                    value.forEach((item: any) => lines.push(`  * ${String(item).trim()}`));
                } else if (typeof value === 'string' || typeof value === 'number') {
                    lines.push(`- **${formattedKey}**: ${String(value).trim()}`);
                }
            }
        }

        return lines.join('\n').trim();
    }

    /**
     * Formats the marking scheme into a concise text-based format for the AI prompt.
     * Expects the scheme to be already normalized and expanded (e.g. by MarkingInstructionService).
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
        const anyScheme = normalizedScheme as any;
        const subMetaMap = anyScheme.subQuestionMetadata || {};
        const subGuidanceMap = anyScheme.subQuestionGuidanceMap || {};
        const hasSubQuestions = normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0;

        const formatMarkLine = (m: any): string => {
            const notes = [m.comments, m.guidance]
                .filter((c: any) => typeof c === 'string' && c.trim() !== '' && c.trim() !== 'Auto-balanced')
                .join(' | ');
            return notes
                ? `- ${m.mark}: ${m.answer} [Examiner Notes: ${notes}]\n`
                : `- ${m.mark}: ${m.answer}\n`;
        };

        const formatGuidanceBlock = (guidanceList?: any[]): string => {
            if (!Array.isArray(guidanceList) || guidanceList.length === 0) return '';
            const lines = guidanceList
                .map((g: any) => {
                    if (typeof g === 'string') return g.trim();
                    if (g && typeof g === 'object' && g.scenario) {
                        const scenario = String(g.scenario).trim();
                        const outcome = g.outcome ? String(g.outcome).trim() : '';
                        return outcome ? `${scenario} -> ${outcome}` : scenario;
                    }
                    return '';
                })
                .filter((line: string) => line !== '');
            if (lines.length === 0) return '';
            return `  [Additional Examiner Guidance]:\n` + lines.map(l => `  * ${l}`).join('\n') + '\n';
        };

        const formatLevelsAndIndicative = (levels?: any[], indicativeContent?: any[]): string => {
            let block = '';
            if (Array.isArray(levels) && levels.length > 0) {
                block += `  [LEVEL DESCRIPTORS]\n`;
                levels.forEach((lvl: any) => {
                    const label = lvl.level !== undefined ? `Level ${lvl.level}` : (lvl.label || 'Band');
                    const range = lvl.minMarks !== undefined && lvl.maxMarks !== undefined
                        ? (lvl.minMarks === lvl.maxMarks ? `${lvl.minMarks}` : `${lvl.minMarks}–${lvl.maxMarks}`)
                        : (Array.isArray(lvl.markRange) ? `${lvl.markRange[0]}–${lvl.markRange[1]}` : (lvl.markRange || lvl.marks || ''));
                    const descList = Array.isArray(lvl.descriptors)
                        ? lvl.descriptors
                        : (Array.isArray(lvl.skillsDescriptors) ? lvl.skillsDescriptors : []);
                    const desc = descList.length > 0
                        ? descList.join('; ')
                        : (lvl.descriptor || lvl.description || (lvl.label && lvl.label !== label ? lvl.label : ''));
                    block += `  * ${label}${range ? ` (${range} marks)` : ''}: ${desc}\n`;
                });
            }
            if (Array.isArray(indicativeContent) && indicativeContent.length > 0) {
                block += `  [INDICATIVE CONTENT]\n`;
                indicativeContent.forEach((pt: any) => {
                    block += `  * ${typeof pt === 'string' ? pt : JSON.stringify(pt)}\n`;
                });
            }
            return block;
        };

        if (hasSubQuestions) {
            const cleanSubKey = (k: string) => String(k || '').trim().replace(/^0+(?=\d)/, '');
            const subQuestions = Object.keys(normalizedScheme.subQuestionMarks!).sort((a, b) =>
                cleanSubKey(a).localeCompare(cleanSubKey(b), undefined, { numeric: true, sensitivity: 'base' })
            );
            for (const subQ of subQuestions) {
                const displaySubQ = cleanSubKey(subQ);
                const rawSubEntry = normalizedScheme.subQuestionMarks![subQ] as any;
                let marks = rawSubEntry;
                if (!Array.isArray(marks) && marks?.marks) marks = marks.marks;

                const subLabel = displaySubQ.replace(/^\d+/, '');
                const normalizedSubLabel = normalizeSubQuestionPart(subLabel);

                const maxScore = (normalizedScheme.subQuestionMaxScores ?
                    (normalizedScheme.subQuestionMaxScores[subQ] ??
                        normalizedScheme.subQuestionMaxScores[displaySubQ] ??
                        normalizedScheme.subQuestionMaxScores[subLabel] ??
                        normalizedScheme.subQuestionMaxScores[normalizedSubLabel]) : undefined)
                    || normalizedScheme.totalMarks || normalizedScheme.parentQuestionMarks;

                const subMeta = subMetaMap[subQ] || subMetaMap[displaySubQ] || subMetaMap[subLabel] || {};
                const subGuidance =
                    subGuidanceMap[subQ] ||
                    subGuidanceMap[displaySubQ] ||
                    subGuidanceMap[subLabel] ||
                    (!Array.isArray(rawSubEntry) && rawSubEntry?.guidance ? rawSubEntry.guidance : undefined) ||
                    subMeta.guidance;

                output += `[${displaySubQ}]`;
                if (maxScore) output += ` [MAX SCORE: ${maxScore}]`;
                if (subMeta.paradigm) output += ` [PARADIGM: ${subMeta.paradigm}]`;
                output += '\n';

                if (subMeta.levels || subMeta.indicativeContent) {
                    output += formatLevelsAndIndicative(subMeta.levels, subMeta.indicativeContent);
                }

                if (Array.isArray(marks)) {
                    marks.forEach((m: any) => {
                        output += formatMarkLine(m);
                    });
                }

                if (subGuidance) {
                    output += formatGuidanceBlock(subGuidance);
                }

                output += '\n';
            }
        } else {
            output += `[${normalizedScheme.questionNumber}]`;
            if (normalizedScheme.totalMarks) output += ` [MAX SCORE: ${normalizedScheme.totalMarks}]`;
            output += '\n';

            if (anyScheme.levels || anyScheme.indicativeContent) {
                output += formatLevelsAndIndicative(anyScheme.levels, anyScheme.indicativeContent);
            }

            normalizedScheme.marks.forEach((m: any) => {
                output += formatMarkLine(m);
            });

            if (anyScheme.guidance) {
                output += formatGuidanceBlock(anyScheme.guidance);
            }
        }

        if (normalizedScheme.questionLevelAnswer) {
            output += `\nFINAL ANSWER: ${normalizedScheme.questionLevelAnswer}\n`;
        }

        // Check if this scheme contains Method (M) or Process (P) marks
        const hasProcessOrMethodMarks =
            normalizedScheme.marks.some((m: any) => /^[MP]\d+/i.test(String(m.mark || ''))) ||
            (normalizedScheme.subQuestionMarks &&
                Object.values(normalizedScheme.subQuestionMarks).some((sub: any) => {
                    const arr = Array.isArray(sub) ? sub : sub?.marks;
                    return Array.isArray(arr) && arr.some((m: any) => /^[MP]\d+/i.test(String(m.mark || '')));
                }));

        const mathProcessRules = hasProcessOrMethodMarks
            ? `
> 3. **INDEPENDENT PROCESS/METHOD MARKS & UNROUNDED ESTIMATION FALLBACK**:
>    - Process (\`P\`) and Method (\`M\`) marks are **INDEPENDENT** unless explicitly marked \`dep\`.
>    - In estimation questions, if a student fails to round (earning \`P0\`/\`M0\` on the rounding mark), still award subsequent \`P1\`/\`M1\` process marks if they write a valid full calculation method using the **exact/unrounded values from the question**, even if \`[Examiner Notes]\` only lists rounded examples and even if their final arithmetic has a slip. Only \`A1\` is forfeited (\`A0\`).
> 4. **EQUIVALENT FORMS (\`oe\`) & PRE-COMPUTED INTERMEDIATE STEPS**:
>    - \`eg\` indicates illustrative examples (not exhaustive) and \`oe\` means "or equivalent". Always accept mathematically equivalent expressions where an intermediate step has already been evaluated mentally or in rough work.`
            : '';

        return `
> [INSTRUCTION]: You are the CHIEF EXAMINER.
> 1. **MATCH**: Match the student's work strictly to the mark definitions below.
> 2. **STRICT SILO RULE (CRITICAL)**:
>    - You MUST respect the [MAX SCORE] for each sub-question.
>    - **OVERFLOW CHECK:** If you find 4 valid marks, but [6a] only allows 2, you MUST check if the other 2 marks belong to [6b].
>    - **DO NOT** lump all marks into the first bucket. Distribute them based on which sub-question they answer.${mathProcessRules}

[OFFICIAL SCHEME]
${output.trim()}
`.trim();
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
