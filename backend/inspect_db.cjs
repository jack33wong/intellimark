const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function inspectPapers() {
    try {
        const snapshot = await db.collection('fullExamPapers').limit(2).get();
        if (snapshot.empty) {
            console.log('No papers found.');
            return;
        }

        snapshot.forEach(doc => {
            console.log('--- Paper ID:', doc.id);
            const data = doc.data();
            console.log('Metadata:', JSON.stringify(data.metadata, null, 2));
            if (data.questions) {
                console.log('Number of questions:', data.questions.length);
                if (data.questions.length > 0) {
                    console.log('First question sample:', JSON.stringify(data.questions[0], null, 2));
                }
            } else {
                console.log('No questions field found.');
            }
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

inspectPapers();
