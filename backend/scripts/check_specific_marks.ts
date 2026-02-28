
import { getFirestore } from '../config/firebase.js';

async function checkSpecifics() {
    const db = getFirestore();
    const paperId = '50782c19-dbb3-419c-81f2-3fdaa0401bc8';
    const doc = await db.collection('fullExamPapers').doc(paperId).get();
    const data = doc.data();
    const questions = data.questions || [];

    for (const num of ['8', '11']) {
        const q = questions.find(q => String(q.question_number) === num);
        console.log(`\n--- Q${num} ---`);
        if (q) {
            console.log(`Top-level marks: ${q.marks}`);
            if (q.sub_questions) {
                console.log(`Sub-questions: ${q.sub_questions.length}`);
                q.sub_questions.forEach((sq: any) => {
                    console.log(`  Part ${sq.question_part}: marks=${sq.marks}`);
                });
            }
        }
    }
}

checkSpecifics().catch(console.error);
