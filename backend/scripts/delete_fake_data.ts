
import { getFirestore } from '../config/firebase';

async function deleteFakeData() {
    const db = getFirestore();
    if (!db) return;
    await db.collection('fullExamPapers').doc('mock_1MA1_3H_seeded').delete();
    console.log("🗑️ Deleted mock_1MA1_3H_seeded from Firestore.");
}

deleteFakeData().catch(console.error);
