import { MarkingZoneService } from './MarkingZoneService.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';

// 🛡️ [CRITICAL FIX] STRICT TEXT SANITIZER
// Removes ALL numbers and symbols. Keeps ONLY words.
export function normalizeText(text: string): string[] {
    if (!text) return [];
    return text
        .replace(/\\[a-zA-Z]+/g, ' ')       // Strip LaTeX commands
        .replace(/[^a-zA-Z\s]/g, '')        // 🚨 DELETE ALL NUMBERS (0-9) AND SYMBOLS
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length > 2);         // Only keep words > 2 chars
}

export function verifyStrictMatch(dbText: string, ocrText: string): boolean {
    if (!dbText || !ocrText) return false;

    const dbTokens = normalizeText(dbText).slice(0, 15); // Fingerprint
    const ocrTokens = normalizeText(ocrText);

    if (dbTokens.length === 0) return false;

    const matches = dbTokens.filter(t => ocrTokens.includes(t));
    const confidence = matches.length / dbTokens.length;

    // 🎯 STRICT THRESHOLD: 40% Word Overlap Required
    return confidence >= 0.4;
}

// Legacy helper renamed/mapped for compatibility if needed, but we'll use verifyStrictMatch
export function verifyMatch(dbText: string, ocrText: string): boolean {
    return verifyStrictMatch(dbText, ocrText);
}

/**
 * Service dedicated to calculating coordinate offsets, landmark grounding, 
 * and globalizing student work line positions.
 */
export class MarkingPositioningService {
    /**
     * Scans raw OCR blocks to find coordinates of headers/questions based on providing sub-question text.
     * @param expectedQuestions List of sub-questions with their label and full question text (e.g. [{label: '10a', text: '100 people were asked...' }])
     */
    public static detectSemanticZones(
        rawBlocks: any[],
        pageHeight: number,
        expectedQuestions?: Array<{ label: string; text: string }>,
        nextQuestionText?: string // [SEMANTIC-STOP]
    ) {
        return MarkingZoneService.detectSemanticZones(rawBlocks, pageHeight, expectedQuestions, nextQuestionText);
    }

