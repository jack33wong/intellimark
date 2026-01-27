import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';

const getPageDims = (pageDimensions: Map<number, any>, idx: number) => {
    if (pageDimensions?.has(idx)) return pageDimensions.get(idx);
    // Fallback logic for single page documents
    if (pageDimensions?.size === 1) return pageDimensions.values().next().value;
    return { width: 1000, height: 1000 };
};

/**
 * 🧲 THE MAGNET FIX: Find the precise OCR block that overlaps significantly with a rough estimate.
 */
function findOverlappingOCRBlock(
    target: { x: number; y: number; width: number; height: number },
    ocrBlocks: any[]
): any | null {
    let bestMatch = null;
    let maxIntersection = 0;

    for (const block of ocrBlocks) {
        if (!block.bbox) continue;

        const bx = block.bbox[0];
        const by = block.bbox[1];
        const bw = block.bbox[2];
        const bh = block.bbox[3];

        // Calculate Intersection Area
        const x_overlap = Math.max(0, Math.min(target.x + target.width, bx + bw) - Math.max(target.x, bx));
        const y_overlap = Math.max(0, Math.min(target.y + target.height, by + bh) - Math.max(target.y, by));
        const intersectionArea = x_overlap * y_overlap;

        // If it overlaps significantly, pick it
        if (intersectionArea > 0 && intersectionArea > maxIntersection) {
            maxIntersection = intersectionArea;
            bestMatch = block;
        }
    }

    // Only snap if the overlap is meaningful (e.g., covers > 30% of the target)
    const targetArea = target.width * target.height;
    if (targetArea > 0 && (maxIntersection / targetArea) > 0.3) {
        return bestMatch;
    }

    return null;
}

