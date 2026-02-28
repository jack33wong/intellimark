
import { getFirestore } from '../config/firebase.js';

async function checkNov2021() {
    const db = getFirestore();
    const snapshot = await db.collection('fullExamPapers')
        .where('metadata.exam_board', '==', 'AQA')
        .where('metadata.exam_series', '==', 'November 2021')
        .get();

    console.log(`Checking ${snapshot.size} papers for Nov 2021...`);

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const questions = data.questions || [];
        const samples = questions.slice(0, 10);
        console.log(`Checking ${data.metadata.exam_code}...`);
        samples.forEach(q => {
            if (q.sub_questions) {
                console.log(`  Q${q.question_number} sub_questions: ${q.sub_questions.length} | top-level marks: ${q.marks}`);
            }
        });
    }
}

checkNov2021().catch(console.error);
