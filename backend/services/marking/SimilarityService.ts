import { normalizeTextForComparison } from "../../utils/TextNormalizationUtils.js";

// Internal interface for SimilarityService to avoid touching types/index.ts
interface SimilarityScoreDetails {
    total: number;
    text: number;
    numeric: number;
    structure?: number;
    semanticCheck: boolean;
}

export class SimilarityService {
    /**
     * Calculate core text similarity using Dice Coefficient.
     */
    public static calculateSimilarity(s1: string, s2: string, normalize: boolean = true): number {
        const text1 = normalize ? normalizeTextForComparison(s1) : s1;
        const text2 = normalize ? normalizeTextForComparison(s2) : s2;

        if (text1 === text2) return 1.0;
        if (text1.length < 2 || text2.length < 2) return 0.0;

        const bigrams1 = this.getBigrams(text1);
        const bigrams2 = this.getBigrams(text2);

        const intersection = new Set([...bigrams1].filter(x => bigrams2.has(x)));
        return (2.0 * intersection.size) / (bigrams1.size + bigrams2.size);
    }

    private static getBigrams(str: string): Set<string> {
        const bigrams = new Set<string>();
        for (let i = 0; i < str.length - 1; i++) {
            bigrams.add(str.substring(i, i + 2));
        }
        return bigrams;
    }

    public static getKeywords(text: string): Set<string> {
        return new Set(
            text.toLowerCase()
                .replace(/[^\w\s]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 3)
        );
    }

    /**
     * Zone-Specific Scoring (Maintains Legacy Stability)
     * Used for finding boundaries within a page.
     */
    public static calculateZoneHybridScore(
        inputText: string,
        dbText: string,
        isRescueMode: boolean = false
    ): SimilarityScoreDetails {
        const textScore = this.calculateSimilarity(inputText, dbText, true);
        const inputNums = (inputText.match(/\d+(\.\d+)?/g) || []);
        const dbNums = (dbText.match(/\d+(\.\d+)?/g) || []);

        let semanticCheck = false;
        const inputKeywords = this.getKeywords(inputText);
        const dbKeywords = this.getKeywords(dbText);
        if (inputKeywords.size < 2 || dbKeywords.size < 2) {
            semanticCheck = true;
        } else {
            for (const w of inputKeywords) {
                if (dbKeywords.has(w)) {
                    semanticCheck = true;
                    break;
                }
            }
        }

        let numericScore = 0;
        if (dbNums.length > 0 && inputNums.length > 0) {
            const setInput = new Set(inputNums);
            const setDb = new Set(dbNums);
            const uniqueIntersection = Array.from(setInput).filter(n => setDb.has(n));
            numericScore = uniqueIntersection.length / Math.max(setInput.size, setDb.size);
        } else if (dbNums.length === 0 && inputNums.length === 0) {
            numericScore = 1.0;
        }

        let total = (textScore * 0.6) + (numericScore * 0.4);
        if (semanticCheck && textScore > 0.4) {
            total = (textScore * 0.7) + (numericScore * 0.3);
        }

        return { total, text: textScore, numeric: numericScore, semanticCheck };
    }

    /**
     * Question-Specific Scoring (Optimized for Global Database Search)
     * Strict rules to prevent "Generic Instruction" false positives.
     */
    public static calculateQuestionHybridScore(
        inputText: string,
        dbText: string,
        isRescueMode: boolean = false
    ): SimilarityScoreDetails {
        const textScore = this.calculateSimilarity(inputText, dbText, true);
        const inputKeywords = this.getKeywords(inputText);
        const dbKeywords = this.getKeywords(dbText);

        let semanticCheck = false;
        if (inputKeywords.size < 2 || dbKeywords.size < 2) {
            semanticCheck = true;
        } else {
            for (const w of inputKeywords) {
                if (dbKeywords.has(w)) {
                    semanticCheck = true;
                    break;
                }
            }
        }

        const inputNums = (inputText.match(/\d+(\.\d+)?/g) || []);
        const cleanDbText = dbText.replace(/\[.*?\]/g, "");
        const dbNums = (cleanDbText.match(/\d+(\.\d+)?/g) || []);

        let numericScore = 0;

        if (dbNums.length > 0 && inputNums.length > 0) {
            const setInput = new Set(inputNums);
            const setDb = new Set(dbNums);
            const uniqueIntersection = Array.from(setInput).filter(n => setDb.has(n));
            numericScore = uniqueIntersection.length / setDb.size;
        } else if (dbNums.length === 0 && inputNums.length === 0) {
            numericScore = 0.5;
        }

        let total = (textScore * 0.7) + (numericScore * 0.3);

        if (!isRescueMode && !semanticCheck && textScore < 0.8) {
            total = total * 0.2;
        }

        return { total, text: textScore, numeric: numericScore, semanticCheck };
    }

    public static calculateHybridScore(
        inputText: string,
        dbText: string,
        isRescueMode: boolean = false
    ): SimilarityScoreDetails {
        return this.calculateQuestionHybridScore(inputText, dbText, isRescueMode);
    }
}
