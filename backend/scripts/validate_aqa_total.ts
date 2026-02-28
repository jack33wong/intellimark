
import { getFirestore } from '../config/firebase.js';

async function validateTotalMarks() {
    const db = getFirestore();
    const paperId = '50782c19-dbb3-419c-81f2-3fdaa0401bc8';
    const doc = await db.collection('fullExamPapers').doc(paperId).get();
    const data = doc.data();

    const metadataTotal = data.metadata.total_marks;
    const questions = data.questions || [];

    let calculatedTotal = 0;
    questions.forEach(q => {
        let qMarks = q.marks || 0;
        if (qMarks === 0 && q.sub_questions) {
            qMarks = q.sub_questions.reduce((sum, sq) => sum + (sq.marks || 0), 0);
        }
        calculatedTotal += qMarks;
    });

    console.log(`Paper: ${data.metadata.exam_board} ${data.metadata.exam_code}`);
    console.log(`Metadata Total Marks: ${metadataTotal}`);
    console.log(`Calculated Total Marks (with aggregation): ${calculatedTotal}`);

    if (metadataTotal === calculatedTotal) {
        console.log("✅ Success: Aggregation matches metadata total!");
    } else {
        console.log("❌ Mismatch: Check for other missing marks.");
    }
}

validateTotalMarks().catch(console.error);
