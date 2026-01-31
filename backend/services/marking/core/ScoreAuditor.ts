
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
            console.log(` 💎 [BUDGET-CHECK] Q${subQ}: Max Marks = ${budget}. Items to Process: ${anns.length}`);
            for (const ann of anns) {
                const val = sanitizeValue(ann.text || "0");
                if (currentVal + val <= budget) {
                    survivors.push(ann);
                    currentVal += val;
                } else {
                    console.log(` ✂️ [GUILLOTINE] Q${subQ}: Cutting annotation "${ann.text}" (Value: ${val}). Budget: ${budget}, Already Awarded: ${currentVal}`);
                }
            }
            survivors.forEach(s => survivorList.push(s));
            grandTotal += currentVal;
        });

        return { annotations: survivorList, awardedMarks: grandTotal };
    }
}
