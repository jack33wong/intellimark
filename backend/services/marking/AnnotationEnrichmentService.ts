import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';

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

    console.log(`\n🔍 [ENRICH-START] Processing Q${questionId} | ${annotations.length} annotations`);
    console.log(`   ⚓ [GLOBAL-OFFSET] Applying offsets: x=${globalOffsetX}, y=${globalOffsetY}`);

    // Helper: Find in Raw Classification Data (Percent 0-100)
    const findInClassification = (id: string) => {
        if (!classificationBlocks) return null;
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
        let pixelBbox: [number, number, number, number] = [0, 0, 0, 0];
        let pageIndex = (anno as any).pageIndex ?? defaultPageIndex;
        let method = "NONE";
        let match: any = null;

        const lineId = (anno as any).line_id || "";
        const incomingStatus = (anno as any).ocr_match_status;

        // 📝 LOGGING: TRACK THE STARTING POINT
        console.log(`\n👉 [ANNO ${idx}] "${anno.text}" (ID: ${lineId}) | Status In: ${incomingStatus || 'NONE'}`);

        // ---------------------------------------------------------
        // PATH 1: PHYSICAL MATCH (Linked OCR Block)
        // ---------------------------------------------------------
        if ((incomingStatus === "MATCHED" || (anno as any)._pipeline_action === "AI PRECISE (V4)") && (anno as any).linked_ocr_id) {
            const linkedBlock = findInSteps((anno as any).linked_ocr_id);
            if (linkedBlock && linkedBlock.bbox) {
                match = linkedBlock;
                pixelBbox = [...match.bbox] as [number, number, number, number];
                pageIndex = match.pageIndex ?? pageIndex;
                method = "LINKER_OCR_RESTORED";

                console.log(`   ✅ [PATH: RESTORED] Snapped to linked_ocr_id '${(anno as any).linked_ocr_id}'`);
            }
        }

        // ---------------------------------------------------------
        // PATH 2: CLASSIFICATION MATCH (Classification ID)
        // ---------------------------------------------------------
        const isGlobalMapperId = lineId && typeof lineId === 'string' && lineId.startsWith('p0_q') && method !== 'LINKER_OCR_RESTORED';

        if (method === "NONE" && isGlobalMapperId) {
            match = findInClassification(lineId);
            if (match) {
                const rawBox = match.box || match.bbox || match.position;
                if (rawBox) {
                    pageIndex = match.pageIndex ?? pageIndex;
                    const dims = getPageDims(pageDimensions!, pageIndex);

                    const rx = Array.isArray(rawBox) ? rawBox[0] : (rawBox.x ?? 0);
                    const ry = Array.isArray(rawBox) ? rawBox[1] : (rawBox.y ?? 0);
                    const rw = Array.isArray(rawBox) ? rawBox[2] : (rawBox.width ?? 0);
                    const rh = Array.isArray(rawBox) ? rawBox[3] : (rawBox.height ?? 0);

                    // SCALE TO PAGE DIMENSIONS (0-100 -> Pixels)
                    // If raw coords are small (< 101), they are almost certainly percentages.
                    const den = (rx <= 100 && ry <= 100) ? 100 : 1;

                    pixelBbox = [
                        (rx / den) * dims.width,
                        (ry / den) * dims.height,
                        (rw / den) * dims.width,
                        (rh / den) * dims.height
                    ];
                    method = "PX_SNAP_MATCH";
                    (anno as any)._pipeline_action = "PX SNAP";
                    console.log(`   🧲 [SNAP] Scaled Classification Block (${den} -> Pixels): (${Math.round(pixelBbox[0])}, ${Math.round(pixelBbox[1])}) on Page ${pageIndex} (${dims.width}x${dims.height})`);
                }
            }
        }

        // ---------------------------------------------------------
        // PATH 3: STEPS MATCH (Generic line_id fallback)
        // ---------------------------------------------------------
        if (method === "NONE") {
            match = findInSteps(lineId);
            if (match && match.bbox) {
                pixelBbox = [...match.bbox] as [number, number, number, number];
                pageIndex = match.pageIndex ?? pageIndex;
                method = "OCR_PHYSICAL";
                (anno as any)._pipeline_action = "OCR MATCH";
            }
        }

        // 🏗️ PHASE 4: GLOBAL TRANSFORMS (Landmarks & Snapping)
        if (isGlobalMapperId) {
            // MAGNET FIX: If we have a classification position but a PHYSICAL block overlaps it, snap to physical.
            if (method === "PX_SNAP_MATCH") {
                const roughBox = { x: pixelBbox[0], y: pixelBbox[1], width: pixelBbox[2], height: pixelBbox[3] };
                const preciseOcrBlock = findOverlappingOCRBlock(roughBox, stepsDataForMapping);
                if (preciseOcrBlock) {
                    console.log(`   🧲 [SNAP] Snapped '${lineId}' to precise OCR block '${preciseOcrBlock.id}'`);
                    pixelBbox = [...preciseOcrBlock.bbox] as [number, number, number, number];
                }
            }

            // LANDMARK PINNING (For unmatched marks or drifting marks)
            if (method !== "OCR_PHYSICAL" && method !== "LINKER_OCR_RESTORED") {
                let specificOffsetX = globalOffsetX;
                let specificOffsetY = globalOffsetY;

                if (semanticZones && (anno.subQuestion || (anno as any).sub_question)) {
                    const subQRaw = (anno.subQuestion || (anno as any).sub_question || "").toLowerCase();
                    const subQ = subQRaw.replace(/^\d+/, '').replace(/[()\s]/g, '');

                    // Suffix-aware landmark matching
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
                        const currentY = pixelBbox[1];
                        const bestZone = matchingZones.find(z => currentY >= z.startY && currentY <= z.endY) || matchingZones[0];

                        // [DRIFT FIX] Allow landmark X offset if AI's X is very small (near 0)
                        // This fixes cases where classification IDs are correctly identified but poorly placed.
                        const skipLandmarkX = method === "LINKER_OCR_RESTORED"; // Only skip for high-confidence physical matches

                        if (pixelBbox[0] < 200 && !skipLandmarkX) {
                            specificOffsetX = bestZone.x || 0;
                            console.log(`   📍 [LANDMARK-X] Applying landmark X-offset (+${Math.round(specificOffsetX)}) because AI X (${Math.round(pixelBbox[0])}) is near left edge.`);
                        } else {
                            specificOffsetX = 0;
                        }

                        // Always check if we need a Y offset to get into the zone
                        const inZone = currentY >= bestZone.startY && currentY <= bestZone.endY;

                        // [V32 ENFORCEMENT] Force-clamp even matched links if they are drift-prone
                        if (!inZone || method === "PX_SNAP_MATCH") {
                            specificOffsetY = bestZone.startY || 0;
                            (anno as any)._pipeline_action = "LANDMARK PIN";

                            // If it's a classification snap, we ALSO need to clamp the pixel coords to the zone
                            if (method === "PX_SNAP_MATCH" || !inZone) {
                                const safePad = (bestZone.endY - bestZone.startY) > 60 ? 15 : 2;
                                pixelBbox[1] = Math.max(bestZone.startY + safePad, Math.min(pixelBbox[1], bestZone.endY - 20));
                                console.log(`   🛡️ [PINNING] Forced SubQ '${anno.subQuestion}' inside zone [${Math.round(bestZone.startY)}-${Math.round(bestZone.endY)}]. Target Y: ${Math.round(pixelBbox[1])}`);
                            }
                        }
                    }
                }

                // [V32 SCALE-FIX] Ensure any coordinates sitting at (0-100) are globally scaled to pixels
                // This is a safety layer for marks that bypassed scaling earlier.
                if (pixelBbox[0] <= 100 && pixelBbox[1] <= 100 && pixelBbox[2] < 50) {
                    const dims = getPageDims(pageDimensions!, pageIndex);
                    pixelBbox[0] = (pixelBbox[0] / 100) * dims.width;
                    pixelBbox[1] = (pixelBbox[1] / 100) * dims.height;
                    pixelBbox[2] = (pixelBbox[2] / 100) * dims.width;
                    pixelBbox[3] = (pixelBbox[3] / 100) * dims.height;
                    console.log(`   🧮 [SCALE-SAFETY] Auto-scaled raw % coords to Pixels: (${Math.round(pixelBbox[0])}, ${Math.round(pixelBbox[1])})`);
                }

                // [REFINED] Apply offset with double-offset protection and SAFE PADDING
                let zoneStart = specificOffsetY;
                let zoneEnd = specificOffsetY + 200; // Default fallback

                if (semanticZones && (anno.subQuestion || (anno as any).sub_question)) {
                    const subQRaw = (anno.subQuestion || (anno as any).sub_question || "").toLowerCase();
                    const subQ = subQRaw.replace(/^\d+/, '').replace(/[()\s]/g, '');
                    const zones = (semanticZones as any)[subQ];
                    if (zones && zones.length > 0) {
                        zoneStart = zones[0].startY;
                        zoneEnd = zones[0].endY;
                    }
                }

                const isAlreadyInZone = pixelBbox[1] >= (zoneStart - 50) && pixelBbox[1] <= (zoneEnd + 50);

                if (!isAlreadyInZone && (specificOffsetX !== 0 || specificOffsetY !== 0)) {
                    const zoneHeight = zoneEnd - zoneStart;
                    // [V31 FIX] Narrow Zone Contentment: If zone is tiny, use minimal padding (2px)
                    const safePadding = zoneHeight > 60 ? Math.min(50, zoneHeight * 0.4) : 2;

                    pixelBbox[0] += specificOffsetX;
                    pixelBbox[1] += specificOffsetY + safePadding;

                    // [V31 FIX] Hard Containment: Caps Y to ensure it doesn't bleed into next zone
                    if (pixelBbox[1] > (zoneEnd - 15)) {
                        pixelBbox[1] = Math.max(zoneStart + 5, zoneEnd - 25);
                        console.log(`   🛡️ [CONTAINMENT] Annotation "${anno.text}" capped to stay within zone [${Math.round(zoneStart)}-${Math.round(zoneEnd)}]. New Y: ${Math.round(pixelBbox[1])}`);
                    }
                    if (pixelBbox[1] < zoneStart) {
                        pixelBbox[1] = zoneStart + 5;
                        console.log(`   🛡️ [CONTAINMENT] Annotation "${anno.text}" raised to stay within zone floor. New Y: ${Math.round(pixelBbox[1])}`);
                    }

                    console.log(`   🏗️ [OFFSET] Applied Offset (${specificOffsetX}, ${specificOffsetY}) + Safe Padding (${Math.round(safePadding)})`);
                }
            }
        }

        // [STAKING-FIX] Add vertical offset for coordinates sharing the same physical/logical source
        // This ensures that B3 M1 M1 marks for the same line don't overlap.
        const anchorKey = (anno as any).linked_ocr_id || lineId || "default";
        const count = positionCounters.get(anchorKey) || 0;
        positionCounters.set(anchorKey, count + 1);

        if (count > 0) {
            const stackingOffset = count * 35;
            pixelBbox[1] += stackingOffset;
            console.log(`   📚 [STACKING] Applied vertical offset of ${stackingOffset}px for anchor "${anchorKey}" (Occurence #${count + 1})`);
        }

        // Final Sanitization
        if (pixelBbox[2] < 30) pixelBbox[2] = 100; // Min width for cross/tick
        if (pixelBbox[3] < 30) pixelBbox[3] = 40;

        const isDrawing = (anno.text || '').includes('[DRAWING]') || (anno.reasoning && (anno.reasoning as any).includes('[DRAWING]'));
        let status = incomingStatus || (isDrawing ? "VISUAL" : "UNMATCHED");

        console.log(`   🏁 [FINAL] ID: ${lineId} | Status: ${status} | Coord: (${Math.round(pixelBbox[0])}, ${Math.round(pixelBbox[1])})`);

        return {
            ...anno,
            bbox: pixelBbox,
            pageIndex: pageIndex,
            ocr_match_status: status as any,
            _debug_placement_method: method
        } as EnrichedAnnotation;
    });
};
