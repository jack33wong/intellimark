import * as stringSimilarity from 'string-similarity';
import { normalizeTextForComparison } from '../../utils/TextNormalizationUtils.js';

const COMMON_STOP_WORDS = new Set([
    'the', 'and', 'is', 'in', 'it', 'of', 'to', 'for', 'a', 'an', 'on', 'with', 'at', 'by',
    'from', 'up', 'down', 'out', 'that', 'this', 'write', 'down', 'answer', 'total', 'marks', 'question', 'show', 'give', 'your', 'reason', 'explain', 'state',
    'describe', 'value', 'table', 'graph', 'grid', 'space', 'left', 'blank',
    'work', 'find', 'calculate', 'solve', 'simplify', 'evaluate', 'complete', 'fill', 'draw', 'label'
]);

const LATEX_SEMANTIC_MAP: { [key: string]: string } = {
    'frac': 'fraction', 'sqrt': 'root', 'approx': 'estimate', 'pi': 'circle',
    'angle': 'angle', 'triangle': 'triangle', 'int': 'integral', 'sum': 'sum',
    'lim': 'limit', 'vec': 'vector', 'sin': 'sine', 'cos': 'cosine', 'tan': 'tangent'
};

export interface SimilarityScoreDetails {
    total: number;
    text: number;
    numeric: number;
    semanticCheck: boolean;
}

export class SimilarityService {

    /**
     * Consolidate Hybrid Scoring Logic
     * Combining Text similarity, Numeric fingerprinting, and Semantic keywords.
     */
    public static calculateHybridScore(
        inputText: string,
        dbText: string,
        isRescueMode: boolean = false,
        isStrict: boolean = false
    ): SimilarityScoreDetails {

        // 1. Text Similarity (Dice Coefficient)
        const textScore = this.calculateSimilarity(inputText, dbText, isStrict);

        // 2. Semantic Anchoring (Unique Keywords)
        const inputKeywords = this.getKeywords(inputText);
        const dbKeywords = this.getKeywords(dbText);

        let semanticCheck = false;
        if (inputKeywords.size < 2 || dbKeywords.size < 2) {
            semanticCheck = true; // Not enough content to fail
        } else {
            for (const w of inputKeywords) {
                if (dbKeywords.has(w)) {
                    semanticCheck = true;
                    break;
                }
            }
        }

        // 3. Numeric Fingerprinting
        const inputNums = (inputText.match(/\d+(\.\d+)?/g) || []);
        const dbNums = (dbText.match(/\d+(\.\d+)?/g) || []);
        let numericScore = 0;

        if (dbNums.length > 0 && inputNums.length > 0) {
            const setDb = new Set(dbNums);
            const intersection = inputNums.filter(n => setDb.has(n));
            numericScore = intersection.length / Math.max(inputNums.length, dbNums.length);
        } else if (dbNums.length === 0 && inputNums.length === 0) {
            numericScore = 1.0; // Both have no numbers -> identity preserved
        }

        // 4. Weighting
        let total = 0;

        // [WEIGHT-SHIFT]: Text match is much more important than number match to prevent "Perfect Number" hijacks.
        if (semanticCheck && textScore > 0.4) {
            total = (textScore * 0.7) + (numericScore * 0.3);
        } else {
            total = (textScore * 0.6) + (numericScore * 0.4);
        }

        // Penalize if semantic check fails in strict mode
        if (!isRescueMode && !semanticCheck && textScore < 0.8) {
            total = total * 0.3;
        }

        return { total, text: textScore, numeric: numericScore, semanticCheck };
    }

    /**
     * Alphanumeric Similarity with Containment Boost
     */
    public static calculateSimilarity(str1: string, str2: string, isStrict: boolean = false): number {
        if (!str1 || !str2) return 0;

        const norm1 = normalizeTextForComparison(str1, { includeNumbers: isStrict });
        const norm2 = normalizeTextForComparison(str2, { includeNumbers: isStrict });

        if (norm1 === norm2) return 1.0;

        // Base Dice Similarity
        const dice = stringSimilarity.compareTwoStrings(norm1, norm2);

        // Containment Boost (for fragmented OCR)
        // If str1 is almost entirely inside str2, boost the score
        // 🛡️ [STRICT LOCK]: Disabled in strict mode to prevent "1" matching "11"
        if (!isStrict && norm1.length > 10 && norm2.length > 10) {
            if (norm2.includes(norm1) || norm1.includes(norm2)) {
                return Math.max(dice, 0.85);
            }
        }

        return dice;
    }

    /**
     * Extract unique semantic keywords
     */
    public static getKeywords(text: string): Set<string> {
        if (!text) return new Set();
        let clean = text.toLowerCase();

        Object.entries(LATEX_SEMANTIC_MAP).forEach(([cmd, replacement]) => {
            const regex = new RegExp(`\\\\${cmd}`, 'g');
            clean = clean.replace(regex, ` ${replacement} `);
        });

        // Strip backslashes and non-alphanumeric
        clean = clean.replace(/\\/g, ' ').replace(/[^a-z0-9\s]/g, '').trim();
        return new Set(clean.split(/\s+/).filter(w => w.length > 3 && !COMMON_STOP_WORDS.has(w)));
    }
}