export const enrichAnnotationsWithPositions = (
    annotations: Annotation[],
    stepsDataForMapping: any[],
    questionId: string,
    defaultPageIndex: number = 0,
    pageDimensions?: Map<number, { width: number; height: number }>,
    classificationBlocks?: any[],
    task?: MarkingTask,
    visualObservation?: string,
    globalOffsetX: number = 0,
    globalOffsetY: number = 0,
    semanticZones?: Record<string, Array<{ startY: number; endY: number; pageIndex: number; x: number }>>
): EnrichedAnnotation[] => {


    // Helper: Find in Raw Classification Data (Percent 0-100)
    const findInClassification = (id: string) => {
        if (!classificationBlocks) return null;
        // const result = null; // This line was redundant
        for (const block of classificationBlocks) {
            if (block.studentWorkLines) {
                const match = block.studentWorkLines.find((l: any) => l.id === id);
                if (match) {
                    const blockIdx = block.pageIndex ?? defaultPageIndex;
                    const sourceBox = match.bbox || match.box || match.position;
                    /*
                    if (sourceBox && (isNaN(sourceBox[0]) || isNaN(sourceBox[1]))) {
                        console.log(`\x1b[31m[CLASSIFICATION-FIND-NaN] Q${questionId} ID: ${id} matched block has NaN in bbox: ${JSON.stringify(sourceBox)}\x1b[0m`);
                    }
                    console.log(`\x1b[35m[CLASSIFICATION-FIND] ID: ${id} | Found Box: ${JSON.stringify(sourceBox)} | Page: ${blockIdx}\x1b[0m`);
                    */
                    return { ...match, pageIndex: blockIdx };
                }
            }
            if (block.subQuestions) {
                for (const sub of block.subQuestions) {
                    if (sub.studentWorkLines) {
                        const match = sub.studentWorkLines.find((l: any) => l.id === id);
                        if (match) {
                            const blockIdx = block.pageIndex ?? defaultPageIndex;
                            const sourceBox = match.bbox || match.box || match.position;
                            /*
                            if (sourceBox && (isNaN(sourceBox[0]) || isNaN(sourceBox[1]))) {
                                console.log(`\x1b[31m[CLASSIFICATION-FIND-SUB-NaN] Q${questionId} ID: ${id} matched sub-block has NaN in bbox: ${JSON.stringify(sourceBox)}\x1b[0m`);
                            }
                            console.log(`\x1b[35m[CLASSIFICATION-FIND-SUB] ID: ${id} | Found Box: ${JSON.stringify(sourceBox)} | Page: ${blockIdx}\x1b[0m`);
                            */
                            return { ...match, pageIndex: blockIdx };
                        }
                    }
                }
            }
        }
        return null;
    };

    // Helper: Find in Processed Steps
    const findInSteps = (id: string) => stepsDataForMapping.find(s => s.line_id === id || s.globalBlockId === id || s.id === id);

    // [STAKING-FIX] Track coordinate reuse to prevent overlap
    const positionCounters = new Map<string, number>();

    return annotations.map((anno, idx) => {
        let pageIndex = (anno as any).pageIndex ?? defaultPageIndex;
        let method = "NONE";
        let rawBox: any = null;
        let forceLandmark = false;

        let lineId = (anno as any).line_id || "";
        const incomingStatus = (anno as any).ocr_match_status || "UNMATCHED";

        const rawVisualPos = (anno as any).visual_position || (anno as any).aiPosition || (anno as any).visualPosition;

        // ==================================================================================
        // 🛑 PATH 0: THE KILL SWITCH (VISUAL SOVEREIGNTY)
        // ==================================================================================
        if (incomingStatus === "VISUAL" && rawVisualPos) {
            const safePageIndex = (pageIndex < 0) ? defaultPageIndex : pageIndex;
            let dims = getPageDims(pageDimensions!, safePageIndex);
            if (!dims || !dims.width || !dims.height) {
                console.log(`[VISUAL-FIX-WARN] Dims missing for p${safePageIndex}. Using 1000x1000 fallback.`);
                dims = { width: 1000, height: 1000 };
            }

            const vPos = rawVisualPos;
            const pixelX = (vPos.x / 100) * dims.width;
            const pixelY = (vPos.y / 100) * dims.height;
            const pixelW = (vPos.width / 100) * dims.width;
            const pixelH = (vPos.height / 100) * dims.height;

            if (anno.subQuestion === "11a") {
                console.log(`[VISUAL-FIX] Q11a Sovereignty Applied. AI: ${vPos.y}% -> Px: ${pixelY}. Method: PATH_0_BYPASS`);
            }

            return {
                ...anno,
                bbox: [pixelX, pixelY, pixelW, pixelH],
                pageIndex: safePageIndex,
                ocr_match_status: "VISUAL",
                _debug_placement_method: "PATH_0_SOVEREIGNTY",
                unit: 'pixels'
            } as EnrichedAnnotation;
        }

        // ---------------------------------------------------------
        // PATH 1: PHYSICAL MATCH
        // ---------------------------------------------------------
        if (incomingStatus === "MATCHED" || (anno as any)._pipeline_action === "AI PRECISE (V4)") {
            const linkedId = (anno as any).linked_ocr_id || lineId;
            const matchInSteps = findInSteps(linkedId);
            if (matchInSteps && matchInSteps.bbox) {
                rawBox = {
                    x: matchInSteps.bbox[0], y: matchInSteps.bbox[1], width: matchInSteps.bbox[2], height: matchInSteps.bbox[3],
                    unit: (matchInSteps as any).unit || 'pixels'
                };
                pageIndex = matchInSteps.pageIndex ?? pageIndex;
                method = "PHYSICAL_MATCH";
            }
        }

        // ---------------------------------------------------------
        // PATH 2: SMART SNAP
        // ---------------------------------------------------------
        if (!rawBox && lineId && lineId.startsWith('p0_q')) {
            const match = findInSteps(lineId) || findInClassification(lineId);
            if (match && (match.bbox || match.box || match.position)) {
                const sourceBox = match.bbox || match.box || match.position;
                const sourceUnit = (match as any).unit || 'pixels';
                rawBox = Array.isArray(sourceBox)
                    ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3], unit: sourceUnit }
                    : { ...sourceBox, unit: sourceUnit };
                pageIndex = match.pageIndex ?? pageIndex;
                method = "SMART_SNAP";
            }
        }

        // ---------------------------------------------------------
        // PATH 2.5: AI VISUAL FALLBACK
        // ---------------------------------------------------------
        if (!rawBox && rawVisualPos) {
            rawBox = { ...rawVisualPos, unit: 'percentage' };
            (anno as any).ai_visual_position = rawBox;
            method = "VISUAL_AI";
        }

        // ---------------------------------------------------------
        // PATH 3: EMERGENCY LANDMARK (Veto Handler)
        // ---------------------------------------------------------
        // FIX: Explicitly handle UNMATCHED status (from Iron Dome Veto)
        // This ensures we enter the zone processing logic below.
        if (incomingStatus === "UNMATCHED") {
            method = "EMERGENCY";
            forceLandmark = true;
            // IMPORTANT: We KEEP the rawBox from Path 2.5 (Visual AI) if it exists.
            // We want "Classification X,Y" + "Zone Protect Y".
        }

        if (!rawBox) {
            method = "EMERGENCY";
            forceLandmark = true;
        }

        const dims = getPageDims(pageDimensions!, pageIndex);
        let offsetX = 0;
        let offsetY = 0;

        // ✨ NEW: Universal Clamping Variable
        let clampingOptions: { startY: number; endY: number; pad?: number } | undefined = undefined;

        if (semanticZones && (anno.subQuestion || (anno as any).sub_question)) {
            const subQRaw = (anno.subQuestion || (anno as any).sub_question || "").toLowerCase();
            const subQ = subQRaw.replace(/[()\s]/g, '');

            const allZoneKeys = Object.keys(semanticZones);
            let bestZoneKey = "";

            // 🛡️ [FIXED ZONE LOOKUP]: Correct Logic Order (Key ends with SubQ)
            // Sort keys by length (descending) to match "10bii" before "10bi" if colliding
            const sortedKeys = allZoneKeys.sort((a, b) => b.length - a.length);

            for (const key of sortedKeys) {
                const cleanKey = key.toLowerCase();
                // 1. Exact: "10bi" === "10bi"
                // 2. Suffix: "10bi".endsWith("bi") -> TRUE (Zone holds Question)
                // 3. Prefix: "bi".startsWith("10bi") -> FALSE
                if (cleanKey === subQ || cleanKey.endsWith(subQ) || subQ.endsWith(cleanKey)) {
                    bestZoneKey = key;
                    break;
                }
            }

            const matchingZones = bestZoneKey ? semanticZones[bestZoneKey] : [];

            if (matchingZones.length > 0) {
                const zone = matchingZones[0];

                if (isNaN(zone.startY)) {
                    console.log(`\x1b[31m[ENRICH-NaN-DEBUG] Q${questionId} SubQ "${subQRaw}" matched zone with NaN startY. Method: ${method}, ID: ${lineId}\x1b[0m`);
                }

                // 🛡️ [CLAMPING]: Define strict boundaries
                // This object is passed to resolvePixels to enforce "Zone Protect Y"
                if (zone.startY !== undefined && zone.endY !== undefined) {
                    clampingOptions = { startY: zone.startY, endY: zone.endY, pad: 5 };
                }

                // [OFFSET LOGIC]
                if (method === "EMERGENCY" || method === "VISUAL_AI" || (method === "NONE" && forceLandmark)) {
                    if (method === "NONE") method = "EMERGENCY";

                    // CRITICAL: If we have AI Visual Position (rawBox), we DO NOT add offsets (it's page relative).
                    // We only add offsets if we are generating a default fallback box from scratch.
                    if (rawBox && (rawBox as any).unit === 'percentage') {
                        offsetX = 0;
                        offsetY = 0;
                        // The rawBox (visual_position) will be processed by resolvePixels
                        // and CLAMPED by clampingOptions.
                    } else if (!rawBox) {
                        // True Emergency (No data): Use Zone Top
                        offsetX = zone.x || globalOffsetX;
                        offsetY = zone.startY || globalOffsetY;

                        // Create a default box in the zone
                        const fallbackBox = { x: 50, y: 50, width: 4, height: 3, unit: 'percentage' };
                        rawBox = fallbackBox;
                    }
                }
            }
        }

        const anchorKey = (anno as any).linked_ocr_id || lineId || "default";
        const count = positionCounters.get(anchorKey) || 0;
        positionCounters.set(anchorKey, count + 1);
        const stackingOffset = count > 0 ? count * 35 : 0;

        if (!rawBox) {
            const fallbackBox = { x: 50, y: 50, width: 4, height: 3, unit: 'percentage' };
            rawBox = rawVisualPos ? { ...rawVisualPos, unit: 'percentage' }
                : (anno as any).bbox ? { ...(anno as any).bbox, unit: 'percentage' }
                    : fallbackBox;
        }

        // [FIX]: Pass 'clampingOptions' to reuse existing logic
        // This effectively implements "Use Classification X,Y but Zone Protect Y"
        const pixelBox = CoordinateTransformationService.resolvePixels(
            rawBox,
            dims.width,
            dims.height,
            {
                offsetX,
                offsetY: offsetY + stackingOffset,
                context: `${method}-${lineId}`,
                clamping: clampingOptions // <--- The Enforcer
            }
        );

        return {
            ...anno,
            bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
            pageIndex: pageIndex,
            ocr_match_status: incomingStatus as any,
            _debug_placement_method: method,
            unit: 'pixels'
        } as EnrichedAnnotation;
    });
};
