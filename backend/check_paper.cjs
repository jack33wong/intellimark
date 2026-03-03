const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

// Try to find service account
const serviceAccount = require('./config/serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function check() {
    const snapshot = await db.collection('fullExamPapers').get();
    console.log('--- Papers in DB ---');
    snapshot.forEach(doc => {
        const meta = doc.data().metadata;
        if (meta && meta.exam_code && meta.exam_code.includes('1MA1')) {
            console.log(`${meta.exam_board} - ${meta.exam_code} - ${meta.exam_series}, ${meta.tier}`);
        }
    });
}

check().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
