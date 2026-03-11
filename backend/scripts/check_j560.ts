import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../../.env') });
import serviceAccount from '../secrets/service-account.json';

const app = initializeApp({
    credential: cert(serviceAccount as any),
    projectId: process.env.FIREBASE_PROJECT_ID
});
const db = getFirestore();

async function run() {
    console.log("Looking for ALL J560/01 papers in fullExamPapers...");
    const snapshot = await db.collection('fullExamPapers')
                             .where('metadata.exam_code', '==', 'J560/01')
                             .get();

    if (snapshot.empty) {
        console.log("No J560/01 papers found.");
    } else {
        snapshot.forEach(doc => {
            const m = doc.data().metadata;
            console.log(`Found: ${doc.id} | Series: ${m.exam_series} | Tier: ${m.tier}`);
        });
    }
}
run();
