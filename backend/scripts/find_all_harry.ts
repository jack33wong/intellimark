
import { getFirestore } from '../config/firebase.js';

async function findAllHarry() {
    const db = getFirestore();
    const snapshot = await db.collection('fullExamPapers').get();

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const questions = data.questions || [];
        const harry = questions.find(q =>
            (q.question_text && q.question_text.includes("Harry will pay income tax")) ||
            (q.text && q.text.includes("Harry will pay income tax"))
        );

        if (harry) {
            console.log(`✅ Found Paper: ${doc.id} | ${data.metadata.exam_board} | ${data.metadata.exam_code} | ${data.metadata.exam_series}`);
            console.log(`Q9 marks: ${harry.marks}`);
        }
    }
}

findAllHarry().catch(console.error);
