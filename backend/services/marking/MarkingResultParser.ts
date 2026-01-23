import type { NormalizedMarkingScheme } from '../../types/marking.js';

/**
 * Service dedicated to parsing and sanitizing the output from the AI marking model.
 */
export class MarkingResultParser {
    /**
     * Extracts a JSON block from a markdown-formatted AI response.
     */
    public static extractJsonFromResponse(aiResponseString: string): string {
        const jsonStartMarker = '```json';
        const jsonEndMarker = '```';
        const startIndex = aiResponseString.indexOf(jsonStartMarker);

        if (startIndex !== -1) {
            const contentStart = startIndex + jsonStartMarker.length;
            const lastEndIndex = aiResponseString.lastIndexOf(jsonEndMarker);
            if (lastEndIndex > contentStart) {
                return aiResponseString.substring(contentStart, lastEndIndex).trim();
            }
        } else {
            const simpleStartMarker = '```';
            const simpleStart = aiResponseString.indexOf(simpleStartMarker);
            if (simpleStart !== -1) {
                const contentStart = simpleStart + simpleStartMarker.length;
                const lastEndIndex = aiResponseString.lastIndexOf(jsonEndMarker);
                if (lastEndIndex > contentStart) {
                    return aiResponseString.substring(contentStart, lastEndIndex).trim();
                }
            }
        }

        return aiResponseString.trim();
    }

    /**
     * Attempts to repair common JSON issues returned by LLMs.
     */
    public static repairJson(jsonString: string): any {
        let parsed: any = null;
        try {
            parsed = JSON.parse(jsonString);
        } catch (e) {
            let fixedJson = jsonString;

            // Fix 1: Missing closing brace before comma
            fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
                const indentMatch = match.match(/\n(\s*),\s*\n/);
                const indent = indentMatch ? indentMatch[1] : '    ';
                return `"${field}": "${value}"\n${indent}},\n${indent}{`;
            });

            // Fix 2: Unescaped backslashes
            fixedJson = fixedJson.replace(/\\(?![\\"/nrtbfu])/g, '\\\\');

            try {
                parsed = JSON.parse(fixedJson);
            } catch (e2) {
                // Fix 3: Aggressive escaping
                fixedJson = jsonString.replace(/\\/g, '\\\\')
                    .replace(/\\\\n/g, '\\n')
                    .replace(/\\\\"/g, '\\"')
                    .replace(/\\\\r/g, '\\r')
                    .replace(/\\\\t/g, '\\t')
                    .replace(/\\\\b/g, '\\b')
                    .replace(/\\\\f/g, '\\f');

                // Fix 4: Missing closing brace before comma (retry)
                fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
                    const indentMatch = match.match(/\n(\s*),\s*\n/);
                    const indent = indentMatch ? indentMatch[1] : '    ';
                    return `"${field}": "${value}"\n${indent}},\n${indent}{`;
                });

                try {
                    parsed = JSON.parse(fixedJson);
                } catch (e3) {
                    console.error('❌ JSON parsing failed after fix attempts.');
                    throw e3;
                }
            }
        }
        return parsed;
    }

