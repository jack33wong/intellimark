const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'intellimark-73062'
    });
}

const db = admin.firestore();

async function listPapers() {
    console.log('📋 Listing AQA papers...');
    const snapshot = await db.collection('exam_papers')
        .where('metadata.exam_board', '==', 'AQA')
        .get();

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const meta = data.metadata || {};
        console.log(`ID: ${doc.id} | Code: ${meta.exam_code} | Series: ${meta.exam_series}`);
    });
}

listPapers().catch(console.error);
