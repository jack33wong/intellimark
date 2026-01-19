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
    visualObservation?: string
): EnrichedAnnotation[] => {

    console.log(`\n🔍 [ENRICH-START] Processing Q${questionId} | ${annotations.length} annotations`);

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

        const lineId = (anno as any).line_id || "";

        // 📝 LOGGING: TRACK THE STARTING POINT
        console.log(`\n👉 [ANNO ${idx}] "${anno.text}" (ID: ${lineId})`);

        // ---------------------------------------------------------
        // PATH 1: PHYSICAL MATCH (OCR Blocks)
        // ---------------------------------------------------------
        if (lineId.startsWith('block_')) {
            const ocrBlock = findInSteps(lineId);
            if (ocrBlock && ocrBlock.bbox && (ocrBlock.bbox[0] !== 0 || ocrBlock.bbox[1] !== 0)) {
                pixelBbox = [...ocrBlock.bbox] as [number, number, number, number];
                pageIndex = ocrBlock.pageIndex ?? pageIndex;
                method = "OCR_PHYSICAL";

                // 📝 LOGGING: PROVE OCR IS INTACT
                console.log(`   ✅ [PATH: OCR] Found Mathpix Block. Passing coords INTACT.`);
                console.log(`      Input:  ${JSON.stringify(ocrBlock.bbox)}`);
                console.log(`      Output: ${JSON.stringify(pixelBbox)}`);
            }
        }

        // ---------------------------------------------------------
        // PATH 2: VISUAL MATCH (Classification Lines)
        // ---------------------------------------------------------
        if (method === "NONE") {
            let match = findInClassification(lineId);
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

                // 🕵️ DETECTIVE LOGIC: Is this a Percentage or a Pixel?
                let usePercentageMath = false;
                if (match.position && source === 'RAW_CLASS') usePercentageMath = true;

                // 🔥 THE FIX: CHECK FOR SUSPICIOUSLY SMALL COORDINATES
                if (match.bbox && match.bbox[0] < 100 && match.bbox[1] < 100 && dims.width > 500) {
                    console.log(`   ⚠️ [DETECTIVE] Tiny coordinates found in ${source}. Assuming PERCENTAGE.`);
                    console.log(`      Raw Values: ${JSON.stringify(match.bbox)} vs Page Width: ${dims.width}`);
                    usePercentageMath = true;
                }

                if (usePercentageMath) {
                    // Use .position if available, otherwise assume bbox holds the percentages
                    const input = match.position || { x: match.bbox[0], y: match.bbox[1], width: match.bbox[2], height: match.bbox[3] };

                    pixelBbox = [
                        (input.x / 100) * dims.width,
                        (input.y / 100) * dims.height,
                        (input.width / 100) * dims.width,
                        (input.height / 100) * dims.height
                    ];
                    method = "VISUAL_PERCENT_CALC";
                    console.log(`   ✅ [PATH: VISUAL] Converted % to Pixels.`);
                    console.log(`      Input %: ${input.x}%, ${input.y}%`);
                    console.log(`      Output px: ${Math.round(pixelBbox[0])}, ${Math.round(pixelBbox[1])}`);
                }
                else if (match.bbox) {
                    pixelBbox = [...match.bbox] as [number, number, number, number];
                    method = "VISUAL_PRECOMPUTED";
                    console.log(`   ℹ️ [PATH: PRECOMPUTED] Trusted existing pixels.`);
                }
            }
        }

        // ---------------------------------------------------------
        // PATH 3: PANIC FALLBACK
        // ---------------------------------------------------------
        if (method === "NONE" || (pixelBbox[0] === 0 && pixelBbox[1] === 0)) {
            const dims = getPageDims(pageDimensions!, pageIndex);
            pixelBbox = [dims.width * 0.1, (dims.height * 0.1) + (idx * 60), 300, 50];
            method = "FALLBACK";
            console.warn(`   🚨 [PATH: FALLBACK] Could not find coords. Stacking in margin.`);
        }

        // Final Sanity Check for Visibility
        if (pixelBbox[2] < 300) pixelBbox[2] = 300;
        if (pixelBbox[3] < 40) pixelBbox[3] = 40;

        return {
            ...anno,
            bbox: pixelBbox,
            pageIndex: pageIndex,
            ocr_match_status: method.includes('OCR') ? "MATCHED" : "UNMATCHED",
            _debug_placement_method: method,
            visualObservation: visualObservation
        } as EnrichedAnnotation;
    });
};
