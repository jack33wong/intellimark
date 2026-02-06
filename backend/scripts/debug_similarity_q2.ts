
import { SimilarityService } from '../services/marking/SimilarityService';

const input = "Write 5.3 x 10' as an ordinary";
const dbLatex = "Write $5.3 \\times 10^{4}$ as an ordinary number.";
const dbPlain = "Write 5.3 x 10^4 as an ordinary number."; // Hypothesis: maybe real DB is plain?

console.log("=== Debugging Q2 Similarity ===");
console.log(`Input: "${input}"`);
console.log(`DB (Latex): "${dbLatex}"`);

const scoreLatex = SimilarityService.calculateHybridScore(input, dbLatex, false);
console.log("\n--- Latex Score ---");
console.log(JSON.stringify(scoreLatex, null, 2));

console.log(`\nDB (Plain): "${dbPlain}"`);
const scorePlain = SimilarityService.calculateHybridScore(input, dbPlain, false);
console.log("\n--- Plain Score ---");
console.log(JSON.stringify(scorePlain, null, 2));

// Debug Normalization
// We need to access private/internal methods or just rely on the output. 
// Since normalizeTextForComparison is exported from Utils, let's allow it if we can import it.
// But mostly we just care about the output score to match 0.880.
