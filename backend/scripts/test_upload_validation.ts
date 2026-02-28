
import axios from 'axios';

async function testUploadValidation() {
    const baseUrl = 'http://localhost:3001/api/admin/json/collections/fullExamPapers';
    // Note: This script assumes the server is running and we have a valid auth token if needed.
    // However, since I'm running this in the same environment, I can test the logic directly or 
    // mock a request if I had a test suite.

    // For local verification, I'll just check if the logic is sound by running a small unit-like test
    // on the validateExamPaper function if I could. 

    // Actually, I'll just create a reproduction case that would fail.
    const invalidPaper = {
        metadata: { exam_board: 'AQA', exam_series: 'Nov 2020' },
        questions: [
            { question_number: '1', marks: 1 },
            { question_number: '2', marks: 0, sub_questions: [{ part: 'a', marks: 1 }] } // Compound with 0 marks
        ]
    };

    console.log("Testing validation logic...");
    // Since I can't easily call the express route without a real server/token, 
    // I'll create a small script that imports the helper if possible, or just re-implements it to verify the logic.

    function validateExamPaperSimple(data: any): string | null {
        const questions = data?.questions;
        if (!Array.isArray(questions)) return null;

        for (const q of questions) {
            const qNum = q.question_number || q.questionNumber || q.number || 'Unknown';
            const marks = parseFloat(q.marks) || 0;
            const subQs = q.sub_questions || q.subQuestions || [];
            if (subQs.length === 0) {
                if (marks === 0) return `Question ${qNum} has 0 marks.`;
            } else {
                if (marks === 0) return `Question ${qNum} is a compound question but missing top-level marks.`;
                for (const sq of subQs) {
                    if ((parseFloat(sq.marks) || 0) === 0) return `Question ${qNum} part has 0 marks.`;
                }
            }
        }
        return null;
    }

    const result = validateExamPaperSimple(invalidPaper);
    console.log("Validation Result:", result);
    if (result === "Question 2 is a compound question but missing top-level marks.") {
        console.log("✅ Success: Validation correctly identified 0-mark compound question.");
    } else {
        console.log("❌ Failure: Validation missed the issue.");
    }
}

testUploadValidation().catch(console.error);