    /**
     * Calculates the global offset (x, y) for a question based on classification blocks,
     * landmarks, and question detection boxes.
     * Includes advanced fallbacks for hierarchical questions (e.g. Q6a).
     */
    public static calculateGlobalOffset(
        classificationBlocks: any[],
        questionDetection: any[],
        targetQuestionObject: any,
        inputQuestionNumber: string,
        rawOcrBlocks: any[],
        processedImage: any
    ): { offsetX: number; offsetY: number } {
        let offsetX = 0;
        let offsetY = 0;

        // 1. Try Classification Block (Primary Source)
        if (classificationBlocks && classificationBlocks.length > 0) {
            const sample = classificationBlocks[0];
            const rawBox = sample.box || sample.coordinates || { x: sample.x, y: sample.y, width: 0, height: 0 };

            // [DEBUG] Warn if classification block exists but rawBox is effectively empty
            if (!sample.box && !sample.coordinates && (!sample.x && !sample.y)) {
                // Log the text content to help identify if this is just noise
                const textPreview = (sample.text || '').substring(0, 100).replace(/\n/g, ' ');
                console.log(`\x1b[33m[POS-DEBUG] ⚠️ Q${inputQuestionNumber} has classification info but MISSING rawBox! Text: "${textPreview}"\x1b[0m`);
            }

            // Assume 1000px fallback if specific dims not available yet in this context
            const pixelBox = CoordinateTransformationService.ensurePixels(rawBox, 2000, 3000, `OFFSET-CLASS`);
            offsetX = pixelBox.x;
            offsetY = pixelBox.y;
        }

        // 2. Fallback: Question Detection (Global Position)
        if ((offsetX === 0 && offsetY === 0) && targetQuestionObject) {
            let qBox = targetQuestionObject.region || targetQuestionObject.box || targetQuestionObject.rect || targetQuestionObject.coordinates;

            // PARENT FALLBACK: If specific Q (e.g. 6a) has no box, find Parent "6"
            if (!qBox && questionDetection && Array.isArray(questionDetection)) {
                const currentBase = String(inputQuestionNumber).replace(/[a-z]/i, '');
                const parentQ = questionDetection.find((q: any) => String(q.questionNumber) === currentBase);
                if (parentQ) {
                    qBox = parentQ.box || parentQ.region || parentQ.rect || parentQ.coordinates;
                    // console.log(`   🔍 [COORD-DEBUG] Inheriting Parent Q${currentBase} Box for Offset`);
                }
            }

            if (qBox) {
                const pixelBox = CoordinateTransformationService.ensurePixels(qBox, 2000, 3000, `OFFSET-DETECTION`);
                offsetX = pixelBox.x;
                offsetY = pixelBox.y;
            }
        }

        // 3. Landmark / Zone Detection (Hierarchical Fallback)
        if (offsetX === 0 && offsetY === 0) {
            const landmarks = (processedImage as any).landmarks || (processedImage as any).zones;
            const subQ = String(inputQuestionNumber || '').replace(/^\d+/, '').toLowerCase();

            if (landmarks && Array.isArray(landmarks)) {
                let match = landmarks.find((l: any) =>
                    (l.label && l.label.toLowerCase() === subQ && subQ !== "") ||
                    (l.label && l.label.toLowerCase() === inputQuestionNumber?.toLowerCase()) ||
                    (l.text && l.text.toLowerCase().includes(`(${subQ})`) && subQ !== "")
                );

                // Hierarchical "First Child" Fallback
                if (!match && landmarks.length > 0) {
                    const isRootQuery = subQ === "" || subQ === inputQuestionNumber?.toLowerCase();
                    if (isRootQuery) {
                        const firstL = landmarks[0];
                        const label = (firstL.label || "").toLowerCase();
                        if (["a", "i", "1"].includes(label)) {
                            match = firstL;
                            // console.log(`   [ANCHOR-FIX] Bridging Root Question '${inputQuestionNumber}' to First Child Landmark '${label}' at Y=${match.y || match.top}`);
                        }
                    }
                }

                if (match) {
                    const pixelBox = CoordinateTransformationService.ensurePixels(match, 2000, 3000, `OFFSET-LANDMARK`);
                    offsetX = pixelBox.x;
                    offsetY = pixelBox.y;
                }
            }
        }

        // [DEBUG] Final Failure Log for (0,0) Case
        if (offsetX === 0 && offsetY === 0) {
            console.log(`\x1b[33m[POS-DEBUG] ⚠️ Missing Position for Q${inputQuestionNumber} -> (0,0).\x1b[0m`);
            console.log(`\x1b[33m   - ClassBlocks: ${classificationBlocks?.length ?? 0}\x1b[0m`);
            console.log(`\x1b[33m   - QuestionDetection: ${!!targetQuestionObject}\x1b[0m`);
        }

        // 4. "Smart Sub-Question Anchor" (OCR Block Fallback)
        if (offsetX === 0 && offsetY === 0 && rawOcrBlocks && rawOcrBlocks.length > 0) {
            // console.log(`\n🔍 [COORD-DEBUG] Inspecting Potential Offset Sources...`);
            // console.log(`   👉 QuestionDetection Box: ${targetQuestionObject?.box ? 'Found' : 'undefined'}`);

            const subQ = String(inputQuestionNumber || '').replace(/^\d+/, '');
            const baseQ = String(inputQuestionNumber || '').replace(/\D/g, '');
            const subQRegex = new RegExp(`^\\(?${subQ}[).]?`, 'i');
            const baseQRegex = new RegExp(`^Q?${baseQ}[.:]?`, 'i');

            let anchorBlock = rawOcrBlocks.find((b: any) => subQ && subQRegex.test(b.text));
            if (!anchorBlock) {
                anchorBlock = rawOcrBlocks.find((b: any) => baseQ && baseQRegex.test(b.text));
            }
            if (!anchorBlock) anchorBlock = rawOcrBlocks[0];

            if (anchorBlock) {
                const bCoords = anchorBlock.coordinates || anchorBlock.box || anchorBlock.geometry?.boundingBox;
                if (bCoords) {
                    const pixelBox = CoordinateTransformationService.ensurePixels(bCoords, 2000, 3000, `OFFSET-ANCHOR`);
                    offsetX = pixelBox.x;
                    offsetY = pixelBox.y;
                    // console.log(`   🔍 [COORD-DEBUG] Using Sub-Question Anchor [${anchorBlock.id || anchorBlock.globalBlockId}] "${anchorBlock.text.substring(0, 20)}..." for Offset: x=${Math.round(offsetX)}, y=${Math.round(offsetY)}`);
                }
            }
        }

        return { offsetX, offsetY };
    }

