
import { logRawAiMarkingReport } from '../services/marking/MarkingHelpers.js';
import type { QuestionResult } from '../types/marking.js';

// SIMULATING MARKING PIPELINE SERVICE LOGIC
// We export this function to test the EXACT logic used in the pipeline
// Reference: MarkingPipelineService.ts (Line 1713)
function gatherAllBlocks(allPagesOcrData: any[]) {
    return allPagesOcrData.flatMap(page => {
        let ocrIdx = 0;
        const blocks: any[] = [];

        // 1. Mathpix/Vision Blocks
        if (page.ocrData?.mathBlocks) {
            page.ocrData.mathBlocks.forEach((b: any) => {
                blocks.push({ ...b, id: b.globalBlockId || `block_${page.pageIndex}_${ocrIdx++}` });
            });
        }
        if (page.ocrData?.blocks) {
            page.ocrData.blocks.forEach((b: any) => {
                blocks.push({ ...b, id: b.globalBlockId || `block_${page.pageIndex}_${ocrIdx++}` });
            });
        }

        // 2. Classification Blocks (The logic I added)
        if (page.classificationResult?.questions) {
            page.classificationResult.questions.forEach((q: any) => {
                if (q.studentWorkLines) {
                    q.studentWorkLines.forEach((l: any) => {
                        blocks.push({ text: l.text, id: l.id });
                    });
                }
                if (q.subQuestions) {
                    q.subQuestions.forEach((sq: any) => {
                        if (sq.studentWorkLines) {
                            sq.studentWorkLines.forEach((l: any) => {
                                blocks.push({ text: l.text, id: l.id });
                            });
                        }
                    });
                }
            });
        }
        return blocks;
    });
}

async function runTest() {
    console.log("🧪 Starting RIGOROUS Transparency Log Test\n");

    // 1. Mock Raw AI Data (The "Truth")
    const mockQuestionResults: QuestionResult[] = [
        {
            questionNumber: "12",
            score: { awardedMarks: 1, totalMarks: 1, scoreText: "1/1" },
            rawAnnotations: [
                {
                    line_id: "line_13", // <--- The ID the AI cited
                    text: "B1",
                    studentText: "Smallest 2sqrt{5}", // What AI saw
                    ocr_match_status: "MATCHED"
                }
            ]
        } as any
    ];

    // 2. Mock The Full Pipeline Data Structure (Where the bug happened)
    // The bug was that 'classificationResult' was undefined or not accessible on 'page'
    const fullPipelineData = [
        {
            pageIndex: 0,
            ocrData: {
                mathBlocks: [{ id: "block_0_1", text: "Q12." }]
            },
            // THIS is the property we need to test access to
            classificationResult: {
                questions: [
                    {
                        questionNumber: "12",
                        studentWorkLines: [
                            { id: "line_13", text: "Smallest 2sqrt{5}" } // Ground Truth
                        ]
                    }
                ]
            }
        }
    ];

    console.log("--- TEST CONFIGURATION ---");
    console.log("Input Structure has classificationResult?", !!fullPipelineData[0].classificationResult);

    // 3. EXECUTE THE LOGIC
    console.log("\n--- EXECUTING BLOCK GATHERING ---");
    const gatheredBlocks = gatherAllBlocks(fullPipelineData);

    console.log(`Gathered ${gatheredBlocks.length} blocks.`);
    const foundTarget = gatheredBlocks.find(b => b.id === "line_13");

    if (foundTarget) {
        console.log("✅ SUCCESS: Found target block 'line_13' in classification data.");
        console.log("   Text:", foundTarget.text);
    } else {
        console.error("❌ FAILURE: logic failed to extract 'line_13' from classificationResult.");
    }

    // 4. GENERATE REPORT
    console.log("\n--- GENERATING REPORT ---");
    logRawAiMarkingReport(mockQuestionResults, gatheredBlocks);
}

runTest();