    /**
     * Post-processes the AI response: mark limits, page correction, score recalculation, and UI Polish.
     */
    public static postProcessMarkingResponse(
        parsedResponse: any,
        normalizedScheme: NormalizedMarkingScheme | null | undefined,
        subQuestionPageMap: Record<string, number[]>,
        inputQuestionNumber: string
    ): any {
        if (!parsedResponse) return null;

        // =====================================================================
        // 🔧 FIX 1: GHOST MARK PROTECTION
        // Ensure UNMATCHED marks have unique IDs so they survive deduplication.
        // =====================================================================
        if (parsedResponse.annotations) {
            parsedResponse.annotations.forEach((anno: any, index: number) => {
                if (!anno.line_id || anno.ocr_match_status === 'UNMATCHED') {
                    const uniqueSuffix = `${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
                    anno.line_id = `ghost_${uniqueSuffix}`;
                    anno.ocr_match_status = 'UNMATCHED';
                }
            });
        }

        // 1. Mapper Truth Consistency (Page Assignments)
        if (subQuestionPageMap && Object.keys(subQuestionPageMap).length > 0 && parsedResponse.annotations) {
            parsedResponse.annotations.forEach((anno: any) => {
                let subQ = anno.subQuestion;
                if (!subQ && anno.line_id) {
                    const match = anno.line_id.match(/line_\d+([a-z]+)/i);
                    if (match) subQ = match[1];
                }
                if (!subQ && anno.reasoning) {
                    const reasonMatch = anno.reasoning.match(/\[(\d*[a-z]+)\]/i);
                    if (reasonMatch) subQ = reasonMatch[1];
                }

                if (subQ) {
                    const normalizedSubQ = subQ.replace(/^\d+[\s()]*|[\s()]+/g, '').toLowerCase();
                    if (subQuestionPageMap[normalizedSubQ] !== undefined) {
                        const allowedPages = subQuestionPageMap[normalizedSubQ];
                        if (!allowedPages.includes(anno.pageIndex)) {
                            anno.pageIndex = allowedPages[0];
                        }
                    }
                }
            });
        }

        // 2. Data Sanitization & Deduplication
        if (parsedResponse.annotations) {
            parsedResponse.annotations = parsedResponse.annotations.map((anno: any) => {
                const aiId = anno.line_id || anno.step_id || anno.lineId;
                if (aiId) {
                    anno.line_id = aiId;
                    anno.step_id = aiId;
                }
                if (anno.student_text) {
                    anno.student_text = anno.student_text.replace(/&/g, ' ').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
                }
                if (anno.action === 'null') anno.action = '';
                if (anno.text === 'null') anno.text = '';

                // Mark code deduplication
                if (anno.text && typeof anno.text === 'string') {
                    const codes = anno.text.trim().split(/\s+/);
                    const processedCodes: string[] = [];
                    const seenZeroCodes = new Set<string>();
                    codes.forEach(code => {
                        if (code.endsWith('0')) {
                            if (!seenZeroCodes.has(code)) {
                                seenZeroCodes.add(code);
                                processedCodes.push(code);
                            }
                        } else {
                            processedCodes.push(code);
                        }
                    });
                    anno.text = processedCodes.join(' ');
                }
                return anno;
            });

            // 3. Merging Disabled (Option A)
            // We now allow multiple annotations to share the same line_id and action
            // to support cascading marks (e.g. M1 and A1 on the same line).
            // No changes needed here, just removing the previous merging logic.
        }

        // 4. Strict Mark Limit Enforcement (DISABLED - Using Pipeline Guillotine)
        if (normalizedScheme && parsedResponse.annotations) {
            console.log(`🛡️ [PIPELINE-SAFETY] Skipping early limit enforcement for Q${inputQuestionNumber}. Trusting downstream Guillotine.`);
            // this.enforceMarkLimits(parsedResponse, normalizedScheme, inputQuestionNumber);
        }

        // =====================================================================
        // 🔧 FIX 2: ATOMIC MATH SCORING
        // PREVENTS "968/4" BUG by treating Math as atomic "1 mark".
        // =====================================================================
        if (parsedResponse.studentScore) {
            let awarded = 0;
            parsedResponse.annotations.forEach((anno: any) => {
                const text = (anno.text || '').trim();
                const action = (anno.action || '').toLowerCase();

                const isPositive = text && (action === 'tick' || action === 'mark' || !action.includes('cross'));

                if (isPositive) {
                    // CHECK 1: IS IT MATH/LATEX?
                    // If the WHOLE string contains LaTeX syntax or math operators, we stop immediately.
                    // We assume it is a "visual tick" worth 1 mark.
                    if (/[\\{}=\^_\(\)]/.test(text) || text.includes('sqrt') || text.includes('frac')) {
                        awarded += 1;
                    }
                    else {
                        // CHECK 2: PARSE AS CODES
                        // Only now do we split by spaces/punctuation
                        const tokens = text.split(/[\s,|+]+/).filter((t: string) => t.length > 0);
                        let foundCode = false;
                        let lineScore = 0;

                        tokens.forEach((token: string) => {
                            const clean = token.replace(/[^a-zA-Z0-9]/g, ''); // strip punctuation

                            // Regex for standard codes: M1, A2, B3, or integers like 1, 2
                            if (/^[BMAPC][1-9]\d*$/i.test(clean)) {
                                // CASE A: Explicit Mark Code (e.g. B2, M1) - TRUST THE NUMBER
                                const val = parseInt(clean.match(/\d+$/)?.[0] || '1', 10);
                                lineScore += val;
                                foundCode = true;
                            } else if (/^[1-9]\d*$/.test(clean)) {
                                // CASE B: Raw Number (e.g. 27). 
                                // To avoid "Total Trap", we treat raw isolation numbers as 1 mark (standard tick).
                                // Only exception: if it's 1 or 2, maybe we allow it? Let's be safe and cap at 1.
                                lineScore += 1;
                                foundCode = true;
                            }
                        });

                        if (foundCode) {
                            awarded += lineScore;
                        } else {
                            // If it's just text "Correct" or "Good", count as 1 mark
                            awarded += 1;
                        }
                    }
                }
            });

            const systemMax = normalizedScheme?.totalMarks || 0;
            const authoritativeTotal = this.resolveBudget(parsedResponse.meta, systemMax, inputQuestionNumber);

            awarded = Math.min(awarded, authoritativeTotal > 0 ? authoritativeTotal : (systemMax || 99));

            parsedResponse.studentScore.awardedMarks = awarded;
            parsedResponse.studentScore.totalMarks = authoritativeTotal || systemMax;
            parsedResponse.studentScore.scoreText = `${awarded}/${authoritativeTotal || systemMax}`;
        }

        // 6. Drawing Box Resize Logic
        this.fixOversizedDrawings(parsedResponse);

        return parsedResponse;
    }

    private static enforceMarkLimits(parsedResponse: any, normalizedScheme: any, qNum: string): void {
        const marksList: any[] = [...(normalizedScheme.marks || [])];
        if (normalizedScheme.subQuestionMarks) {
            Object.values(normalizedScheme.subQuestionMarks).forEach((sm: any) => {
                if (Array.isArray(sm)) marksList.push(...sm);
                else if (sm?.marks) marksList.push(...sm.marks);
            });
        }

        const limitMap = new Map<string, number>();
        let floatingPool = 0;
        marksList.forEach(m => {
            const code = (m.mark || '').trim();
            if (code) {
                limitMap.set(code, (limitMap.get(code) || 0) + 1);
                if (normalizedScheme.isGeneric) limitMap.set(code, 99);
                if (/^\d+$/.test(code)) floatingPool += parseInt(code, 10);
            }
        });

        // 🔧 FIX 3: Loose Check for Generic Mode
        const isLooseMode = marksList.length === 0 || normalizedScheme.isGeneric;

        const validAnnos: any[] = [];
        const usage = new Map<string, number>();
        parsedResponse.annotations.forEach((anno: any) => {
            const tokens = (anno.text || '').trim().split(/[\s,|+]+/).filter(t => t.length > 0);
            const valid: string[] = [];

            const isMathText = tokens.some(t => /[\\=\d]/.test(t) && !/^[BMAPC]\d+$/.test(t));

            if (isLooseMode || isMathText) {
                valid.push(...tokens);
            } else {
                tokens.forEach(t => {
                    const code = t.split(/[^a-zA-Z0-9]/)[0];
                    const count = usage.get(code) || 0;
                    const limit = limitMap.get(code) || (code.endsWith('0') ? 99 : 0);

                    if (count < limit) {
                        valid.push(t);
                        usage.set(code, count + 1);
                    } else if (/^[BMAPC][1-9]$/i.test(code) && floatingPool > 0) {
                        const val = parseInt(code.match(/(\d+)$/)?.[1] || '1', 10);
                        if (floatingPool >= val) {
                            valid.push(t);
                            floatingPool -= val;
                        }
                    }
                });
            }

            if (valid.length > 0) {
                anno.text = valid.join(' ');
                validAnnos.push(anno);
            }
        });
        parsedResponse.annotations = validAnnos;
    }

    private static resolveBudget(meta: any, systemMax: number, qNum: string): number {
        const isAiEstimated = meta?.isTotalEstimated === true || String(meta?.isTotalEstimated) === 'true';
        const aiTotal = meta?.question_total_marks || 0;
        const isDefault = [0, 20, 40, 100].includes(systemMax);

        if (aiTotal > 0 && (!isAiEstimated || isDefault)) return aiTotal;
        if (systemMax > 0 && !isDefault) return systemMax;
        return aiTotal || 0;
    }

    private static fixOversizedDrawings(parsedResponse: any): void {
        if (!parsedResponse.annotations) return;
        const uniqueSubQs = new Set(parsedResponse.annotations.map((a: any) => a.subQuestion).filter(s => s));
        const subQCount = uniqueSubQs.size || 1;
        const sortedSubQs = Array.from(uniqueSubQs).sort();

        parsedResponse.annotations.forEach((anno: any) => {
            if (anno.ocr_match_status === 'VISUAL' && anno.visual_position) {
                const w = parseFloat(anno.visual_position.width) || 0;
                const h = parseFloat(anno.visual_position.height) || 0;
                if (w >= 65 || h >= 65) {
                    const newSize = subQCount === 1 ? 45 : 70 / subQCount;
                    anno.visual_position.width = newSize;
                    anno.visual_position.height = newSize;

                    if (subQCount > 1 && anno.subQuestion) {
                        const idx = sortedSubQs.indexOf(anno.subQuestion);
                        if (idx !== -1) {
                            anno.visual_position.y = 15 + (idx * (70 / subQCount));
                        }
                    }
                }
            }
        });
    }
}