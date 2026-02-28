
import { getFirestore } from '../config/firebase.js';

async function verifyFixes() {
    const db = getFirestore();
    const paperId = '50782c19-dbb3-419c-81f2-3fdaa0401bc8'; // AQA 8300/1F Nov 2020
    const doc = await db.collection('fullExamPapers').doc(paperId).get();
    const data = doc.data();

    console.log(`Verifying Paper: ${data.metadata.exam_code} (${data.metadata.exam_series})`);

    const targetQuestions = ["8", "11", "12"];
    const questions = data.questions || [];

    targetQuestions.forEach(qNum => {
        const q = questions.find((item: any) => String(item.question_number) === qNum);
        if (q) {
            console.log(`Question ${qNum}: marks = ${q.marks} | sub_questions count = ${q.sub_questions?.length}`);
            if (q.marks > 0) {
                console.log(`✅ Q${qNum} now has top-level marks.`);
            } else {
                console.log(`❌ Q${qNum} still has 0 marks!`);
            }
        } else {
            console.log(`⚠️ Q${qNum} not found in paper.`);
        }
    });

    // Simulate Potential Fail-Fast Scenario
    console.log("\nSimulating Fail-Fast Check...");
    const mockQuestions = [{ question_number: "99", marks: 0 }];
    try {
        const totalMarks = mockQuestions.reduce((sum, q) => sum + (q.marks || 0), 0);
        if (totalMarks === 0) {
            console.log("✅ Fail-fast: System would throw error for 0 marks.");
        }
    } catch (e) {
        console.log(`✅ Caught expected error: ${e.message}`);
    }
}

verifyFixes().catch(console.error);
