import { enrichAnnotationsWithPositions } from '../services/marking/AnnotationEnrichmentService.js';

async function runReproduction() {
    console.log("🚀 Starting Reproduction: Q12 Regression Case");

    // 1. Mock OCR Blocks (as they appear in MarkingExecutor)
    const stepsDataForMapping = [
        { line_id: "line_8", text: "Smallest 2\\sqrt{5}", isHandwritten: true, bbox: [24, 39, 9, 2], pageIndex: 0 },
        { line_id: "line_10", text: "Largest 2\\sqrt{7}", isHandwritten: true, bbox: [24, 43, 8, 2], pageIndex: 0 },
        { line_id: "block_0_9", text: "\\text { Smallest }  \\frac{2 \\sqrt{3}}{2 \\sqrt{6}} &", isHandwritten: false, bbox: [12, 18, 5, 2], pageIndex: 0 },
        { line_id: "block_0_10", text: "\\hline \\text { Largest } \\frac{2 \\sqrt{7}}{} & \\text { (Total 3 marks) }", isHandwritten: false, bbox: [20, 12, 2, 2], pageIndex: 0 },
    ];

    // 2. Mock AI Output (The "Wrong" matched IDs)
    const annotations = [
        { text: "B1 B1", line_id: "block_0_9", reasoning: "Smallest value correctly identified.", studentText: "Smallest 2\\sqrt{5}", subQuestion: "a" },
        { text: "B1", line_id: "block_0_10", reasoning: "Largest value correctly identified.", studentText: "Largest 2\\sqrt{7}", subQuestion: "a" }
    ];

    // 3. Mock Dimensions
    const pageDimensions = new Map([[0, { width: 1000, height: 1400 }]]);

    // 4. Global Offsets
    const globalOffsetX = 100;
    const globalOffsetY = 56;

    console.log("\n--- TEST: enrichAnnotationsWithPositions ---");
    const enriched = enrichAnnotationsWithPositions(
        annotations as any,
        stepsDataForMapping as any,
        "12",
        0,
        pageDimensions,
        [],
        {} as any,
        "",
        globalOffsetX,
        globalOffsetY
    );

    enriched.forEach((anno, i) => {
        console.log(`\nAnnotation ${i}: [${anno.text}]`);
        console.log(`  Target ID: ${anno.line_id}`);
        console.log(`  BBox: ${JSON.stringify(anno.bbox)}`);
        console.log(`  Status: ${anno.ocr_match_status}`);

        // Assertions (Logical)
        const isPrintedBlock = anno.line_id?.startsWith('block_');
        if (isPrintedBlock && anno.ocr_match_status === 'MATCHED') {
            console.error(`  ❌ FAIL: Annotation matched to PRINTED block ${anno.line_id}`);
        } else {
            console.log(`  ✅ OK: Correct status/homing`);
        }
    });
}

runReproduction().catch(console.error);
