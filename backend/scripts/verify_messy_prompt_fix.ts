
import { SuggestedFollowUpService } from '../services/marking/suggestedFollowUpService.js';

console.log("🔍 Verifying stringifyMarkingScheme logic...");

const testCases = [
    {
        name: "Standard Auto-balanced",
        scheme: {
            marks: [
                { mark: 'M1', answer: '654', comments: 'Auto-balanced' }
            ]
        },
        expected: "- M1: 654 "
    },
    {
        name: "Parenthesized Auto-balanced (Legacy)",
        scheme: {
            marks: [
                { mark: 'M1', answer: '654', comments: '(Auto-balanced)' }
            ]
        },
        expected: "- M1: 654 "
    },
    {
        name: "Normal Comment",
        scheme: {
            marks: [
                { mark: 'M1', answer: '81 x 8', comments: 'implied by 648' }
            ]
        },
        expected: "- M1: 81 x 8 (implied by 648)"
    },
    {
        name: "Mixed Comments",
        scheme: {
            marks: [
                { mark: 'M1', answer: 'A', comments: 'Auto-balanced' },
                { mark: 'M2', answer: 'B', comments: 'ft' }
            ]
        },
        expected: "- M1: A \n- M2: B (ft)"
    }
];

let failures = 0;

testCases.forEach(tc => {
    const result = SuggestedFollowUpService.stringifyMarkingScheme(tc.scheme);
    // Trim both for comparison to ignore trivial whitespace differences
    const normResult = result.trim();
    const normExpected = tc.expected.trim();

    if (normResult === normExpected) {
        console.log(`✅ ${tc.name} PASSED`);
        console.log(`   Output: ${JSON.stringify(result)}`);
    } else {
        console.log(`❌ ${tc.name} FAILED`);
        console.log(`   Expected: ${JSON.stringify(tc.expected)}`);
        console.log(`   Got:      ${JSON.stringify(result)}`);
        failures++;
    }
});

if (failures === 0) {
    console.log("\n✅ ALL TESTS PASSED: 'Auto-balanced' is correctly stripped from prompts.");
    process.exit(0);
} else {
    console.log(`\n❌ ${failures} TESTS FAILED`);
    process.exit(1);
}
