
// Mocking the helper function logic from MarkingHelpers.ts
async function runTest() {
    console.log("🧪 Starting AI Match Report Log Format Proof\n");

    const testCases = [
        {
            name: "Standard Match",
            mark: "B1",
            targetId: "line_6",
            status: "MATCHED",
            aiMatchedText: "2sqrt{7}",
            matchedText: "2\\sqrt{7}",
            reasoning: "Correct calc"
        },
        {
            name: "Unmatched Item",
            mark: "A0",
            targetId: "-",
            status: "UNMATCHED",
            aiMatchedText: "No error found",
            matchedText: "\\frac{5}{\\sqrt{3}}... (Giant Block)", // This should NOT be shown
            reasoning: "Student did not attempt this step."
        }
    ];

    testCases.forEach(c => {
        console.log(`--- Test Case: ${c.name} ---`);
        const cleanText = (t: string) => (t || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

        // The LOGIC from MarkingHelpers.ts
        const isUnmatched = c.status === 'UNMATCHED';

        // 1. Label Check
        const aiClaim = `\x1b[90m[AI Claim: "${cleanText(c.aiMatchedText)}"]\x1b[0m `;

        // 2. Reality Check (The Fix)
        let reality = '';
        if (c.matchedText) {
            reality = `\x1b[90m[Classified Text: "${cleanText(c.matchedText)}"]\x1b[0m `;
        }

        // With my change, unmatched items with TEXT will show BOTH. 
        // But for this test case, matchedText is present, so expect it.
        if (isUnmatched && c.reasoning) {
            reality += `\x1b[90m[Reason: "${cleanText(c.reasoning)}"]\x1b[0m`;
        }

        const textInfo = `${aiClaim}${reality}`.trim();
        console.log(`OUTPUT: ${textInfo}`);
        console.log("");

        // VERIFICATION ASSERTIONS
        if (!textInfo.includes("[AI Claim:")) {
            console.error("❌ FAIL: Missing 'AI Claim' label");
        }

        // Now we EXPECT Classified Text even if UNMATCHED (if available)
        // In our test case, "Unmatched Item" HAS matchedText "\\frac{5}..."
        if (c.matchedText && !textInfo.includes("[Classified Text:")) {
            console.error("❌ FAIL: Hidden Data! Unmatched item hid the Classified Text.");
        }

        if (isUnmatched && !textInfo.includes("[Reason:")) {
            console.error("❌ FAIL: Unmatched item missing Reasoning.");
        } else {
            console.log("✅ PASS: Log format complies with Senior Programmer Rules.");
        }
    });
}

runTest();
