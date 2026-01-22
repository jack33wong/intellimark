import type { Annotation, EnrichedAnnotation, MarkingTask } from '../../types/index.js';

const getPageDims = (pageDimensions: Map<number, any>, idx: number) => {
    if (pageDimensions?.has(idx)) return pageDimensions.get(idx);
    // Fallback logic for single page documents
    if (pageDimensions?.size === 1) return pageDimensions.values().next().value;
    return { width: 1000, height: 1400 };
};

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
    semanticZones?: Record<string, { startY: number; endY: number; pageIndex: number; x: number }>
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
        // PATH 1: PHYSICAL MATCH (OCR Blocks)
        // ---------------------------------------------------------
        if (lineId.startsWith('block_')) {
            match = findInSteps(lineId);
            if (match && match.bbox && (match.bbox[0] !== 0 || match.bbox[1] !== 0)) {
                pixelBbox = [...match.bbox] as [number, number, number, number];
                pageIndex = match.pageIndex ?? pageIndex;
                method = "OCR_PHYSICAL";

                // 📝 LOGGING: PROVE OCR IS INTACT
                console.log(`   ✅ [PATH: OCR] Found Mathpix Block. Passing coords INTACT.`);
                console.log(`      Input:  ${JSON.stringify(match.bbox)}`);
                console.log(`      Output: ${JSON.stringify(pixelBbox)}`);
            }
        }

        // ---------------------------------------------------------
        // PATH 2: VISUAL MATCH (Classification Lines)
        // ---------------------------------------------------------
        if (method === "NONE") {
            match = findInClassification(lineId);
            let source = 'RAW_CLASS';

            if (!match) {
                match = findInSteps(lineId);
                source = 'PROCESSED_STEPS';
            }

            // Fallback: Index Matching
            if (!match && (anno as any).lineIndex !== undefined) {
                const lineIdx = ((anno as any).lineIndex || 1) - 1;
                if (stepsDataForMapping[lineIdx]) {
                    match = stepsDataForMapping[lineIdx];
                    source = 'INDEX_FALLBACK';
                }
            }

            if (match) {
                pageIndex = match.pageIndex ?? pageIndex;
                const dims = getPageDims(pageDimensions!, pageIndex);

                // 🔥 THE FIX: SCALE DETECTIVE V2
                let usePercentageMath = false;
                if (match.position && source === 'RAW_CLASS') usePercentageMath = true;

                // Some OCR sources (like the Interceptor or certain crops) use a 0-1000 scale.
                // If coordinates are < 1000 AND the page width is large (e.g. > 1500), 
                // it's almost certainly a percentage/normalized coordinate, not absolute pixels.
                if (match.bbox && match.bbox[0] < 1000 && match.bbox[1] < 1000 && dims.width > 1200) {
                    const den = (match.bbox[0] <= 100 && match.bbox[1] <= 100) ? 100 : 1000;
                    console.log(`   ⚠️ [DETECTIVE] Detected ${den}-scale normalized coords (${Math.round(match.bbox[0])}, ${Math.round(match.bbox[1])})`);

                    const input = match.position || { x: match.bbox[0], y: match.bbox[1], width: match.bbox[2], height: match.bbox[3] };
                    pixelBbox = [
                        (input.x / den) * dims.width,
                        (input.y / den) * dims.height,
                        (input.width / den) * dims.width,
                        (input.height / den) * dims.height
                    ];
                    method = `VISUAL_NORM_${den}_CALC`;
                    console.log(`   ✅ [PATH: VISUAL] Converted ${den} scale to Pixels.`);
                }
                else if (match.bbox) {
                    pixelBbox = [...match.bbox] as [number, number, number, number];
                    method = "PX_PRECOMPUTED";

                    // 🔥 CRITICAL FIX: The "Precomputed" values might actually be RAW PERCENTAGES (0-100).
                    // If they are suspicious (e.g. < 100), we MUST force them through the scaling detective.
                    // This fixes the regression where "matched" items appeared at top-left.
                    if (pixelBbox[0] < 100 && pixelBbox[1] < 100 && dims.width > 200) {
                        console.log(`   ⚠️ [SCALING-CORRECTION] "Matched" coords are suspicious (${Math.round(pixelBbox[0])},${Math.round(pixelBbox[1])}). Treating as PERCENTAGE.`);
                        const den = 100;
                        pixelBbox = [
                            (pixelBbox[0] / den) * dims.width,
                            (pixelBbox[1] / den) * dims.height,
                            (pixelBbox[2] / den) * dims.width,
                            (pixelBbox[3] / den) * dims.height
                        ];
                        method = "PX_PRECOMPUTED_SCALED"; // CHANGED: Mark as Precomputed so we trust it
                    }
                }
            }
        }

        // 🏗️ PHASE 4: APPLY GLOBAL OFFSET (LANDMARK ALIGNMENT)
        // 🛡️ MATCH SOVEREIGNTY (The "Perfect Match" Protection):
        // If we found a physical OCR match or a pre-computed pixel match, we trust it implicitly.
        // Do NOT apply global offsets or effective scaling to these high-confidence anchors.
        // NOW INCLUDES "PX_PRECOMPUTED_SCALED" to protect our newly scaled matches from shifting.
        if (method !== "OCR_PHYSICAL" && method !== "PX_PRECOMPUTED" && method !== "PX_PRECOMPUTED_SCALED" && method !== "FALLBACK") {
            // 🏮 PER-ANNOTATION SCOPING: If this annotation has a subQuestion (e.g. "b"),
            // we look for a matching landmark to get a more precise vertical anchor.
            let specificOffsetX = globalOffsetX;
            let specificOffsetY = globalOffsetY;

            if (semanticZones && (anno.subQuestion || (anno as any).sub_question)) {
                const subQRaw = (anno.subQuestion || (anno as any).sub_question || "").toLowerCase();
                const subQ = subQRaw.replace(/^\d+/, '').replace(/[()\s]/g, '');

                const match = semanticZones[subQ] || (subQ.length > 1 ? semanticZones[subQ.charAt(0)] : null);
                if (match) {
                    specificOffsetX = match.x || 0;
                    specificOffsetY = match.startY || 0;
                    console.log(`   ⚖️ [SCOPED-OFFSET] Annotation "${anno.text}" uses Landmark [${subQ}] (+${specificOffsetX}, +${specificOffsetY})`);
                }
            }

            // 🔥 DOUBLE-OFFSET PROTECTION: If the base pixelBbox is already "large" (e.g. y > 200),
            // and we have a large offset being applied, it's highly likely the coordinate is ALREADY global.
            // Heuristic: If pixelBbox.y + offset > Page Height, something is wrong.
            const dims = getPageDims(pageDimensions!, pageIndex);
            // 🔥 DOUBLE-OFFSET PROTECTION Refinement (V24):
            // If the match was found via Scale Detective (VISUAL_NORM_..._CALC), 
            // it is DEFINITIVELY relative to a crop and MUST receive the offset.
            const isScaleDetective = method.includes('CALC');
            const isAlreadyGlobal = !isScaleDetective && pixelBbox[1] > (specificOffsetY - 150) && pixelBbox[1] > 200;

            if (isAlreadyGlobal && specificOffsetY > 0) {
                console.log(`   🛡️ [OFFSET-BYPASS] Base Y (${Math.round(pixelBbox[1])}) is already near/past Landmark Y (${specificOffsetY}). Skipping Anchor.`);
            }
            else if (specificOffsetX !== 0 || specificOffsetY !== 0) {
                console.log(`   🏗️ [OFFSET] Applying Anchor (+${specificOffsetX}, +${specificOffsetY}) to base (${Math.round(pixelBbox[0])}, ${Math.round(pixelBbox[1])})`);
                pixelBbox[0] += specificOffsetX;
                pixelBbox[1] += specificOffsetY;
                console.log(`      Final Coord: (${Math.round(pixelBbox[0])}, ${Math.round(pixelBbox[1])})`);
            }
        }

        // Final Sanity Check for Visibility
        if (pixelBbox[2] < 300) pixelBbox[2] = 300;
        if (pixelBbox[3] < 40) pixelBbox[3] = 40;

        const isDrawing = (anno.text || '').includes('[DRAWING]') || (anno.reasoning && anno.reasoning.includes('[DRAWING]'));

        // 🔥 FINAL ROBUST FIX (V24): Trust incoming status (Sovereignty)
        // This ensures redirected marks from Interceptor keep their MATCHED (M) status.
        let status = incomingStatus || (isDrawing ? "VISUAL" :
            (lineId && (lineId.startsWith('block_') || lineId.startsWith('ocr_')) || method.includes('OCR')) ? "MATCHED" :
                (method.includes('PERCENT') ? "VISUAL" : "UNMATCHED"));

        // If it was a redirect, and no status was provided, fallback to visual ONLY if it's a drawing
        if (lineId && lineId.startsWith('visual_redirect_')) {
            status = incomingStatus || (isDrawing ? "VISUAL" : "MATCHED");
        }

        console.log(`   🏁 [FINAL] ID: ${lineId} | Status: ${status} | Method: ${method}`);

        return {
            ...anno,
            bbox: pixelBbox,
            pageIndex: pageIndex,
            ocr_match_status: status as any,
            line_id: lineId, // Explicitly preserve ID for logs
            matchedText: (match as any)?.text || (match as any)?.lineText || "",
            aiMatchedText: (anno as any).student_text || (anno as any).studentText || (anno as any).studentWork || "",
            _debug_placement_method: method,
            visualObservation: visualObservation
        } as EnrichedAnnotation;
    });
};