    /**
     * Globalizes student work lines using per-block landmark scoping and offsets.
     */
    public static globalizeStudentWorkLines(
        classificationBlocks: any[],
        landmarks: any[],
        cleanDataForMarking: any,
        globalOffsetX: number,
        globalOffsetY: number
    ): Array<{ text: string; position: { x: number; y: number; width: number; height: number } }> {
        let studentWorkLines: Array<{ text: string; position: { x: number; y: number; width: number; height: number } }> = [];

        if (classificationBlocks && classificationBlocks.length > 0) {
            classificationBlocks.forEach((block: any) => {
                let blockOffsetX = globalOffsetX;
                let blockOffsetY = globalOffsetY;

                const blockText = (block.text || "").toLowerCase();
                const blockMatch = landmarks.find((l: any) =>
                    blockText.includes(`(${l.label?.toLowerCase()})`) ||
                    blockText.includes(`${l.label?.toLowerCase()})`)
                );

                if (blockMatch) {
                    blockOffsetX = blockMatch.x || blockMatch.left || 0;
                    blockOffsetY = blockMatch.y || blockMatch.top || 0;
                }

                const passThroughLine = (line: any) => {
                    if (!line.position) {
                        return {
                            ...line,
                            position: { x: blockOffsetX, y: blockOffsetY, width: 100, height: 40 }
                        };
                    }
                    // If position exists, we assume it's already been scaled or we scale it here
                    const pos = line.position;
                    const dims = { width: 2000, height: 3000 }; // Fallback
                    const pixelBox = CoordinateTransformationService.ensurePixels(pos, dims.width, dims.height, `GLOBAL-LINE`);

                    return {
                        ...line,
                        position: {
                            x: pixelBox.x + blockOffsetX,
                            y: pixelBox.y + blockOffsetY,
                            width: pixelBox.width,
                            height: pixelBox.height
                        }
                    };
                };

                if (block.studentWorkLines && Array.isArray(block.studentWorkLines)) {
                    studentWorkLines = studentWorkLines.concat(block.studentWorkLines.map(passThroughLine));
                }
                if (block.subQuestions && Array.isArray(block.subQuestions)) {
                    block.subQuestions.forEach((sq: any) => {
                        if (sq.studentWorkLines) {
                            studentWorkLines = studentWorkLines.concat(sq.studentWorkLines.map(passThroughLine));
                        }
                    });
                }
            });
        } else if (cleanDataForMarking.steps && Array.isArray(cleanDataForMarking.steps)) {
            studentWorkLines = cleanDataForMarking.steps.map((step: any) => {
                if (!step.box && !step.position) return null;
                const pos = step.box || step.position;
                return {
                    text: step.text,
                    position: {
                        x: pos.x + globalOffsetX,
                        y: pos.y + globalOffsetY,
                        width: pos.width,
                        height: pos.height
                    }
                };
            }).filter((s: any) => s !== null);
        }

        return studentWorkLines;
    }
}
