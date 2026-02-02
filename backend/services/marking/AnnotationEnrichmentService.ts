import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';
import { AnnotationCollisionService } from './AnnotationCollisionService.js';
import { latexToPlainText } from '../../utils/TextNormalizationUtils.js';

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
        let lineId = (anno as any).line_id;
        let targetId = (anno as any).linked_ocr_id;
        let activePointer = lineId || targetId;
        const rawVisualPos = (anno as any).visual_position || (anno as any).aiPosition;

        // 🛡️ ORPHAN RESCUE: Handle "Unmatched" marks with no handwriting source
        if (status === "UNMATCHED" && !lineId && rawVisualPos) {
            console.warn(`[RESCUE] Annotation ${anno.subQuestion} is UNMATCHED with no line_id. Promoting to VISUAL using AI coordinates.`);
            status = "VISUAL";
        }

        // =====================================================================
        // 🛡️ IRON DOME: SILO & PAGE ENFORCEMENT
        // =====================================================================
        let source = findInData(activePointer);

        if (source && source.subQuestionLabel && anno.subQuestion) {
            const normalize = (s: string) => s.replace(/\d+|question|part/gi, '').trim().toLowerCase();
            const annoLabel = normalize(anno.subQuestion);
            const sourceLabel = normalize(source.subQuestionLabel);

            // 1. DETERMINE TRUTH PAGE
            let trueZonePage = -1;
            if (semanticZones) {
                const zone = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);
                if (zone) trueZonePage = zone.pageIndex;
            }

            // �️ [SMART OVERRIDE]: If Visual + P1 Candidate exists, Trust P1 over Zone Detector
            if ((status === 'VISUAL' || (anno.text || '').includes('B')) && trueZonePage === 0) {
                const p1Candidate = stepsDataForMapping.find(s =>
                    s.subQuestionLabel && normalize(s.subQuestionLabel) === annoLabel && s.pageIndex === 1
                );
                if (p1Candidate) trueZonePage = 1;
            }

            // 2. DETECT VIOLATION
            const labelMismatch = (annoLabel && sourceLabel && annoLabel !== sourceLabel && sourceLabel !== 'main');
            const pageMismatch = (trueZonePage !== -1 && source.pageIndex !== undefined && source.pageIndex !== trueZonePage);

            if (labelMismatch || pageMismatch) {
                // 3. SEARCH REPLACEMENT
                let candidates = stepsDataForMapping.filter(s =>
                    s.subQuestionLabel && normalize(s.subQuestionLabel) === annoLabel
                );

                // Prioritize Correct Page
                if (pageMismatch) {
                    const pageSpecific = candidates.filter(s => s.pageIndex === trueZonePage);
                    if (pageSpecific.length > 0) candidates = pageSpecific;
                }

                if (candidates.length > 0) {
                    // Sort: Visuals first
                    candidates.sort((a, b) => (a.text.includes('VISUAL') ? -1 : 1));
                    const best = candidates[0];

                    // 4. SNAP & UPDATE
                    lineId = best.line_id;
                    targetId = best.line_id;

                    (anno as any).line_id = best.line_id;
                    (anno as any).linked_ocr_id = best.line_id;

                    // 🚨 CRITICAL: Physically move the annotation to the new page
                    (anno as any).pageIndex = best.pageIndex;
                    pageIndex = best.pageIndex;

                    // 🚨 FIX: Don't force MATCHED. Keep VISUAL if it was VISUAL.
                    if (status === "UNMATCHED") status = "MATCHED"; // Only promote if lost

                    console.log(`✅ [IRON-DOME] Snapped mark to: ${lineId} (P${best.pageIndex})`);
                }
            }
        }
        // =====================================================================

        // 2. SELECT SOURCE (Modified to allow VISUAL + ID)
        // [FIX]: Allow VISUAL status to use Direct Link (Path A) if it has an ID
        if ((status === "MATCHED" || status === "VISUAL") && targetId) {
            // [PATH A] DIRECT LINK (Text OR Visual Placeholder)
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
            // [PATH B] VISUAL COORDS (Fallback)
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

            // 🛡️ [SAFETY FIX]: Fallback to Zone Start if box is still missing
            if (!rawBox) {
                console.warn(`[RENDERER-WARN] Annotation ${anno.subQuestion} is UNMATCHED and has no position. Falling back to zone start.`);
                const zone = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);
                if (zone) {
                    rawBox = { x: zone.x || 0, y: zone.startY, width: 200, height: 40, unit: 'pixels' };
                    pageIndex = zone.pageIndex;
                    method = "FALLBACK_ZONE_START";
                } else {
                    // Total failure - fallback to top of default page
                    rawBox = { x: 0, y: 0, width: 200, height: 40, unit: 'pixels' };
                    method = "TOTAL_FALLBACK";
                }
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

        // ✅ SAFETY CHECK: If pixels is null (mapping failed), return annotation without position
        // or use a default safe position to prevent the entire worker from crashing.
        if (!pixelBox) {
            console.warn(`⚠️ [ANNO-WARN] Could not resolve pixels for annotation '${(anno as any).text}' on Page ${pageIndex}. Skipping position.`);
            return { ...anno, position: null } as EnrichedAnnotation;
        }

        // 4. STRICT ZONE CLAMPING (Universal)
        if (semanticZones) {
            const zone = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);

            // 🛡️ [FIX]: PAGE-AWARE CLAMPING
            // Only clamp if the annotation is on the SAME PAGE as the defined zone.
            // This prevents P0 constraints (bottom of page) from dragging down P1 marks (top of page).
            if (zone && zone.pageIndex === pageIndex) {

                const startY = zone.startY;
                const endY = zone.endY;

                const h = pixelBox.height || (dims.height * 0.015); // Default ~50px if missing

                // Trust MATCHED status implicitly (Design rule)
                if (status !== "MATCHED") {
                    // FOOTPRINT-AWARE CHECK: If bottom edge breaches, pull back.
                    if (pixelBox.y < startY) {
                        pixelBox.y = startY + (dims.height * 0.10); // 10% Pull-back
                    }
                    if (endY && (pixelBox.y + h) > endY) {
                        pixelBox.y = endY - h - (dims.height * 0.10); // 10% Pull-back + clear the object height
                    }
                }
            } else if (zone && zone.pageIndex !== pageIndex) {
                console.log(`   🔓 [ZONE-SKIP] Skipping clamping for Q${anno.subQuestion}. Anno P${pageIndex} != Zone P${zone.pageIndex}`);
            }
        }

        // 5. HYDRATION (Pointer vs Value Strategy - Single Source of Truth)
        // Resolve input pointers. Use line_id OR targetId (whichever was used for positioning)
        // NOTE: We rely on 'activePointer' which we might have updated in the Iron Dome block
        activePointer = lineId || targetId;
        const contentDesc = (anno as any).contentDesc || (anno as any).content_desc;

        let studentText = "";
        let classText = (anno as any).classification_text || "";

        if (activePointer) {
            // [PATH A] Text/Handwriting Pointer
            const match = findInData(activePointer);
            if (match) {
                studentText = match.text || match.cleanedText || "";
                classText = match.text || match.cleanedText || "";

                // 🛡️ [FIX]: HIDE BLUE TEXT FOR VISUAL PLACEHOLDERS
                // If we snapped to a visual placeholder, don't show "[VISUAL WORKSPACE]" as blue text.
                if (studentText.includes('VISUAL') || studentText.includes('DRAWING')) {
                    classText = ""; // Hide overlay
                    studentText = "[Drawing/Graph]"; // Friendly label
                    method = "VISUAL_VALUE";
                } else {
                    method = "POINTED_TEXT";
                }
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

        // 🛡️ REDUNDANCY PROTECTION: Don't show blue text if it is already MATCHED
        // We only show blue overlays for UNMATCHED, FALLBACK, or VISUAL to explain layout.
        if (status === "MATCHED") {
            classText = "";
        }

        return {
            ...anno,
            bbox: [pixelBox.x, pixelBox.y, pixelBox.width, pixelBox.height],
            pageIndex: pageIndex,
            ocr_match_status: status as any,
            linked_ocr_id: activePointer,
            student_text: latexToPlainText(studentText),   // [FIXED] Sanitize for SVG
            studentText: latexToPlainText(studentText),    // [FIXED] Sanitize for Frontend
            classification_text: latexToPlainText(classText), // [FIXED] Sanitize for SVG
            classificationText: latexToPlainText(classText), // [FIXED] Sanitize for Frontend
            _debug_placement_method: method,
            unit: 'pixels'
        } as EnrichedAnnotation;
    });

    // 🚀 Apply Refined Positive Dominance Filter
    const cleanAnnotations = applyPositiveDominance(enriched);

    // Then apply physics to whatever remains
    return AnnotationCollisionService.resolveCollisions(cleanAnnotations, semanticZones);
};