
import { getFirestore } from '../config/firebase';

async function checkRealData() {
    const db = getFirestore();
    if (!db) {
        console.error("Firestore not available");
        return;
    }

    const snapshot = await db.collection('fullExamPapers').get();
    console.log(`Summary: Found ${snapshot.size} papers in fullExamPapers`);

    snapshot.forEach(doc => {
        const data = doc.data();
        const meta = data.metadata || {};
        if (meta.exam_code === '1MA1/3H') {
            console.log(`[MATCH] Found 1MA1/3H: ID=${doc.id}, Board=${meta.exam_board}, Series=${meta.exam_series}`);
        }
    });
}

checkRealData().catch(console.error);
