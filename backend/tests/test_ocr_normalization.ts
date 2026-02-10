import { normalizeMarkingScheme } from '../services/marking/MarkingInstructionService.js';

async function testOcrNormalization() {
    console.log('🧪 Testing OCR Normalization Logic...\n');

    // Case 1: OCR-style concatenated marks with M1/A1
    const ocrInput = {
        marks: [
            {
                mark: "2",
                comments: "M1 for substituting values into the formula, A1 for 45.6",
                answer: "cao"
            }
        ],
        questionLevelAnswer: "45.6",
        questionNumber: "5"
    };

    console.log('--- Test Case 1: OCR Concatenated Marks ---');
    const normalized1 = normalizeMarkingScheme(ocrInput);
    if (!normalized1) {
        console.error('❌ Failed to normalize Case 1');
    } else {
        console.log('Result Marks:', JSON.stringify(normalized1.marks, null, 2));
        const hasM1 = normalized1.marks.some(m => m.mark === 'M1');
        const hasA1 = normalized1.marks.some(m => m.mark === 'A1');
        const m1Answer = normalized1.marks.find(m => m.mark === 'M1')?.answer;
        const a1Answer = normalized1.marks.find(m => m.mark === 'A1')?.answer;

        if (hasM1 && hasA1 && m1Answer && a1Answer === '45.6' && normalized1.marks.length === 2) {
            console.log('✅ Case 1 Passed: Correctly split into M1, A1 and resolved tokens');
        } else {
            console.error('❌ Case 1 Failed: Split or token extraction incorrect');
            console.log('Actual M1 Answer:', m1Answer);
            console.log('Actual A1 Answer:', a1Answer);
        }
    }

    // Case 2: Sub-questions with OCR patterns
    const subQInput = {
        questionNumber: "10",
        totalMarks: 3,
        subQuestionMarks: {
            "10a": [
                {
                    mark: "1",
                    comments: "B1: cao",
                    answer: "Ignored"
                }
            ],
            "10b": [
                {
                    mark: "2",
                    comments: "M1 for method, A1 for answer 12",
                    answer: "12"
                }
            ]
        },
        subQuestionAnswersMap: {
            "10a": "Circle centered at (0,0)"
        }
    };

    console.log('\n--- Test Case 2: Sub-questions with OCR patterns ---');
    const normalized2 = normalizeMarkingScheme(subQInput);
    if (!normalized2 || !normalized2.subQuestionMarks) {
        console.error('❌ Failed to normalize Case 2');
    } else {
        const marks10a = normalized2.subQuestionMarks["10a"];
        const marks10b = normalized2.subQuestionMarks["10b"];

        console.log('10a Marks:', JSON.stringify(marks10a, null, 2));
        console.log('10b Marks:', JSON.stringify(marks10b, null, 2));

        const caoResolved10a = marks10a[0].answer === "Circle centered at (0,0)";
        const split10b = marks10b.length === 2 && marks10b[0].mark === 'M1' && marks10b[1].mark === 'A1';

        if (caoResolved10a && split10b) {
            console.log('✅ Case 2 Passed: Correctly handled sub-questions and CAO in comments');
        } else {
            console.error('❌ Case 2 Failed: Sub-question processing incorrect');
            console.log('Actual 10a Answer:', marks10a[0].answer);
        }
    }

    // Case 3: Auto-balancing logic
    const balancingInput = {
        marks: [
            {
                mark: "3",
                comments: "M1 for step 1",
                answer: "Correct solution"
            }
        ],
        questionNumber: "7"
    };

    console.log('\n--- Test Case 3: Auto-balancing logic ---');
    const normalized3 = normalizeMarkingScheme(balancingInput);
    if (!normalized3) {
        console.error('❌ Failed to normalize Case 3');
    } else {
        console.log('Result Marks:', JSON.stringify(normalized3.marks, null, 2));
        const hasM1 = normalized3.marks.some(m => m.mark === 'M1');
        const hasM2 = normalized3.marks.some(m => m.mark === 'M2'); // Balanced mark

        if (hasM1 && hasM2 && normalized3.marks.length === 2) {
            console.log('✅ Case 3 Passed: Correctly balanced marks with M2');
        } else {
            console.error('❌ Case 3 Failed: Balancing logic incorrect');
        }
    }

    // Case 4: Default "A" prefix for numeric marks
    const prefixInput = {
        questionNumber: "1b",
        marks: [
            {
                mark: "1",
                comments: "Accept 7",
                answer: "A multiple of 7"
            }
        ]
    };

    console.log('\n--- Test Case 4: Default "A" Prefix ---');
    const normalized4 = normalizeMarkingScheme(prefixInput);
    if (!normalized4) {
        console.error('❌ Failed to normalize Case 4');
    } else {
        console.log('Result Marks:', JSON.stringify(normalized4.marks, null, 2));
        const isA1 = normalized4.marks[0].mark === 'A1';

        if (isA1) {
            console.log('✅ Case 4 Passed: Correctly prefixed "1" as "A1"');
        } else {
            console.error('❌ Case 4 Failed: Mark remains "1", expected "A1"');
        }
    }
}

testOcrNormalization().catch(console.error);
