import { MarkingZoneService } from './MarkingZoneService.js';

/**
 * Service dedicated to calculating coordinate offsets, landmark grounding, 
 * and globalizing student work line positions.
 */
export class MarkingPositioningService {
    /**
     * Scans raw OCR blocks to find coordinates of headers/questions based on providing sub-question text.
     * @param expectedQuestions List of sub-questions with their label and full question text (e.g. [{label: '10a', text: '100 people were asked...' }])
     */
    public static detectSemanticZones(rawBlocks: any[], pageHeight: number, expectedQuestions?: Array<{ label: string; text: string }>) {
        return MarkingZoneService.detectSemanticZones(rawBlocks, pageHeight, expectedQuestions);
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
            offsetX = sample.box?.x || sample.x || sample.coordinates?.x || 0;
            offsetY = sample.box?.y || sample.y || sample.coordinates?.y || 0;
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
                    console.log(`   🔍 [COORD-DEBUG] Inheriting Parent Q${currentBase} Box for Offset`);
                }
            }

            if (qBox) {
                offsetX = qBox.x || 0;
                offsetY = qBox.y || 0;
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
                            console.log(`   [ANCHOR-FIX] Bridging Root Question '${inputQuestionNumber}' to First Child Landmark '${label}' at Y=${match.y || match.top}`);
                        }
                    }
                }

                if (match) {
                    offsetY = match.y || match.top || 0;
                    offsetX = match.x || match.left || 0;
                }
            }
        }

        // 4. "Smart Sub-Question Anchor" (OCR Block Fallback)
        if (offsetX === 0 && offsetY === 0 && rawOcrBlocks && rawOcrBlocks.length > 0) {
            console.log(`\n🔍 [COORD-DEBUG] Inspecting Potential Offset Sources...`);
            console.log(`   👉 QuestionDetection Box: ${targetQuestionObject?.box ? 'Found' : 'undefined'}`);

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
                    offsetX = bCoords.x || 0;
                    offsetY = bCoords.y || 0;
                    console.log(`   🔍 [COORD-DEBUG] Using Sub-Question Anchor [${anchorBlock.id || anchorBlock.globalBlockId}] "${anchorBlock.text.substring(0, 20)}..." for Offset: x=${Math.round(offsetX)}, y=${Math.round(offsetY)}`);
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
                    return line;
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
