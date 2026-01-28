import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';
import { AnnotationCollisionService } from './AnnotationCollisionService.js';

const getPageDims = (pageDimensions: Map<number, any>, idx: number) => {
    if (pageDimensions?.has(idx)) return pageDimensions.get(idx);
    if (pageDimensions?.size === 1) return pageDimensions.values().next().value;
    return { width: 1000, height: 1000 };
};

// Helper: Check if two mark codes are "The Same Type"
// e.g. "M1" and "M0" are equivalent (Method Mark type)
// e.g. "A1" and "M0" are NOT equivalent (Accuracy vs Method)
const areMarkCodesEquivalent = (tickCode: string, crossCode: string): boolean => {
    // 1. Strict Match (e.g. "M1" hides "M1")
    if (tickCode === crossCode) return true;

    // 2. Zero-Code Matching (e.g. "M1" hides "M0")
    const tickType = tickCode.charAt(0).toUpperCase();
    const crossType = crossCode.charAt(0).toUpperCase();

    // Check if the cross is a "Zero" version (ends in 0) AND types match
    if (crossCode.endsWith('0') && tickType === crossType) {
        return true;
    }

    return false;
};

// Logic: Hide Crosses ONLY if a Tick of the SAME CODE exists on the same line
const applyPositiveDominance = (annotations: EnrichedAnnotation[]): EnrichedAnnotation[] => {
    // 1. Map lines to their Awarded Marks (Ticks)
    const lineTicksMap = new Map<string, string[]>();

    annotations.forEach(anno => {
        // Use linked_ocr_id as it is already resolved in the enriched loop
        const lineId = anno.linked_ocr_id;
        if (lineId && anno.action === 'tick' && (anno.text || anno.classification_text)) {
            if (!lineTicksMap.has(lineId)) {
                lineTicksMap.set(lineId, []);
            }
            const markText = anno.text || anno.classification_text || "";
            lineTicksMap.get(lineId)?.push(markText);
        }
    });

    // 2. Filter out Crosses that are dominated by an equivalent Tick
    return annotations.filter(anno => {
        const lineId = anno.linked_ocr_id;
        const markText = anno.text || anno.classification_text;
        if (anno.action === 'cross' && lineId && markText) {
            const ticksOnThisLine = lineTicksMap.get(lineId);

            if (ticksOnThisLine) {
                // Check if ANY tick on this line is "Equivalent" to this cross
                const hasDominantTick = ticksOnThisLine.some(tickCode =>
                    areMarkCodesEquivalent(tickCode, markText)
                );

                if (hasDominantTick) {
                    // HIDE THIS CROSS (Positive Dominance)
                    return false;
                }
            }
        }
        return true; // Keep everything else
    });
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
                    // FIX: Ensure we respect the source unit (often 'percentage' for classification blocks)
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
                // Clamp unless it's a direct text match (which we trust implicitly)
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
        // Resolve input pointers. Use line_id OR targetId (whichever was used for positioning)
        const activePointer = lineId || targetId;
        const contentDesc = (anno as any).contentDesc || (anno as any).content_desc;

        let studentText = "";
        let classText = (anno as any).classification_text || "";

        if (activePointer) {
            // [PATH A] Text/Handwriting Pointer -> Hydrate from Ground Truth
            const match = findInData(activePointer);
            if (match) {
                studentText = match.text || match.cleanedText || "";
                classText = match.text || match.cleanedText || "";

                // ✅ SAFE HYDRATION: We set debug method, but we DO NOT FORCE STATUS.
                // Keeping status as 'UNMATCHED' allows the Collision Service to move it.
                method = "POINTED_TEXT";
            } else {
                console.warn(`🚨 [ORPHAN] AI returned ID '${activePointer}' which does not exist in source data.`);
                // We don't change status here to avoid breaking downstream flow, 
                // but strictly speaking, this is a data integrity error.
            }
        } else {
            // [PATH B] Drawing/Visual Value
            const rawDesc = contentDesc || (anno as any).reasoning || "";
            const cleanDesc = rawDesc.replace('[DRAWING]', '').trim();
            studentText = cleanDesc ? `[DRAWING] ${cleanDesc}` : "[Drawing/Graph]";

            // SIMPLIFIED: Drawings never show blue text overlays.
            classText = "";

            method = "VISUAL_VALUE";
            // Ensure status is VISUAL if we relied on visual coords
            if (status === "UNMATCHED") status = "VISUAL";
        }

        return {
            ...anno,
            bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
            pageIndex: pageIndex,
            ocr_match_status: status as any,
            linked_ocr_id: activePointer,
            student_text: studentText,   // snake_case for DB/Logs
            studentText: studentText,    // camelCase for Frontend
            classification_text: classText,
            classificationText: classText,
            _debug_placement_method: method,
            unit: 'pixels'
        } as EnrichedAnnotation;
    });

    // 🚀 Apply Refined Positive Dominance Filter
    const cleanAnnotations = applyPositiveDominance(enriched);

    // Then apply physics to whatever remains
    return AnnotationCollisionService.resolveCollisions(cleanAnnotations, semanticZones);
};