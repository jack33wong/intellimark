
import { getFirestore } from '../config/firebase.js';

async function searchHarry() {
    const db = getFirestore();
    const snapshot = await db.collection('fullExamPapers').get();
    console.log(`Searching through ${snapshot.size} papers...`);

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const questions = data.questions || [];
        const harry = questions.find(q =>
            (q.question_text && q.question_text.includes("Harry will pay income tax")) ||
            (q.text && q.text.includes("Harry will pay income tax"))
        );

        if (harry) {
            console.log(`✅ Found in Paper: ${doc.id}`);
            console.log(`Metadata:`, JSON.stringify(data.metadata, null, 2));
            console.log(`Question:`, JSON.stringify(harry, null, 2));
            return;
        }
    }
    console.log("❌ Not found in fullExamPapers");
}

searchHarry().catch(console.error);
