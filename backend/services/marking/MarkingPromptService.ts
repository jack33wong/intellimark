import { normalizeLatexDelimiters, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';
import type { NormalizedMarkingScheme } from '../../types/marking.js';
import type { SubjectFamily } from '../../config/subjectProfiles.js';

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
    public static formatMarkingSchemeForPrompt(
        normalizedScheme: NormalizedMarkingScheme,
        options?: { subjectFamily?: SubjectFamily }
    ): string {
        const hasGenericSignature = normalizedScheme.marks.some((m: any) =>
            String(m.answer).includes("undefined") || (m.mark && m.mark.startsWith('M') && !m.answer)
        );

        if (normalizedScheme.isGeneric || hasGenericSignature) {
            let genericHeader = `\n[GENERIC_GCSE_LOGIC]`;
            if (normalizedScheme.totalMarks && !(normalizedScheme as any).hasIncompleteSubQuestionBudgets) {
                genericHeader += ` [MAX SCORE: ${normalizedScheme.totalMarks}]`;
            }

            let subQBreakdown = '';
            const cleanSubKey = (k: string) => String(k || '').trim().replace(/^0+(?=\d)/, '');
            const subList = Array.isArray(normalizedScheme.subQuestionNumbers) && normalizedScheme.subQuestionNumbers.length > 0
                ? normalizedScheme.subQuestionNumbers
                    .map(cleanSubKey)
                    .filter(k => k && k !== String(normalizedScheme.questionNumber))
                : Object.keys(normalizedScheme.subQuestionMarks || {})
                    .map(cleanSubKey)
                    .filter(k => k && k !== String(normalizedScheme.questionNumber));

            const uniqueSubs = Array.from(new Set(subList)).sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
            );

            if (uniqueSubs.length > 0) {
                subQBreakdown = '\n[SUB-QUESTION BUDGETS]\n' + uniqueSubs.map(sq => {
                    const suffix = sq.replace(/^\d+/, '');
                    const dotStripped = suffix.replace(/^\./, '');
                    const maxS = normalizedScheme.subQuestionMaxScores?.[sq] ??
                        normalizedScheme.subQuestionMaxScores?.[suffix] ??
                        normalizedScheme.subQuestionMaxScores?.[dotStripped];
                    return maxS && maxS > 0
                        ? `[${sq}] [MAX SCORE: ${maxS}]`
                        : `[${sq}] — Read "[ X marks ]" from RAW OCR BLOCKS / image.`;
                }).join('\n') + '\n';
            }

            return `
${genericHeader}
> [INSTRUCTION]: CHIEF EXAMINER — Generic Rubric Mode (no official scheme attached).
> 1. **MARK EVERY SUB-QUESTION**: Output \`B1\`/\`M1\`/\`A1\` or \`B0\`/\`M0\`/\`A0\` for EVERY attempted sub-question below. Never skip a part.
> 2. **RESPECT BUDGETS & MATCH TICK COUNT**: Do not exceed \`[MAX SCORE]\` (or printed \`[ X marks ]\`). If a part is worth N marks and earns full marks, emit N one-mark ticks (e.g. M1, M1, A1) across working lines.
> 3. **FINAL-LINE CROSS & CONCISE REASONING**: Anchor a single \`B0\`/\`A0\` cross on the final line of that part. Keep \`reasoning\` ≤ 8 words (≤ 55 chars), without duplicating \`; ans: <value>\` if already stated.
> 4. **SOLVE INDEPENDENTLY FIRST (NO CONFIRMATION BIAS)**: For MCQs, evaluate ALL options (A–D) against every physical/factual constraint in the question stem before checking the student's choice. For labelled diagrams, trace the exact start and end points of each handwritten bracket/arrow directly on the image (e.g. central rest axis to crest vs peak-to-peak) before judging it wrong.
${subQBreakdown}`;
        }

        let output = '';
        const anyScheme = normalizedScheme as any;
        const subMetaMap = anyScheme.subQuestionMetadata || {};
        const subGuidanceMap = anyScheme.subQuestionGuidanceMap || {};
        const hasSubQuestions = normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0;

        const subjectFamily = options?.subjectFamily;
        const isHumanitiesOrEnglish = subjectFamily === 'HUMANITIES_ESSAY' || subjectFamily === 'ENGLISH_WRITING';

        const formatMarkLine = (m: any): string => {
            const notes = [m.comments, m.guidance]
                .filter((c: any) => typeof c === 'string' && c.trim() !== '' && c.trim() !== 'Auto-balanced')
                .join(' | ');
            let markLabel = String(m.mark || '').trim();
            // Never leak synthetic Maths "B1"/"B2" codes on Humanities/English schemes when AO or plain marks apply
            if (isHumanitiesOrEnglish && /^B(\d+)$/i.test(markLabel)) {
                const weight = parseInt(markLabel.slice(1), 10) || 1;
                const aoMatch = notes.match(/\bTarget:\s*(AO\d+(?::\d+)?)/i) || notes.match(/\b(AO\d+(?::\d+)?)\b/i);
                if (aoMatch) {
                    markLabel = weight > 1 ? `${aoMatch[1]} (${weight} marks)` : aoMatch[1];
                } else {
                    markLabel = weight === 1 ? '1 mark' : `${weight} marks`;
                }
            }
            const prefix = markLabel ? `- ${markLabel}: ` : '- ';
            return notes
                ? `${prefix}${m.answer} [Examiner Notes: ${notes}]\n`
                : `${prefix}${m.answer}\n`;
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

        const formatSpagRubric = (spagMax: number): string => {
            let block = `  [SPaG RUBRIC (Separate ${spagMax} marks)]\n`;
            if (spagMax === 3) {
                block += `  * High performance (2-3 marks): Spell and punctuate with consistent accuracy; use rules of grammar with effective control of meaning; use a wide range of specialist terms as appropriate.\n`;
                block += `  * Intermediate performance (1-2 marks): Spell and punctuate with considerable accuracy; use rules of grammar with general control of meaning; use a good range of specialist terms.\n`;
                block += `  * Threshold performance (1 mark): Spell and punctuate with reasonable accuracy; use rules of grammar with some control of meaning; use a limited range of specialist terms.\n`;
                block += `  * 0 marks: Nothing worthy of credit or does not reach threshold standard.\n`;
            } else if (spagMax === 4) {
                block += `  * High performance (4 marks): Spell and punctuate with consistent accuracy; use rules of grammar with effective control of meaning; use a wide range of specialist terms as appropriate.\n`;
                block += `  * Intermediate performance (2-3 marks): Spell and punctuate with considerable accuracy; use rules of grammar with general control of meaning; use a good range of specialist terms.\n`;
                block += `  * Threshold performance (1 mark): Spell and punctuate with reasonable accuracy; use rules of grammar with some control of meaning; use a limited range of specialist terms.\n`;
                block += `  * 0 marks: Nothing worthy of credit or does not reach threshold standard.\n`;
            } else {
                block += `  * Award 0-${spagMax} marks separately for spelling, punctuation, grammar, and accurate use of specialist terminology.\n`;
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
                const spagMax = Number(subMeta.spagMaxMarks || (!Array.isArray(rawSubEntry) ? rawSubEntry?.spagMaxMarks : 0) || 0);
                const contentMax = Number(subMeta.contentMaxMarks || (!Array.isArray(rawSubEntry) ? rawSubEntry?.contentMaxMarks : 0) || 0);
                if (maxScore && spagMax > 0 && contentMax > 0) {
                    output += ` [MAX SCORE: ${maxScore} (Content: ${contentMax} + SPaG: ${spagMax})]`;
                } else if (maxScore) {
                    output += ` [MAX SCORE: ${maxScore}]`;
                }
                if (subMeta.paradigm) output += ` [PARADIGM: ${subMeta.paradigm}]`;
                output += '\n';

                const hasLevels = Array.isArray(subMeta.levels) && subMeta.levels.length > 0;
                if (hasLevels || subMeta.indicativeContent) {
                    output += formatLevelsAndIndicative(subMeta.levels, subMeta.indicativeContent);
                }

                if (spagMax > 0) {
                    output += formatSpagRubric(spagMax);
                }

                if (Array.isArray(marks) && !hasLevels) {
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
            const standaloneSpagMax = Number(anyScheme.spagMaxMarks || 0);
            const standaloneContentMax = Number(anyScheme.contentMaxMarks || 0);
            output += `[${normalizedScheme.questionNumber}]`;
            if (normalizedScheme.totalMarks && standaloneSpagMax > 0 && standaloneContentMax > 0) {
                output += ` [MAX SCORE: ${normalizedScheme.totalMarks} (Content: ${standaloneContentMax} + SPaG: ${standaloneSpagMax})]`;
            } else if (normalizedScheme.totalMarks) {
                output += ` [MAX SCORE: ${normalizedScheme.totalMarks}]`;
            }
            if (anyScheme.paradigm) output += ` [PARADIGM: ${anyScheme.paradigm}]`;
            output += '\n';

            const hasStandaloneLevels = Array.isArray(anyScheme.levels) && anyScheme.levels.length > 0;
            if (hasStandaloneLevels || anyScheme.indicativeContent) {
                output += formatLevelsAndIndicative(anyScheme.levels, anyScheme.indicativeContent);
            }

            if (standaloneSpagMax > 0) {
                output += formatSpagRubric(standaloneSpagMax);
            }

            if (!hasStandaloneLevels) {
                normalizedScheme.marks.forEach((m: any) => {
                    output += formatMarkLine(m);
                });
            }

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

        const tieBreakerRuleNum = hasProcessOrMethodMarks ? 5 : 3;

        const tieBreakerRules = isHumanitiesOrEnglish
            ? `> ${tieBreakerRuleNum}. **HUMANITIES & ESSAY EXAMINER TIE-BREAKER RULES**:
>    - **PROMPT ALIGNMENT & CONTRADICTIONS**: Check whether the student's opening/thesis actually matches the question prompt (flag any self-contradiction such as saying "disagree" while arguing in favour).
>    - **LEVEL-OF-RESPONSE ANTI-INFLATION**: Do NOT award Upper Top-Band marks (e.g. 11–12/12) merely because both sides, a quotation, and a conclusion are present. Top-band marks require sustained evaluation, accurate subject terminology, and a **comparative, justified judgement** (not a generic "all views are important" conclusion).
>    - **SEPARATE SPaG / AUXILIARY MARKS**: When \`[SPaG RUBRIC]\` is present, assess spelling, punctuation, grammar, and specialist terminology strictly out of its separate mark budget and report it in \`subQuestionRubrics[subQ].spag\`.`
            : `> ${tieBreakerRuleNum}. **DETERMINISTIC EXAMINER TIE-BREAKER RULES**:
>    - **COMPARATIVE STATEMENTS VS. RAW DATA**: When a mark definition requires a comparison (e.g. "more X", "less Y", "higher/lower Z"), quoting bare values from a table/graph (e.g. "A = 12 and B = 10", or stating "the lowest is X") WITHOUT an explicit comparative direction between the two items ("A has more/higher X than B" or "B has less/lower X than A") earns \`B0\` unless \`[Examiner Notes]\` explicitly states "allow raw data".
>    - **GRAPH PLOTTING & EXTRAPOLATION (\`[DRAWING]\`)**: Only award a graph plotting/extrapolation mark (e.g. "line extrapolated to X") if you can clearly see a student-drawn line/curve actually extending to the target value on the attached page image — do not infer extrapolation solely from a written number.
>    - **PHONETIC SPELLING VS. CONFUSABLE TERMS**: Credit phonetic misspellings of scientific terms (e.g. "nucleas" -> nucleus, "defiency" -> deficiency, "hybreadoma" -> hybridoma) UNLESS the word is a confusable biological/chemical twin (e.g. chloroplast vs. chlorophyll, Mitosis vs. Meiosis, Glucagon vs. Glycogen, Alkane vs. Alkene) or \`[Examiner Notes]\` explicitly says "ignore / do not accept" that term.`;

        return `
> [INSTRUCTION]: You are the CHIEF EXAMINER.
> 1. **MATCH**: Match the student's work strictly to the mark definitions below.
> 2. **STRICT SILO RULE (CRITICAL)**:
>    - You MUST respect the [MAX SCORE] for each sub-question.
>    - **OVERFLOW CHECK:** If you find 4 valid marks, but [6a] only allows 2, you MUST check if the other 2 marks belong to [6b].
>    - **DO NOT** lump all marks into the first bucket. Distribute them based on which sub-question they answer.${mathProcessRules}
${tieBreakerRules}

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
