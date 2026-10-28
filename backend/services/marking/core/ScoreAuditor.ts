
export class ScoreAuditor {

    /**
     * Faithfully migrates the original "parseScore" logic.
     */
    static parseScore(scoreInput: any): { awardedMarks: number; totalMarks: number; scoreText?: string } {
        if (!scoreInput) return { awardedMarks: 0, totalMarks: 0 };

        if (typeof scoreInput === 'object') {
            const awarded = parseFloat(scoreInput.awardedMarks);
            const total = parseFloat(scoreInput.totalMarks);
            if (!isNaN(awarded) && !isNaN(total) && total > 0) {
                return { awardedMarks: awarded, totalMarks: total };
            }
        }

        const scoreStr = String(typeof scoreInput === 'object' ? (scoreInput.scoreText || scoreInput.awardedMarks || '0') : scoreInput);
        if (scoreStr.includes('/')) {
            const parts = scoreStr.split('/');
            return {
                awardedMarks: parseFloat(parts[0]) || 0,
                totalMarks: parseFloat(parts[1]) || 0
            };
        }

        const numericValue = parseFloat(scoreStr);
        return {
            awardedMarks: isNaN(numericValue) ? 0 : numericValue,
            totalMarks: 0
        };
    }

    /**
     * Faithfully migrates "The Guillotine" (Strict Budget Enforcement).
     */
    static enforceStrictBudget(
        annotations: any[],
        scheme: any
    ): { annotations: any[], awardedMarks: number } {
        const sanitizeValue = (text: string) => {
            const match = text.match(/[A-Z]+(\d+)/i);
            if (match) return parseInt(match[1]);
            const num = parseInt(text.replace(/\D/g, ''));
            return isNaN(num) ? 0 : num;
        };

        const buckets: Record<string, any[]> = {};
        annotations.forEach(a => {
            const key = a.subQuestion || 'main';
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(a);
        });

        let grandTotal = 0;
        const survivorList: any[] = [];

        Object.keys(buckets).forEach(subQ => {
            const anns = buckets[subQ];
            let budget = 99;

            if (scheme) {
                if (scheme.markBreakdown && scheme.markBreakdown[subQ]) {
                    budget = scheme.markBreakdown[subQ].maxScore || budget;
                }
                else if (Array.isArray(scheme.subQuestions)) {
                    const match = (scheme.subQuestions as any[]).find((sq: any) => sq.label === subQ || sq.questionNumber === subQ);
                    if (match && match.maxScore) budget = Number(match.maxScore);
                }
                else if (Object.keys(buckets).length === 1 && scheme.totalMarks) {
                    budget = Number(scheme.totalMarks);
                }
            }

            let currentVal = 0;
            const survivors: any[] = [];
            // console.log(` 💎 [BUDGET-CHECK] Q${subQ}: Max Marks = ${budget}. Items to Process: ${anns.length}`);
            for (const ann of anns) {
                const val = sanitizeValue(ann.text || "0");
                if (currentVal + val <= budget) {
                    survivors.push(ann);
                    currentVal += val;
                } else {
                    // console.log(` ✂️ [GUILLOTINE] Q${subQ}: Cutting annotation "${ann.text}" (Value: ${val}). Budget: ${budget}, Already Awarded: ${currentVal}`);
                }
            }
            survivors.forEach(s => survivorList.push(s));
            grandTotal += currentVal;
        });

        return { annotations: survivorList, awardedMarks: grandTotal };
    }

    /**
     * Level-of-Response (LoR) Score Integrity Guard (GCSE English Language & Literature).
     * Never sums integers from margin annotations (which are qualitative evidence badges like [AO2 L4]).
     * Instead, validates and reconciles the single-AO or dual-AO rubricEvaluation and emits
     * the 📊 [RUBRIC-AUDIT] structured log.
     */
    static reconcileLevelOfResponseScore(
        rubricEvaluation: any,
        studentScore: any,
        scheme: any,
        annotations: any[],
        questionId: string | number = '?'
    ): {
        awardedMarks: number;
        totalMarks: number;
        scoreText: string;
        rubricEvaluation: any;
    } {
        const parsedFallback = this.parseScore(studentScore);
        const schemeMax = Number(scheme?.totalMarks || scheme?.marks || 0);
        const evalMax = Number(rubricEvaluation?.maxMarks || 0);
        let totalMarks = schemeMax > 0 ? schemeMax : (evalMax > 0 ? evalMax : parsedFallback.totalMarks);

        const aoBreakdown: any[] = Array.isArray(rubricEvaluation?.aoBreakdown)
            ? rubricEvaluation.aoBreakdown
            : [];

        let awardedMarks = Number(rubricEvaluation?.awardedMarks ?? parsedFallback.awardedMarks ?? 0);
        const scoringType = rubricEvaluation?.scoringType || (aoBreakdown.length > 1 ? 'DUAL_AO_LOR' : 'SINGLE_AO_LOR');

        if (aoBreakdown.length > 0) {
            let sumAwarded = 0;
            let sumMax = 0;
            aoBreakdown.forEach(item => {
                const itemMax = Math.max(0, Number(item.maxMarks || 0));
                const itemAwarded = Math.max(0, Math.min(Number(item.awardedMarks || 0), itemMax > 0 ? itemMax : 99));
                item.awardedMarks = itemAwarded;
                item.maxMarks = itemMax;
                sumAwarded += itemAwarded;
                sumMax += itemMax;
            });
            if (sumMax > 0 && totalMarks === 0) {
                totalMarks = sumMax;
            }
            if (aoBreakdown.length > 1 || sumAwarded > 0) {
                awardedMarks = sumAwarded;
            }
        }

        if (totalMarks > 0) {
            awardedMarks = Math.max(0, Math.min(awardedMarks, totalMarks));
        } else {
            awardedMarks = Math.max(0, awardedMarks);
        }

        const updatedEval: any = {
            ...(rubricEvaluation || {}),
            scoringType,
            awardedMarks,
            maxMarks: totalMarks,
            aoBreakdown
        };

        // Ensure a clean, deterministic rubricStamp exists
        if (!updatedEval.rubricStamp || typeof updatedEval.rubricStamp !== 'string') {
            if (aoBreakdown.length > 1) {
                const parts = aoBreakdown.map(b => {
                    const lvl = b.level ? ` (L${b.level})` : '';
                    return `${b.ao || 'AO'}: ${b.awardedMarks}/${b.maxMarks}${lvl}`;
                });
                updatedEval.rubricStamp = `[${parts.join(' + ')} = ${awardedMarks}/${totalMarks}]`;
            } else {
                const lvlLabel = updatedEval.levelLabel || (updatedEval.awardedLevel ? `Level ${updatedEval.awardedLevel}` : 'Rubric');
                updatedEval.rubricStamp = `[${lvlLabel} | ${awardedMarks}/${totalMarks} marks]`;
            }
        }

        const breakdownLog = aoBreakdown.length > 0
            ? aoBreakdown.map(b => `${b.ao || 'AO'}=${b.awardedMarks}/${b.maxMarks}${b.level ? ` (L${b.level})` : ''}`).join(' + ')
            : `${updatedEval.levelLabel || 'LoR'}=${awardedMarks}/${totalMarks}`;

        console.log(
            `📊 [RUBRIC-AUDIT] Q${questionId} (${scoringType}): ${breakdownLog} => Total=${awardedMarks}/${totalMarks} | Annotations=${annotations?.length || 0} (non-additive)`
        );

        return {
            awardedMarks,
            totalMarks,
            scoreText: `${awardedMarks}/${totalMarks}`,
            rubricEvaluation: updatedEval
        };
    }
}
