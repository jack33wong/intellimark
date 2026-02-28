
import { getFirestore } from '../config/firebase.js';

async function inspectPaper() {
    const db = getFirestore();
    const paperId = '50782c19-dbb3-419c-81f2-3fdaa0401bc8';
    const doc = await db.collection('fullExamPapers').doc(paperId).get();

    if (!doc.exists) {
        console.error("Paper not found");
        return;
    }

    const data = doc.data();
    const questions = data.questions || [];

    console.log(`Paper: ${data.metadata.exam_board} ${data.metadata.exam_code} ${data.metadata.exam_series}`);

    const targetNums = ['8', '9', '10', '11', '12'];
    for (const num of targetNums) {
        const q = questions.find(q => String(q.question_number) === num);
        if (q) {
            console.log(`\n--- Question ${num} ---`);
            console.log(JSON.stringify(q, null, 2));
        } else {
            console.log(`\n--- Question ${num} NOT FOUND ---`);
        }
    }
}

inspectPaper().catch(console.error);
