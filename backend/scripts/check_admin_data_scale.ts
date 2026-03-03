
import admin from 'firebase-admin';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
function initializeFirebase(): void {
    if (admin.apps.length === 0) {
        try {
            const serviceAccountPath = join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccountPath)
            });
            console.log('✅ Firebase Admin initialized');
        } catch (error) {
            console.error('❌ Firebase Admin initialization failed:', error);
            process.exit(1);
        }
    }
}

async function checkCounts() {
    initializeFirebase();
    const db = admin.firestore();

    const collections = ['fullExamPapers', 'markingSchemes', 'gradeBoundaries'];

    for (const coll of collections) {
        const snapshot = await db.collection(coll).get();
        console.log(`Collection ${coll}: ${snapshot.size} documents`);

        // Estimate total size of first 5 docs
        let totalSize = 0;
        const first5 = snapshot.docs.slice(0, 5);
        for (const doc of first5) {
            totalSize += JSON.stringify(doc.data()).length;
        }
        const avgSize = snapshot.size > 0 ? (totalSize / (first5.length || 1)) : 0;
        console.log(`Avg size (est): ${(avgSize / 1024).toFixed(2)} KB`);
        console.log(`Total estimated payload: ${(avgSize * snapshot.size / 1024).toFixed(2)} KB`);
        console.log('---');
    }
}

checkCounts().catch(console.error);
