import { MathBlock } from '../../types/index.js';
import * as stringSimilarity from 'string-similarity';

export class SpatialShieldService {

    /**
     * HYBRID SHIELD: 
     * 1. Slices OCR data based on Question Headers (Index-Based Safety).
     * 2. Retags blocks as LANDMARK/STUDENT_WORK based on text similarity (Semantic Intelligence).
     */
    static applyHybridShield(
        currentQNumber: string,      // e.g. "12"
        nextQNumber: string | null,  // e.g. "13" or null if last question
        questionText: string,        // e.g. "Put these in order..."
        allOcrBlocks: MathBlock[]
    ): MathBlock[] {
        console.log(`[SPATIAL SHIELD] Applying Hybrid Shield for Q${currentQNumber}...`);

        // 🔍 DEBUG LOG 3: INPUT CHECK
        // Verify if we even RECEIVED the leaky Q13 data
        const hasNextQHeader = allOcrBlocks.some(b => {
            const t = (b.googleVisionText || b.text || b.mathpixLatex || b.cleanedText || '').trim();
            return nextQNumber && this.isHeaderMatch(t, nextQNumber);
        });
        console.log(`[SHIELD] 🛡️ Analyzing Q${currentQNumber}. Next Header "Q${nextQNumber}" present in input? ${hasNextQHeader ? 'YES (Leak Potential)' : 'NO (Clean)'}`);

        // --- STEP 1: INDEX SLICING (The Safe Structure) ---
        // We define the "Bucket" of blocks using the document's natural headers.

        // Find the start index (The header for THIS question)
        const startIndex = allOcrBlocks.findIndex(b => {
            const t = (b.googleVisionText || b.text || b.mathpixLatex || b.cleanedText || '').trim();
            return this.isHeaderMatch(t, currentQNumber);
        });

        // START INDEX LOGIC FIX:
        // If we can't find Q12 header, finding Q11 header + 1 would be safer than 0.
        // For now, if startIndex is -1, we log a warning.
        let validStart = startIndex;
        if (startIndex === -1) {
            console.warn(`[SPATIAL SHIELD] ⚠️ Could not find header "Q${currentQNumber}". Defaulting to 0 (Risk of including Q${parseInt(currentQNumber) - 1}).`);
            validStart = 0;
        }

        // ⛔ REMOVED: End Index Slicing
        // We trust MarkingExecutor's 'floorY' to have physically excluded Q13's body.
        // If the 'Q13' header slips in, we will tag it as a Landmark later.

        // KEEP EVERYTHING from Start onwards
        const relevantBlocks = allOcrBlocks.slice(validStart);

        // 🔍 DEBUG LOG 4: BUCKET SIZE
        console.log(`[SHIELD] ✂️ Slicing: Keeping blocks from index ${validStart} to End. (Dropped ${validStart} blocks from start)`);


        // --- STEP 2: SEMANTIC TAGGING (The Intelligence) ---
        // We now look at what's inside the bucket and label it correctly.

        return relevantBlocks.map(originalBlock => {
            // IMMUTABILITY FIX: Clone the block
            const block = { ...originalBlock };

            const text = (block.googleVisionText || block.text || block.mathpixLatex || block.cleanedText || '').trim();

            // Logic: Is this block just the question text repeated?
            const isCurrentHeader = this.isHeaderMatch(text, currentQNumber);
            const isNextHeader = nextQNumber ? this.isHeaderMatch(text, nextQNumber) : false;
            const isHeader = isCurrentHeader || isNextHeader;
            const isPromptContent = this.isTextSimilar(text, questionText);

            // 🔥 NEW: Check for Footers (Total Marks / Page Numbers)
            const isFooter = this.isFooterMatch(text);

            const isLandmark = isHeader || isPromptContent || isFooter;

            if (isLandmark && !block.isPrinted) {
                // 🔍 DEBUG LOG 5: RETAGGING
                console.log(`[SHIELD] 🏷️ CORRECTED: "${text.substring(0, 15)}..." -> LANDMARK (Printed)`);
            } else if (!isLandmark && !block.isHandwritten && !block.isPrinted) {
                console.log(`[SHIELD] 🏷️ CORRECTED: "${text.substring(0, 15)}..." -> STUDENT_WORK`);
            }

            // Apply the tags by mutating the block properties (to fit MathBlock interface)
            // We enforce the semantic type:
            // LANDMARK -> isPrinted=true, isHandwritten=false
            // STUDENT_WORK -> isPrinted=false, isHandwritten=true
            if (isLandmark) {
                block.isPrinted = true;
                block.isHandwritten = false;
            } else {
                block.isPrinted = false;
                block.isHandwritten = true;
            }

            return block;
        });
    }


