
import { MarkingSchemeOrchestrationService } from '../services/marking/MarkingSchemeOrchestrationService.js';
import { questionDetectionService } from '../services/marking/questionDetectionService.js';

async function runTest() {
    console.log("🧪 Starting Upstream Question Detection Test (Refined)");

    // Mock the detection service
    const mockDetect = async (text: string, qNum: string, hint?: string) => {
        // If no hint, Q13 is not found
        if (!hint) {
            if (qNum === '12') {
                return {
                    found: true,
                    match: {
                        paperTitle: "Edexcel GCSE 1MA1/1H June 2022",
                        confidence: 0.95,
                        questionNumber: "12",
                        board: "Pearson Edexcel",
                        paperCode: "1MA1/1H",
                        examSeries: "June 2022",
                        tier: "Higher",
                        markingScheme: { questionMarks: { marks: [] } }
                    }
                };
            }
            return { found: false, message: "Low Similarity" };
        }

        // IF HINT PROVIDED (Consensus forcing)
        // Q13 is "rescued" into the wrong paper with high confidence
        if (qNum === '13' && hint.includes("1MA1")) {
            return {
                found: true,
                match: {
                    paperTitle: "Edexcel GCSE 1MA1/1H June 2022",
                    confidence: 0.91, // High but wrong
                    questionNumber: "13",
                    board: "Pearson Edexcel",
                    paperCode: "1MA1/1H",
                    examSeries: "June 2022",
                    tier: "Higher",
                    markingScheme: { questionMarks: { marks: [] } }
                }
            };
        }

        return { found: false };
    };

    (questionDetectionService as any).detectQuestion = mockDetect;

    const mockQuestions = [
        { text: "Put these in order starting with the smallest...", questionNumber: "12" },
        { text: "Work out the value of a complex expression...", questionNumber: "13" }
    ];

    const mockClassification = { questions: mockQuestions };

    console.log("\n--- Testing Orchestration (Consensus Check) ---");
    const result = await MarkingSchemeOrchestrationService.orchestrateMarkingSchemeLookup(
        mockQuestions,
        mockClassification,
        null
    );

    console.log("\n--- Results ---");
    result.detectionResults.forEach(dr => {
        const qNum = dr.question.questionNumber;
        const title = dr.detectionResult.match?.paperTitle || "GENERIC";
        const found = dr.detectionResult.found;
        const confidence = dr.detectionResult.match?.confidence || 0;
        const note = dr.detectionResult.message || "";

        console.log(`[Q${qNum}] ${found ? 'MATCHED' : 'GENERIC'} -> ${title} (Conf: ${confidence}) ${note}`);
    });

    const q13 = result.detectionResults.find(r => r.question.questionNumber === '13');
    const q13Title = q13?.detectionResult.match?.paperTitle || "";
    if (q13Title.includes("Edexcel") && q13?.detectionResult.message?.includes("Rescued")) {
        console.log("\n❌ REPRODUCTION SUCCESS: Q13 was INCORRECTLY forced into Edexcel consensus.");
    } else {
        console.log("\n✅ SUCCESS: Q13 remained generic or was not forced.");
    }
}

runTest().catch(e => {
    console.error("Test failed:", e);
    process.exit(1);
});
