// src/services/ai-marking/MarkingSanitizer.ts

/**
 * THE IRON DOME (V2): Aggressive Digit Fidelity
 * If the student has a number that the OCR block lacks, we KILL the match.
 */
export function sanitizeAnnotations(
    rawAnnotations: any[],
    ocrBlocks: any[]
): any[] {
    console.log('🛡️ [IRON DOME V2] Active. Enforcing Digit Fidelity...');

    return rawAnnotations.map(anno => {
        // 1. Skip if not MATCHED or Visual
        if (anno.ocr_match_status !== 'MATCHED' || !anno.line_id) {
            if (anno.ocr_match_status === 'UNMATCHED' && anno.line_id) {
                return { ...anno, line_id: null }; // Clean messy unmatched
            }
            return anno;
        }

        // 2. Find the OCR Block
        const block = ocrBlocks.find((b: any) => b.id === anno.line_id);
        if (!block) {
            return { ...anno, ocr_match_status: 'UNMATCHED', line_id: null };
        }

        // 3. DIGIT FIDELITY CHECK
        const studentText = (anno.student_text || anno.studentText || "").toString();
        const ocrText = block.text.toString();

        // Extract UNIQUE digits present in each string
        const studentDigits = [...new Set(studentText.match(/\d/g) || [])];

        // Check every digit the student wrote
        for (const digit of studentDigits) {
            // If student has a '5', the OCR text MUST contain a '5'
            if (!ocrText.includes(digit)) {
                console.log(`🛡️ [IRON DOME] BLOCKED False Positive!`);
                console.log(`   ❌ Student has digit '${digit}' ("${studentText}")`);
                console.log(`   ❌ OCR Block MISSES digit '${digit}' ("${ocrText}")`);
                console.log(`   👉 Action: VETO -> UNMATCHED`);

                return {
                    ...anno,
                    ocr_match_status: 'UNMATCHED',
                    line_id: null,
                    reasoning: `${anno.reasoning} [SYSTEM: Sanitized (Missing digit ${digit})]`
                };
            }
        }

        return anno;
    });
}