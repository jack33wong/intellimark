import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';

const getPageDims = (pageDimensions: Map<number, any>, idx: number) => {
    if (pageDimensions?.has(idx)) return pageDimensions.get(idx);
    if (pageDimensions?.size === 1) return pageDimensions.values().next().value;
    return { width: 1000, height: 1000 };
};

export const enrichAnnotationsWithPositions = (
    annotations: Annotation[],
    stepsDataForMapping: any[],
    questionId: string,
    defaultPageIndex: number = 0,
    pageDimensions?: Map<number, { width: number; height: number }>,
    classificationBlocks?: any[], // Unused
    task?: MarkingTask,
    visualObservation?: string,
    globalOffsetX: number = 0,
    globalOffsetY: number = 0,
    semanticZones?: Record<string, Array<{ startY: number; endY: number; pageIndex: number; x: number }>>
): EnrichedAnnotation[] => {

    // Helper: Lookup Text or Handwriting blocks
    const findInData = (id: string) => stepsDataForMapping.find(s => s.line_id === id || s.globalBlockId === id || s.id === id);

    return annotations.map((anno, idx) => {
        let pageIndex = (anno as any).pageIndex ?? defaultPageIndex;
        let method = "NONE";
        let rawBox: any = null;

        // 1. READ STATUS
        let status = (anno as any).ocr_match_status || "UNMATCHED";
        const targetId = (anno as any).linked_ocr_id;
        const lineId = (anno as any).line_id;
        const rawVisualPos = (anno as any).visual_position || (anno as any).aiPosition;

        // 2. SELECT SOURCE
        if (status === "MATCHED" && targetId) {
            // [PATH A] MATCHED -> Use Text ID
            const match = findInData(targetId);
            if (match) {
                const sourceBox = match.bbox || match.position;
                const unit = match.unit || 'pixels';

                rawBox = Array.isArray(sourceBox)
                    ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3], unit }
                    : { ...sourceBox, unit };
                method = "DIRECT_LINK";
            }
        }
        else if (status === "VISUAL" && rawVisualPos) {
            // [PATH B] VISUAL -> Use AI Coords
            // STRICT DESIGN: We trust these coords raw. If they are garbage (50% page), 
            // we will let them be garbage pixels, and CLAMP them later.
            rawBox = { ...rawVisualPos, unit: 'percentage' };
            method = "VISUAL_COORDS";
        }
        else {
            // [PATH C] UNMATCHED -> Use Handwriting (line_id)
            if (lineId) {
                const match = findInData(lineId);
                if (match) {
                    const sourceBox = match.bbox || match.position;
                    // FIX: Respect the unit from classification (likely 'percentage')
                    const unit = match.unit || 'pixels';

                    rawBox = Array.isArray(sourceBox)
                        ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3], unit }
                        : { ...sourceBox, unit };

                    method = "ZONE_PROTECTED_HANDWRITING";
                }
            }

            // FAIL FAST
            if (!rawBox) {
                const availableIds = stepsDataForMapping.slice(0, 5).map(s => s.line_id).join(', ');
                throw new Error(`[RENDERER-FAIL] Annotation ${anno.subQuestion} is UNMATCHED and has no handwriting source (line_id: ${lineId}).`);
            }
        }

        // 3. TRANSFORM (Resolve to Absolute Pixels)
        const dims = getPageDims(pageDimensions!, pageIndex);

        const pixelBox = CoordinateTransformationService.resolvePixels(
            rawBox,
            dims.width,
            dims.height,
            {
                offsetX: 0,
                offsetY: 0,
                context: `${method}-${targetId || lineId}`
            }
        );

        // 4. STRICT ZONE CLAMPING (Universal)
        // Applies to UNMATCHED (Handwriting) AND VISUAL (Drawings)
        // We do NOT use "Smart" centering. We just Hard Clamp to the boundary.
        if (semanticZones) {
            const zone = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);
            if (zone) {
                // ONLY Clamp if it's NOT a Direct Text Match
                // (We trust OCR text locations implicitly, but we clamp everything else)
                if (status !== "MATCHED") {

                    // RULE: If Y is ABOVE zone start, Force to zone start.
                    if (pixelBox.y < zone.startY) {
                        pixelBox.y = zone.startY;
                    }

                    // RULE: If Y is BELOW zone end, Force to zone end.
                    // (Even if AI gave us 50% Page Height, we drag it all the way up/down to the edge)
                    if (zone.endY && pixelBox.y > zone.endY) {
                        pixelBox.y = Math.max(zone.startY, zone.endY - (pixelBox.height || 10));
                    }
                }
            }
        }

        return {
            ...anno,
            bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
            pageIndex: pageIndex,
            ocr_match_status: status,
            linked_ocr_id: targetId,
            _debug_placement_method: method,
            unit: 'pixels'
        } as EnrichedAnnotation;
    });
};