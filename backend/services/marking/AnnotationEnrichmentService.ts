import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';
import { AnnotationCollisionService } from './AnnotationCollisionService.js';

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

    const enriched = annotations.map((anno, idx) => {
        // ... existing logic ...
        let pageIndex = (anno as any).pageIndex ?? defaultPageIndex;
        let method = "NONE";
        let rawBox: any = null;

        // 1. READ STATUS
        let status = (anno as any).ocr_match_status || "UNMATCHED";
        const targetId = (anno as any).linked_ocr_id;
        const lineId = (anno as any).line_id;
        const rawVisualPos = (anno as any).visual_position || (anno as any).aiPosition;

        // 🛡️ ORPHAN RESCUE: Handle "Unmatched" marks with no handwriting source
        if (status === "UNMATCHED" && !lineId && rawVisualPos) {
            console.warn(`[RESCUE] Annotation ${anno.subQuestion} is UNMATCHED with no line_id. Promoting to VISUAL using AI coordinates.`);
            status = "VISUAL";
        }

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
            rawBox = { ...rawVisualPos, unit: 'percentage' };
            method = "VISUAL_COORDS";
        }
        else {
            // [PATH C] UNMATCHED -> Use Handwriting (line_id)
            if (lineId) {
                const match = findInData(lineId);
                if (match) {
                    const sourceBox = match.bbox || match.position;
                    const unit = match.unit || 'pixels';

                    rawBox = Array.isArray(sourceBox)
                        ? { x: sourceBox[0], y: sourceBox[1], width: sourceBox[2], height: sourceBox[3], unit }
                        : { ...sourceBox, unit };

                    method = "ZONE_PROTECTED_HANDWRITING";
                }
            }

            // FAIL FAST
            if (!rawBox) {
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
        if (semanticZones) {
            const zone = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);
            if (zone) {
                if (status !== "MATCHED") {
                    if (pixelBox.y < zone.startY) {
                        pixelBox.y = zone.startY;
                    }
                    if (zone.endY && pixelBox.y > zone.endY) {
                        pixelBox.y = Math.max(zone.startY, zone.endY - (pixelBox.height || 10));
                    }
                }
            }
        }

        // 5. HYDRATION (Pointer vs Value Strategy - Single Source of Truth)
        // Resolve input pointers (AI raw: line_id)
        const lineIdPointer = (anno as any).line_id;
        const contentDesc = (anno as any).contentDesc || (anno as any).content_desc;

        let studentText = "";
        let classText = (anno as any).classification_text || "";

        if (lineIdPointer) {
            // [PATH A] Text Pointer -> Hydrate from Ground Truth
            const match = findInData(lineIdPointer);
            if (match) {
                studentText = match.text || match.cleanedText || "";
                classText = match.text || match.cleanedText || "";

                // Enforce Rule: If we have a pointer, we don't need visual coordinates
                method = "POINTED_TEXT";
                status = "MATCHED";
            } else {
                // [STRICT] Don't guess. Log the specific missing ID.
                console.warn(`🚨 [ORPHAN] AI returned line_id '${lineIdPointer}' which does not exist in source data.`);
                status = "ORPHAN";
            }
        } else {
            // [PATH B] Drawing/Visual Value
            // Use the AI's description or fallback to reasoning
            const rawDesc = contentDesc || (anno as any).reasoning || "";
            const cleanDesc = rawDesc.replace('[DRAWING]', '').trim();
            studentText = cleanDesc ? `[DRAWING] ${cleanDesc}` : "[Drawing/Graph]";

            method = "VISUAL_VALUE";
            status = "VISUAL";
        }

        return {
            ...anno,
            bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
            pageIndex: pageIndex,
            ocr_match_status: status as any,
            linked_ocr_id: lineIdPointer,
            student_text: studentText,   // snake_case for DB/Logs
            studentText: studentText,    // camelCase for Frontend
            classification_text: classText,
            classificationText: classText,
            _debug_placement_method: method,
            unit: 'pixels'
        } as EnrichedAnnotation;
    });

    // 🚀 NEW: FINAL PHYSICS PASS
    // This runs AFTER the basic Zone Clamping to fix local overlaps
    return AnnotationCollisionService.resolveCollisions(enriched, semanticZones);
};