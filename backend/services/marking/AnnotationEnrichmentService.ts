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
        if (!classificationBlocks || classificationBlocks.length === 0) return null;
        for (const block of classificationBlocks) {
            if (block.studentWorkLines) {
                const match = block.studentWorkLines.find((l: any) => l.id === id);
                if (match) return { ...match, pageIndex: block.pageIndex ?? defaultPageIndex };
            }
            if (block.subQuestions) {
                for (const sub of block.subQuestions) {
                    if (sub.studentWorkLines) {
                        const match = sub.studentWorkLines.find((l: any) => l.id === id);
                        if (match) return { ...match, pageIndex: block.pageIndex ?? defaultPageIndex };
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

        const lineId = (anno as any).line_id || "";
        const incomingStatus = (anno as any).ocr_match_status || "UNMATCHED";


        // ---------------------------------------------------------
        // PATH 1: PHYSICAL MATCH (High Confidence OCR)
        // ---------------------------------------------------------
        if (incomingStatus === "MATCHED" || (anno as any)._pipeline_action === "AI PRECISE (V4)") {
            const linkedId = (anno as any).linked_ocr_id || lineId;
            const matchInSteps = findInSteps(linkedId);
            if (matchInSteps && matchInSteps.bbox) {
                rawBox = { ...matchInSteps, x: matchInSteps.bbox[0], y: matchInSteps.bbox[1], width: matchInSteps.bbox[2], height: matchInSteps.bbox[3] };
                pageIndex = matchInSteps.pageIndex ?? pageIndex;
                method = "PHYSICAL_MATCH";
            }
        }

        // ---------------------------------------------------------
        // PATH 2: SMART SNAP (Handwriting Fidelity & Rectification)
        // ---------------------------------------------------------
        if (!rawBox && lineId && lineId.startsWith('p0_q')) {
            const match = findInSteps(lineId) || findInClassification(lineId);
            if (match && (match.bbox || match.box || match.position)) {
                const sourceBox = match.bbox || match.box || match.position;
                rawBox = Array.isArray(sourceBox)
                    ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3] }
                    : sourceBox;
                pageIndex = match.pageIndex ?? pageIndex;
                method = "SMART_SNAP";
            }
        }

        // ---------------------------------------------------------
        // PATH 2.1: COORDINATE SHIFT (The Missing Link)
        // ---------------------------------------------------------
        // If we are using Classification IDs (p0_q...), the coordinates
        // are GLOBAL to the page (Percent 0-100). We must SHIFT them to be relative
        // to the zone so that Clamping + Offset works correctly down the line.
        if (method === "SMART_SNAP" && rawBox && rawBox.unit === 'percentage' && semanticZones) {
            const subQ = (anno.subQuestion || "").toLowerCase();
            const matchingZones = (semanticZones[subQ] || []);
            if (matchingZones.length > 0) {
                const zone = matchingZones[0];
                const pageHeight = getPageDims(pageDimensions!, pageIndex).height || 2000;
                // Shift Y to be relative to Zone Start
                rawBox.y = rawBox.y - ((zone.startY / pageHeight) * 100);
            }
        }

        // ---------------------------------------------------------
        // PATH 2.5: VISUAL SNAP (Drawing Fallback)
        // ---------------------------------------------------------
        if (!rawBox && incomingStatus === "VISUAL") {
            const drawingMatch = stepsDataForMapping.find(s =>
                (s.line_id && s.line_id.includes('_drawing_')) ||
                (s.text && s.text.includes('[DRAWING]'))
            );
            if (drawingMatch) {
                const sourceBox = drawingMatch.bbox || drawingMatch.box || drawingMatch.position;
                rawBox = Array.isArray(sourceBox)
                    ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3] }
                    : sourceBox;
                pageIndex = drawingMatch.pageIndex ?? pageIndex;
                method = "VISUAL_SNAP";
            }
        }

        // ---------------------------------------------------------
        // PATH 3: EMERGENCY LANDMARK (Data Absence Fallback)
        // ---------------------------------------------------------
        if (!rawBox) {
            method = "EMERGENCY";
            forceLandmark = true;
        }

        // 🏗️ RESOLVE LANDMARKS & OFFSETS
        const dims = getPageDims(pageDimensions!, pageIndex);
        let offsetX = 0;
        let offsetY = 0;
        let clamping: any = undefined;

        if (semanticZones && (anno.subQuestion || (anno as any).sub_question)) {
            const subQRaw = (anno.subQuestion || (anno as any).sub_question || "").toLowerCase();
            // 🛡️ [PARSING-FIX] Do NOT strip leading digits. "12" should remain "12" to match zone "12".
            const subQ = subQRaw.replace(/[()\s]/g, '');

            const allZoneKeys = Object.keys(semanticZones);
            let bestSuffixKey = "";
            for (const key of allZoneKeys) {
                if (subQ.endsWith(key) && key.length > bestSuffixKey.length) {
                    bestSuffixKey = key;
                }
            }

            const matchingZones = (semanticZones[subQ] || [])
                .concat(bestSuffixKey ? (semanticZones[bestSuffixKey] || []) : [])
                .concat(subQ.length > 1 ? (semanticZones[subQ.charAt(0)] || []) : []);

            if (matchingZones.length > 0) {
                const zone = matchingZones[0];
                clamping = { startY: zone.startY, endY: zone.endY };

                // 🛡️ [RECTIFICATION] Snap-Back Logic: If Snap is out of zone, snap to the opposite boundary to ensure legal placement.
                if (method === "SMART_SNAP") {
                    const tempBox = CoordinateTransformationService.ensurePixels(rawBox, dims.width, dims.height);
                    if (tempBox.y < zone.startY || tempBox.y > zone.endY) {
                        const isDropped = tempBox.y > zone.endY;

                        // IF DROPPED (too low) -> SNAP TO BOTTOM (Highest Y) - HEIGHT (to fit inside)
                        // IF POPPED (too high) -> SNAP TO TOP (Lowest Y)

                        // [PADDING-FIX] User requested padding based on block height.
                        // If we snap Y to endY, the block hangs OUTSIDE. We must subtract height.
                        const padding = isDropped ? (tempBox.height || 20) : 0;
                        const rectifiedY = isDropped ? (zone.endY - padding) : zone.startY;

                        const label = isDropped ? "HIGHEST (BOTTOM - HEIGHT)" : "LOWEST (TOP)";

                        // console.log(`   🛡️ [RECTIFICATION] Q${questionId}${subQ} Snap at ${Math.round(tempBox.y)}px rectified to ${label} of zone (${rectifiedY}px). Preserving X.`);

                        rawBox = {
                            x: tempBox.x,
                            y: rectifiedY,
                            width: tempBox.width,
                            height: tempBox.height,
                            unit: 'pixels'
                        };
                    }
                }

                if (method === "EMERGENCY" || (method === "NONE" && forceLandmark)) {
                    if (method === "NONE") method = "EMERGENCY";
                    offsetX = zone.x || globalOffsetX;
                    offsetY = zone.startY || globalOffsetY;

                    // [V29 FIX] Always trust AI visual position or bbox if available, even without classification ID.
                    // DO NOT fallback to margin or (0,0) unless absolutely necessary.
                    rawBox = (anno as any).visual_position || (anno as any).bbox || { x: 50, y: 50, width: 4, height: 3, unit: 'percentage' };
                }
            }
        }

        // [STAKING-FIX] Calculate stacking BEFORE the universal gate
        const anchorKey = (anno as any).linked_ocr_id || lineId || "default";
        const count = positionCounters.get(anchorKey) || 0;
        positionCounters.set(anchorKey, count + 1);
        const stackingOffset = count > 0 ? count * 35 : 0;

        // 🏁 THE UNIVERSAL GATE
        if (!rawBox) {
            rawBox = (anno as any).visual_position || (anno as any).bbox || { x: 50, y: 50, width: 4, height: 3, unit: 'percentage' };
        }

        const pixelBox = CoordinateTransformationService.resolvePixels(
            rawBox,
            dims.width,
            dims.height,
            { offsetX, offsetY: offsetY + stackingOffset, clamping, context: `${method}-${lineId}` }
        );


        return {
            ...anno,
            bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
            pageIndex: pageIndex,
            ocr_match_status: incomingStatus as any,
            _debug_placement_method: method
        } as EnrichedAnnotation;
    });
};