    // --- HELPER LOGIC ---

    /**
     * Detects "Q12", "Q12.", "Question 12" headers robustly
     * Also checks for the Next Question Header (e.g. Q13) to prevent leaks.
     */
    private static isHeaderMatch(blockText: string, qNum: string, nextQNum: string | null = null): boolean {
        const clean = blockText.trim().toLowerCase().replace(/[^a-z0-9.]/g, ''); // keep dots for "12."

        // Check Current Question (e.g. "12")
        if (this.checkSingleHeader(clean, qNum)) return true;

        // Check Next Question (e.g. "13") - Treat as Header/Landmark too!
        if (nextQNum && this.checkSingleHeader(clean, nextQNum)) return true;

        return false;
    }

    // Helper to keep logic clean and robust
    private static checkSingleHeader(cleanText: string, qNum: string): boolean {
        const target = qNum.toLowerCase();
        // Uses startsWith to catch "Q13." even if there is trailing noise or just the dot
        return cleanText === `q${target}` ||
            cleanText === `${target}.` ||
            cleanText === `question${target}` ||
            cleanText.startsWith(`q${target}.`);
    }

    /**
     * Fuzzy matches block text against the known printed question text.
     * Uses string-similarity (Dice coefficient) to handle OCR typos.
     */
    private static isTextSimilar(blockText: string, questionText: string): boolean {
        if (!blockText || !questionText) return false;

        // 1. Clean strings (remove whitespace, special chars, lower case)
        const cleanBlock = blockText.toLowerCase().replace(/[^a-z0-9]/g, '');
        const cleanQ = questionText.toLowerCase().replace(/[^a-z0-9]/g, '');

        // 2. Safety for short blocks (numbers/symbols)
        // If a block is just "2/3", we don't want to match it to a long question.
        if (cleanBlock.length < 5) return false;

        // 3. Substring Check (Fast & Effective)
        // Often OCR breaks lines differently. If the block is strictly inside the question, it's printed.
        if (cleanQ.includes(cleanBlock)) return true;

        // 4. Fuzzy Match (String Similarity)
        // Dice coefficient is 0-1.
        const similarity = stringSimilarity.compareTwoStrings(cleanBlock, cleanQ);

        // Threshold: 0.7 (70% similarity) allows for OCR noise but rejects distinct student work
        return similarity > 0.7;
    }

    /**
     * 🔥 NEW HELPER: Detects Standard Exam Footers
     */
    private static isFooterMatch(text: string): boolean {
        // Regex for "(Total X marks)" case-insensitive
        const totalMarksRegex = /\(Total\s+\d+\s+marks\)/i;

        // Regex for "Page X of Y"
        const pageRegex = /Page\s+\d+\s+of\s+\d+/i;

        // Regex for "End of questions" or standard exam footer text
        const footerKeywords = ["physicsandmathstutor", "aqa gcse", "edexcel", "ocr"];

        if (totalMarksRegex.test(text)) return true;
        if (pageRegex.test(text)) return true;

        // Check keywords
        const lower = text.toLowerCase();
        if (footerKeywords.some(k => lower.includes(k))) return true;

        return false;
    }
}
