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

        // Find the end index (The header for the NEXT question)
        // If nextQNumber is null, we take everything until the end.
        let endIndex = -1;
        if (nextQNumber) {
            endIndex = allOcrBlocks.findIndex(b => {
                const t = (b.googleVisionText || b.text || b.mathpixLatex || b.cleanedText || '').trim();
                return this.isHeaderMatch(t, nextQNumber);
            });
        }

        // SLICE LOGIC:
        // If we can't find the start, we default to 0 (Safe Fallback).
        // If we can't find the end, we go to the array length.
        // If found end index is BEFORE start index (e.g. noise), ignore it.
        const validEnd = (endIndex !== -1 && endIndex > validStart) ? endIndex : allOcrBlocks.length;

        // 🔍 DEBUG LOG 4: BUCKET SIZE
        console.log(`[SHIELD] ✂️ Slicing: Keeping blocks from index ${validStart} to ${validEnd}. (Dropped ${allOcrBlocks.length - (validEnd - validStart)} blocks)`);

        // We keep everything in this "Bucket". 
        // This removes Q13 content without risking "Guillotine" cuts on fringe pixels.
        const relevantBlocks = allOcrBlocks.slice(validStart, validEnd);


        // --- STEP 2: SEMANTIC TAGGING (The Intelligence) ---
        // We now look at what's inside the bucket and label it correctly.

        return relevantBlocks.map(originalBlock => {
            // IMMUTABILITY FIX: Clone the block
            const block = { ...originalBlock };

            const text = (block.googleVisionText || block.text || block.mathpixLatex || block.cleanedText || '').trim();

            // Logic: Is this block just the question text repeated?
            const isHeader = this.isHeaderMatch(text, currentQNumber); // It's the "Q12" header
            const isPromptContent = this.isTextSimilar(text, questionText); // It's the printed prompt

            const isLandmark = isHeader || isPromptContent;

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
     */
    private static isHeaderMatch(blockText: string, qNum: string): boolean {
        const clean = blockText.trim().toLowerCase().replace(/[^a-z0-9.]/g, ''); // keep dots for "12."
        const target = qNum.toLowerCase();

        // Strict checks for headers to avoid false positives
        return clean === `q${target}` ||
            clean === `${target}.` ||
            clean === `question${target}` ||
            clean === `q${target}.` ||
            clean.startsWith(`question${target}`);
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
}
