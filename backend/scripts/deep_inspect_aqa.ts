
import { getFirestore } from '../config/firebase.js';

async function deepInspect() {
    const db = getFirestore();
    const paperId = '50782c19-dbb3-419c-81f2-3fdaa0401bc8';
    const doc = await db.collection('fullExamPapers').doc(paperId).get();
    const data = doc.data();
    const questions = data.questions || [];

    console.log(`Paper: ${data.metadata.exam_board} ${data.metadata.exam_code} ${data.metadata.exam_series}`);

    const targets = ['8', '9', '10', '11', '12'];
    targets.forEach(num => {
        const q = questions.find(q => String(q.question_number) === num);
        if (q) {
            console.log(`\n--- Q${num} Keys ---`);
            console.log(Object.keys(q));
            console.log(`marks value: ${q.marks}`);
            console.log(`type of marks: ${typeof q.marks}`);
            if (q.sub_questions) {
                console.log(`sub_questions present, count: ${q.sub_questions.length}`);
            }
        }
    });
}

deepInspect().catch(console.error);
