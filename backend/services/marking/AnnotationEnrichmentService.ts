import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';
import { CoordinateAuditLogger } from '../../utils/LoggerUtils.js';
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

    // Helper: Lookup Text or Handwriting blocks (supports [ID-LIE] relative IDs)
    const findInData = (id: string) => stepsDataForMapping.find(s =>
        s.line_id === id ||
        s.globalBlockId === id ||
        s.id === id ||
        s.relative_line_id === id ||
        (s as any).relative_id === id
    );

    const enriched = annotations.map((anno, idx) => {
        let pageIndex = (anno as any).pageIndex ?? defaultPageIndex;

        // 🛡️ [TRUTH-FIRST]: Trust the physical page index if confirmed.
        // Otherwise, resolve relative to task configuration.
        if (!(anno as any).isPhysicalPage) {
            if (task?.pageMap) {
                // Check if pageIndex is a relative index in the map values
                const absPage = Object.entries(task.pageMap).find(([abs, rel]) => rel === pageIndex)?.[0];
                if (absPage !== undefined) {
                    pageIndex = parseInt(absPage);
                }
            } else if (task?.sourcePages && pageIndex < task.sourcePages.length) {
                // Fallback to sourcePages array index
                pageIndex = task.sourcePages[pageIndex];
            }
        }

        let method = "NONE";
        let hasLineData: boolean | undefined = undefined;
        let isSplitBlock: boolean | undefined = (anno as any).isSplitBlock;
        let rawBox: any = null;

        // 1. READ STATUS
        let status = (anno as any).ocr_match_status || "UNMATCHED";
        let lineId = (anno as any).line_id;
        let targetId = (anno as any).linked_ocr_id || (anno.linked_ocr_id as any);
        let activePointer = targetId || lineId; // 🛡️ [PRIORITY]: Prefer the OCR Match (targetId) over the raw line source.
        const rawVisualPos = (anno as any).visual_position || (anno as any).aiPosition;

        // 🛡️ ORPHAN RESCUE: Handle "Unmatched" marks with no handwriting source
        if (status === "UNMATCHED" && !lineId && rawVisualPos) {
            console.warn(`[RESCUE] Annotation ${anno.subQuestion} is UNMATCHED with no line_id. Promoting to VISUAL using AI coordinates.`);
            status = "VISUAL";
        }

        // 🛡️ [HIGH-PAGE PREFERENCE]: For Drawings/Visuals on multi-page questions.
        // If AI didn't provide a specific ID, default to the HIGHEST valid page index.
        // 🚨 [PARENT-AWARE FIX]: Only shift if target page belongs to same main question.
        if (status === "VISUAL" && !activePointer && semanticZones) {
            const currentQuestionId = (questionId || "").replace(/\D/g, '');
            const zones = ZoneUtils.findAllMatchingZones(anno.subQuestion, semanticZones, currentQuestionId);
            if (zones.length > 1) {
                const highestPage = Math.max(...zones.map(z => z.pageIndex));

                // Extract parent question number (e.g., "11b" -> "11", "5a" -> "5")
                const getParentQuestion = (label: string) => label.replace(/[a-z()]/gi, '').trim();

                const currentParent = getParentQuestion(anno.subQuestion || '');
                const currentZone = zones.find(z => z.pageIndex === pageIndex);
                const targetZone = zones.find(z => z.pageIndex === highestPage);

                // Check if target page belongs to same parent question
                const targetParent = targetZone ? getParentQuestion(
                    // Try to extract parent from zone label or use current parent as fallback
                    Object.keys(semanticZones).find(key =>
                        semanticZones[key].some((z: any) => z === targetZone)
                    ) || anno.subQuestion || ''
                ) : currentParent;

                const nextPageHasSameParent = currentParent === targetParent && currentParent !== '';

                if (nextPageHasSameParent && pageIndex !== highestPage) {
                    console.log(` 🚀 [HIGH-PAGE] Shifting VISUAL Q${anno.subQuestion} from P${pageIndex} -> P${highestPage} (Drawing preference)`);
                    pageIndex = highestPage;
                    (anno as any).pageIndex = highestPage;
                } else if (!nextPageHasSameParent) {
                    console.log(` 🚫 [HIGH-PAGE-BLOCKED] Q${anno.subQuestion} stays on P${pageIndex} (Parent mismatch: current=${currentParent}, target=${targetParent})`);
                }
            }
        }

        // =====================================================================
        // 🛡️ IRON DOME: SILO & PAGE ENFORCEMENT
        // =====================================================================
        let source = findInData(activePointer);

        if (source && source.subQuestionLabel && anno.subQuestion) {
            const normalize = (s: string) => s.replace(/\d+|question|part/gi, '').trim().toLowerCase();
            const annoLabel = normalize(anno.subQuestion);
            const sourceLabel = normalize(source.subQuestionLabel);

            // 1. DETERMINE TRUTH PAGES
            let trueZonePages: number[] = [];
            if (semanticZones) {
                const currentQuestionId = (questionId || "").replace(/\D/g, '');
                const zones = ZoneUtils.findAllMatchingZones(anno.subQuestion, semanticZones, currentQuestionId);
                trueZonePages = zones.map(z => z.pageIndex);
            }

            // 🛡️ [SMART OVERRIDE]: If Visual + P1 Candidate exists, Trust P1 over Zone Detector (Legacy Rule)
            if ((status === 'VISUAL' || (anno.text || '').includes('B')) && trueZonePages.includes(0)) {
                const p1Candidate = stepsDataForMapping.find(s =>
                    s.subQuestionLabel && normalize(s.subQuestionLabel) === annoLabel && s.pageIndex === 1
                );
                if (p1Candidate && !trueZonePages.includes(1)) trueZonePages.push(1);
            }

            // 2. DETECT VIOLATION
            const labelMismatch = (annoLabel && sourceLabel && annoLabel !== sourceLabel && sourceLabel !== 'main');

            // A mismatch only exists if the found source is on a page that HAS NO ZONE for this question part.
            const pageMismatch = (trueZonePages.length > 0 && source.pageIndex !== undefined && !trueZonePages.includes(source.pageIndex));
            const isRelaxedMatch = !labelMismatch && (annoLabel === sourceLabel || sourceLabel === 'main');

            if (labelMismatch || (pageMismatch && !isRelaxedMatch)) {
                // 3. SEARCH REPLACEMENT
                let candidates = stepsDataForMapping.filter(s =>
                    s.subQuestionLabel && normalize(s.subQuestionLabel) === annoLabel
                );

                // Prioritize Correct Page (Try to find a candidate on ANY of the true zone pages)
                if (pageMismatch) {
                    const pageSpecific = candidates.filter(s => trueZonePages.includes(s.pageIndex));
                    if (pageSpecific.length > 0) candidates = pageSpecific;
                }

                if (candidates.length > 0) {
                    // Sort: Visuals first
                    candidates.sort((a, b) => (a.text?.includes('VISUAL') ? -1 : 1));
                    const best = candidates[0];

                    // 4. SNAP & UPDATE
                    lineId = best.line_id;
                    targetId = best.line_id;

                    (anno as any).line_id = best.line_id;
                    (anno as any).linked_ocr_id = best.line_id;

                    // 🚨 FIX: Don't force MATCHED. Keep VISUAL/UNMATCHED.
                    // This prevents re-linking to a vetoed block.
                    // if (status === "UNMATCHED") status = "MATCHED";

                    console.log(`✅ [IRON-DOME] Snapped mark to: ${lineId} (P${best.pageIndex})`);
                }
            }
        }
        // =====================================================================

        // 1. DIMENSION GROUND TRUTH
        const dims = getPageDims(pageDimensions!, pageIndex);
        const pageWidth = dims.width || 1000;
        const pageHeight = dims.height || 1000;

        // 2. PIXEL NORMALIZATION (The "Pump")
        const rawAiBox = Array.isArray(anno.bbox)
            ? [anno.bbox[0], anno.bbox[1], anno.bbox[2], anno.bbox[3]]
            : [(anno.bbox as any)?.x || 0, (anno.bbox as any)?.y || 0, (anno.bbox as any)?.width || 0, (anno.bbox as any)?.height || 0];

        // 🛡️ STRENGTHEN EXTRACTION: Use multiple potential coordinate sources to avoid "0px Jump"
        const rawX = (anno as any).visual_position?.x ?? (anno as any).aiPosition?.x ?? (anno as any).bbox?.x ?? (Array.isArray((anno as any).bbox) ? (anno as any).bbox[0] : rawAiBox[0]);
        const rawY = (anno as any).visual_position?.y ?? (anno as any).aiPosition?.y ?? (anno as any).bbox?.y ?? (Array.isArray((anno as any).bbox) ? (anno as any).bbox[1] : rawAiBox[1]);

        const intentX = (rawX / 100) * pageWidth;
        const intentY = (rawY / 100) * pageHeight;

        // 3. AUTHORITY SELECTION (Initial Intent)
        let authorityBox: [number, number, number, number] = [
            intentX,
            intentY,
            (rawAiBox[2] / 100) * pageWidth,
            (rawAiBox[3] / 100) * pageHeight || (pageHeight * 0.015) // Height Protection
        ];

        // 4. ZONE PROTECTION (Requirement: AI Intent limited to Intended Zone)
        let finalX = intentX;
        let finalY = intentY;

        if (semanticZones) {
            const currentQuestionId = (questionId || "").replace(/\D/g, '');
            const allMatchingZones = ZoneUtils.findAllMatchingZones(anno.subQuestion, semanticZones, currentQuestionId);
            const zone = allMatchingZones.find(z => z.pageIndex === pageIndex);

            if (!zone && allMatchingZones.length > 0) {
                CoordinateAuditLogger.audit(5, `Enrichment Q${anno.subQuestion}`, `Zone MISS for P${pageIndex}. Available: [${allMatchingZones.map(z => z.pageIndex).join(', ')}]`);
            } else if (!zone) {
                CoordinateAuditLogger.audit(5, `Enrichment Q${anno.subQuestion}`, `NO ZONES FOUND at all for Q${currentQuestionId}`);
            }

            if (zone) {
                const zoneH = zone.endY - zone.startY;

                // DYNAMIC MARGIN: 5% of zone height, capped between 10px and 100px
                const margin = Math.max(10, Math.min(100, zoneH * 0.1));

                // 🕵️ [AUDIT-5-ENRICH]: Final Zone Clamping
                CoordinateAuditLogger.audit(5, `Enrichment Q${anno.subQuestion}`, `Zone P${zone.pageIndex} [${zone.startY}-${zone.endY}] | Pre-Clamp Y: ${intentY.toFixed(0)}`);

                // LIMIT HEIGHT: Cap at 35% to ensure staggering room
                let annoH = (rawAiBox[3] / 100) * pageHeight;
                if (status === 'VISUAL' && annoH > zoneH * 0.35) {
                    annoH = zoneH * 0.35;
                }

                // THE FIX: Move the Y-anchor UP by half the box height
                // This makes the AI's "Center" instruction work as intended
                const centeredY = intentY - (annoH / 2);

                // CLAMP: Keep the box and its dynamic margin inside the zone
                finalY = Math.max(
                    zone.startY + margin,
                    Math.min(centeredY, zone.endY - annoH - margin)
                );

                // console.log(`🛡️ [11b-FIX] Q${anno.subQuestion} | IntentY: ${intentY.toFixed(0)} | Floor: ${(zone.endY - annoH).toFixed(0)} | ResultY: ${finalY.toFixed(0)}`);

                const annoW = (rawAiBox[2] / 100) * pageWidth;
                // Apply the same logic for X (Center to Left)
                finalX = Math.max(
                    (zone.x || 0) + margin,
                    Math.min(intentX - (annoW / 2), ((zone.x || 0) + (zone.width || pageWidth)) - annoW - margin)
                );

                authorityBox = [finalX, finalY, annoW, annoH];
            }
        }

        // Update authority box with clamped values
        authorityBox[0] = finalX;
        authorityBox[1] = finalY;

        const linkedOcrBlock = activePointer ? findInData(activePointer) : null;
        if ((status === 'MATCHED' || (anno as any).ocr_match_status === 'SPLIT') && linkedOcrBlock?.bbox) {
            const b = linkedOcrBlock.bbox;
            const rawOcrBox: [number, number, number, number] = Array.isArray(b) ? [b[0], b[1], b[2], b[3]] : [b.x, b.y, b.width, b.height];

            // Ensure OCR percentages are normalized to the same pixel scale
            if (linkedOcrBlock.unit === 'percentage') {
                authorityBox = [
                    (rawOcrBox[0] / 100) * pageWidth,
                    (rawOcrBox[1] / 100) * pageHeight,
                    (rawOcrBox[2] / 100) * pageWidth,
                    (rawOcrBox[3] / 100) * pageHeight
                ];
            } else {
                authorityBox = rawOcrBox;
            }
        }

        // 5. FINAL LOGGING
        if (linkedOcrBlock?.isSplitBlock) isSplitBlock = true;

        // console.log(`🛡️ [DESIGN-RESCUE] Q${anno.subQuestion} | Status: ${status} | IntentY: ${intentY.toFixed(0)}px -> SnappedY: ${authorityBox[1].toFixed(0)}px`);

        // 5. EVIDENCE LOG
        // console.log(`🛡️ [ENRICH-AUTHORITY] ${anno.subQuestion} | Status: ${status} | Snapped: [${Math.round(authorityBox[0])}, ${Math.round(authorityBox[1])}]px`);

        // Resolve student/class text as before
        let studentText = "";
        let classText = (anno as any).classification_text || "";

        if (activePointer) {
            const match = findInData(activePointer);
            if (match) {
                studentText = match.text || match.cleanedText || "";
                classText = match.text || match.cleanedText || "";
                if (studentText.includes('VISUAL') || studentText.includes('DRAWING')) {
                    classText = "";
                    studentText = "[Drawing/Graph]";
                    method = "VISUAL_VALUE";
                } else {
                    method = "POINTED_TEXT";
                }
            }
        } else {
            const rawDesc = (anno as any).contentDesc || (anno as any).content_desc || (anno as any).reasoning || "";
            const cleanDesc = rawDesc.replace('[DRAWING]', '').trim();
            studentText = cleanDesc ? `[DRAWING] ${cleanDesc}` : "[Drawing/Graph]";
            classText = "";
            method = "VISUAL_VALUE";
            if (status === "UNMATCHED") status = "VISUAL";
        }

        if (status === "MATCHED") classText = "";

        // 🛡️ [FINAL SIZE SANITY]: Ensure no annotation ever exits with zero width/height.
        // We enforce a 15px floor for both dimensions.
        const finalBox: [number, number, number, number] = [
            authorityBox[0],
            authorityBox[1],
            Math.max(15, authorityBox[2] || 20),
            Math.max(15, authorityBox[3] || (pageHeight * 0.015))
        ];

        // 🛡️ [STATUS-METADATA]: Preserve status for UI border colors.
        const finalIsSplit = isSplitBlock || status === 'SPLIT';

        return {
            ...anno,
            bbox: finalBox,
            snappedBbox: finalBox,
            pageIndex: pageIndex,
            ocr_match_status: status as any,
            linked_ocr_id: activePointer,
            student_text: latexToPlainText(studentText),
            studentText: latexToPlainText(studentText),
            classification_text: latexToPlainText(classText),
            classificationText: latexToPlainText(classText),
            _debug_placement_method: method,
            hasLineData: hasLineData,
            isSplitBlock: finalIsSplit,
            _debug_status: finalIsSplit ? 'GREEN_BORDER' : (status === 'UNMATCHED' ? 'RED_BORDER' : 'BLUE_BORDER'),
            unit: 'pixels'
        } as EnrichedAnnotation;
    });

    // 🚀 Apply Refined Positive Dominance Filter
    const cleanAnnotations = applyPositiveDominance(enriched);

    // Then apply physics to whatever remains
    return AnnotationCollisionService.resolveCollisions(cleanAnnotations, semanticZones);
};