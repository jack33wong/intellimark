
import { questionDetectionService } from '../services/marking/questionDetectionService.js';

async function runRealTest() {
    console.log("🧪 Diagnosing using REAL Service Logic");

    // REPRODUCTION CASE:
    // Need a pair that generates at least 2 common keys (to pass size >= 2 check)
    // but < 5 keys (to trigger the Safety Fix).
    // Keys: "fraction", "root" (Size = 2)
    const inputGeneric = "Calculate \\frac{1}{\\sqrt{2}}";
    const dbQuestion = "Calculate \\frac{x}{\\sqrt{y}}";

    console.log(`\nInput: "${inputGeneric}"`);
    console.log(`DB:    "${dbQuestion}"`);

    // CALL THE REAL SERVICE
    const score = questionDetectionService.calculateSimilarity(inputGeneric, dbQuestion);

    console.log(`\n----------------------------------------`);
    console.log(`REAL SERVICE SCORE: ${score.toFixed(4)}`);
    console.log(`----------------------------------------`);

    if (score > 0.85) {
        console.log("❌ FAIL: The service returns a HIGH MATCH for a weak overlap.");
        console.log("   This confirms the bug: '0.98' or '0.85' override triggered on few keys.");
    } else {
        console.log("✅ PASS: The service rejected the weak overlap (Score < 0.85).");
    }
}

runRealTest();
