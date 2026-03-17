const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

async function run() {
    const snapshot = await db.collection('markingSchemes')
        .where('examDetails.paperCode', '==', '9MA0/31')
        .get();

    console.log('Matches found:', snapshot.size);
    snapshot.forEach(doc => {
        console.log('ID:', doc.id);
        const data = doc.data();
        console.log('Questions length:', data.questions ? (Array.isArray(data.questions) ? data.questions.length : Object.keys(data.questions).length) : 'MISSING');
    });
    process.exit();
}

run();
