const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

async function run() {
    const doc = await db.collection('markingSchemes').doc('c4bc7f3e-97bd-4c04-a30d-c9b104e47518').get();
    const data = doc.data();
    console.log('Questions structure:', Array.isArray(data.questions) ? 'Array' : typeof data.questions);
    if (data.questions && data.questions.length > 0) {
        console.log('First Question:', JSON.stringify(data.questions[0], null, 2));
    }
    process.exit();
}

run();
