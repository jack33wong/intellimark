
import { normalizeTextForComparison } from '../utils/TextNormalizationUtils.js';
import * as stringSimilarity from 'string-similarity';

async function runTest() {
    console.log("🧪 Starting Text Normalization Collision Test (Refined V2)");

    // CASE: The Actual Failure (Q13 Phantom Match)
    // Hypothesis: The current logic removes delimiters AND spaces, gluing numbers to text.

    // Input: Generic "Work out the value of..." with fraction
    const inputGeneric = "Work out the value of \\frac{5}{\\sqrt{3}} - \\sqrt{6 \\frac{3}{4}}";

    // DB: "Work out the value of b / a" (generic algebra)
    // If we strip "b", "a", "/", this becomes "Work out the value of"
    const dbQuestion = "Work out the value of \\frac{b}{a}";

    console.log(`\nInput: "${inputGeneric}"`);
    console.log(`DB Query: "${dbQuestion}"`);

    // Current Normalization
    const normInput = normalizeTextForComparison(inputGeneric);
    const normDB = normalizeTextForComparison(dbQuestion);

    console.log(`\n[Normalized Input]: "${normInput}"`);
    console.log(`[Normalized DB]   : "${normDB}"`);

    // SIMULATE THE "PHANTOM MATH STRIPPING"
    // If the regex removes all non-numeric/alpha chars...
    // "frac" is currently KEPT in my previous test, which is why it passed.
    // But wait! Q13 score was 0.908.

    // Let's create the EXACT collision that would happen if "frac" WAS removed.
    // Maybe the input string didn't have "frac" in the logs?
    // Log says: "Work out the value of \frac{5}{\sqrt{3}}..."

    // Let's try matching against ITSELF but with different numbers.
    const dbQuestionClone = "Work out the value of \\frac{9}{\\sqrt{7}} - \\sqrt{2 \\frac{1}{5}}";

    const normClone = normalizeTextForComparison(dbQuestionClone);
    console.log(`\n[Normalized Clone]: "${normClone}"`);

    const similarity = stringSimilarity.compareTwoStrings(normInput, normClone);
    console.log(`\nSimilarity Score (Input vs Clone): ${similarity.toFixed(4)}`);

    if (similarity > 0.8) {
        console.log("\n❌ REPRODUCTION SUCCESS: High Similarity despite different numbers!");
        console.log("   The normalization is effectively treating all 'Work out fraction' questions as identical.");
    } else {
        console.log("\n✅ PASS?: Even seeing 'frac' and 'sqrt' allows differentiation?");
    }
}

runTest();
