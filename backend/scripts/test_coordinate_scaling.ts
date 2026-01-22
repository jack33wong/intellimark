
import { enrichAnnotationsWithPositions } from '../services/marking/AnnotationEnrichmentService.js';

function runScaleReproduction() {
    console.log("🧪 Diagnosing Coordinate Scaling & Anchor Alignment");

    // 1. Inputs mimicking Q12 (line_13)
    const pageDims = new Map([[0, { width: 2000, height: 3000 }]]);
    const classificationBlocks: any[] = []; // Empty or unused for this path

    // Mimic the raw data that failed to scale in MarkingExecutor
    // Box: [36, 53, 11, 3]
    const stepsDataForMapping = [
        {
            line_id: "line_13",
            pageIndex: 0,
            text: "Smallest 2\\sqrt{5}",
            bbox: [36, 53, 11, 3] as [number, number, number, number],
            ocrSource: 'classification'
        }
    ];

    const annotations = [
        {
            text: "B1",
            line_id: "line_13",
            ocr_match_status: "MATCHED" as any
        }
    ];

    const globalOffsetX = 100;
    const globalOffsetY = 56;

    console.log(`\nInput Line ID: line_13`);
    console.log(`Raw BBox: [36, 53, 11, 3]`);
    console.log(`Anchor: (+${globalOffsetX}, +${globalOffsetY})`);

    // 2. Call Enrichment Service (The logic we are testing)
    const results = enrichAnnotationsWithPositions(
        annotations,
        stepsDataForMapping,
        "12",
        0,
        pageDims,
        classificationBlocks,
        {} as any,
        "",
        globalOffsetX,
        globalOffsetY
    );

    const result = results[0];
    const [x, y] = result.bbox;

    console.log(`\n----------------------------------------`);
    console.log(`ENRICHED COORDINATES: (${Math.round(x)}, ${Math.round(y)})`);
    console.log(`----------------------------------------`);

    // 3. Evaluation
    // Current Buggy Result: (136, 109)
    // Expected Correct Result: (PageWidth * 0.36) + 100 = 720 + 100 = 820
    if (y < 200) {
        console.log("❌ FAIL: Y value is too small (likely 53 + 56 = 109).");
        console.log("   This confirms the scaling failure and anchor mismatch.");
    } else {
        console.log("✅ PASS: Y value is sufficiently large (scaled into the page).");
    }
}

runScaleReproduction();
