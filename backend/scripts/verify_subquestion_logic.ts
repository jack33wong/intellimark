
console.log("🔍 Verifying Sub-Question Filtering Logic...");

const testCases = [
    {
        qNum: "1",
        candidates: ["1a", "1b", "10", "11", "12", "1(i)"],
        expected: ["1a", "1b", "1(i)"]
    },
    {
        qNum: "2",
        candidates: ["2a", "2b", "20", "21", "22", "2(a)"],
        expected: ["2a", "2b", "2(a)"]
    },
    {
        qNum: "5",
        candidates: ["5", "5a", "5b", "50"],
        expected: ["5a", "5b"]
    },
    {
        qNum: "10",
        candidates: ["10a", "10b", "100", "1"],
        expected: ["10a", "10b"]
    }
];

let failures = 0;

testCases.forEach(tc => {
    const { qNum, candidates, expected } = tc;

    // Simulate the Controller Logic
    const result = candidates.filter(k => {
        if (!k.startsWith(qNum)) return false;
        if (k === qNum) return false;

        const suffix = k.slice(qNum.length);
        // [FIX] If suffix starts with a digit, it's a different question (e.g. 1 -> 10)
        if (/^\d/.test(suffix)) return false;

        // Allow letters, parens, Roman numerals in suffix
        return /^[a-z0-9()\[\]]+$/i.test(suffix);
    });

    // Compare matches
    const passed =
        result.length === expected.length &&
        result.every((val) => expected.includes(val));

    if (passed) {
        console.log(`✅ Q${qNum} PASSED: Got [${result.join(', ')}]`);
    } else {
        console.log(`❌ Q${qNum} FAILED`);
        console.log(`   Expected: [${expected.join(', ')}]`);
        console.log(`   Got:      [${result.join(', ')}]`);
        failures++;
    }
});

if (failures === 0) {
    console.log("\n✅ ALL TESTS PASSED: Sub-question matching is strict and correct.");
    process.exit(0);
} else {
    console.log(`\n❌ ${failures} TESTS FAILED`);
    process.exit(1);
}
