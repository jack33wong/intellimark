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
    classificationBlocks?: any[], // Unused, kept for signature compatibility
    task?: MarkingTask,
    visualObservation?: string,
    globalOffsetX: number = 0,
    globalOffsetY: number = 0,
    semanticZones?: Record<string, Array<{ startY: number; endY: number; pageIndex: number; x: number }>>
): EnrichedAnnotation[] => {

    // Helper: Lookup Text or Handwriting blocks (Flat Array Search)
    const findInData = (id: string) => stepsDataForMapping.find(s => s.line_id === id || s.globalBlockId === id || s.id === id);

    return annotations.map((anno, idx) => {
        let pageIndex = (anno as any).pageIndex ?? defaultPageIndex;
        let method = "NONE";
        let rawBox: any = null;

        // 1. READ STATUS (Trust Executor)
        let status = (anno as any).ocr_match_status || "UNMATCHED";
        const targetId = (anno as any).linked_ocr_id;
        const lineId = (anno as any).line_id;
        const rawVisualPos = (anno as any).visual_position || (anno as any).aiPosition;

        // 2. SELECT SOURCE (Strict Logic)
        if (status === "MATCHED" && targetId) {
            // [PATH A] MATCHED -> Use Text ID
            const match = findInData(targetId);
            if (match) {
                const sourceBox = match.bbox || match.position;
                // [FIX 1] Respect Upstream Unit
                const unit = match.unit || 'pixels';

                rawBox = Array.isArray(sourceBox)
                    ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3], unit }
                    : { ...sourceBox, unit };
                method = "DIRECT_LINK";
            }
        }
        else if (status === "VISUAL" && rawVisualPos) {
            // [PATH B] VISUAL -> Use AI Coords
            rawBox = { ...rawVisualPos, unit: 'percentage' };
            method = "VISUAL_COORDS";
        }
        else {
            // [PATH C] UNMATCHED -> Use Handwriting (line_id)
            if (lineId) {
                const match = findInData(lineId);
                if (match) {
                    const sourceBox = match.bbox || match.position;
                    // [FIX 1] Respect Upstream Unit (Likely 'percentage' for Handwriting)
                    const unit = match.unit || 'pixels';

                    // [DEBUG LOG] Show exactly what we found
                    console.log(`[ENRICH-DEBUG] Q${anno.subQuestion} UNMATCHED | LineID: ${lineId} | Found: X=${sourceBox[0] ?? sourceBox.x}, Y=${sourceBox[1] ?? sourceBox.y}, UNIT=${unit}`);

                    rawBox = Array.isArray(sourceBox)
                        ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3], unit }
                        : { ...sourceBox, unit };

                    method = "ZONE_PROTECTED_HANDWRITING";
                } else {
                    console.warn(`[ENRICH-WARN] Q${anno.subQuestion} UNMATCHED | LineID: ${lineId} | NOT FOUND in stepsDataForMapping.`);
                }
            }

            // FAIL FAST: If UNMATCHED and no handwriting found -> CRASH.
            if (!rawBox) {
                const availableIds = stepsDataForMapping.slice(0, 5).map(s => s.line_id).join(', ');
                throw new Error(`[RENDERER-FAIL] Annotation ${anno.subQuestion} is UNMATCHED and has no handwriting source (line_id: ${lineId}). Sample IDs: ${availableIds}...`);
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

        if (method === "ZONE_PROTECTED_HANDWRITING") {
            console.log(`[ENRICH-DEBUG] Q${anno.subQuestion} Resolved Pixels: X=${pixelBox.x}, Y=${pixelBox.y} (Page H=${dims.height})`);
        }

        // 4. APPLY ZONE PROTECTION (Post-Resolution)
        // Now that we have absolute pixels, we can strictly enforce the Vertical Zone.
        if (method === "ZONE_PROTECTED_HANDWRITING" && semanticZones) {
            const zone = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);
            if (zone) {
                const originalY = pixelBox.y;

                // RULE: If Y is ABOVE zone start, Force to zone start.
                if (pixelBox.y < zone.startY) {
                    pixelBox.y = zone.startY;
                }

                // RULE: If Y is BELOW zone end, Force to zone end.
                if (zone.endY && pixelBox.y > zone.endY) {
                    pixelBox.y = Math.max(zone.startY, zone.endY - (pixelBox.height || 10));
                }

                if (pixelBox.y !== originalY) {
                    console.log(`[ENRICH-DEBUG] Q${anno.subQuestion} CLAMPED Y: ${originalY} -> ${pixelBox.y} (Zone: ${zone.startY}-${zone.endY})`);
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