const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function findAQAPapers() {
    try {
        const snapshot = await db.collection('fullExamPapers')
            .where('metadata.exam_board', '==', 'AQA')
            .where('metadata.exam_code', '==', '8300/3F')
            .get();

        if (snapshot.empty) {
            console.log('No matching AQA papers found.');
            return;
        }

        console.log(`Found ${snapshot.size} papers for AQA 8300/3F.`);
        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`--- Paper ID: ${doc.id}`);
            console.log(`Series: ${data.metadata.exam_series}`);
            if (data.questions && data.questions.length > 0) {
                const q1 = data.questions.find(q => (q.question_number || q.number) === "1");
                console.log('Q1 Content:', JSON.stringify(q1, null, 2));
            }
        });
    } catch (error) {
        console.error('Error:', error);
    }
}

findAQAPapers();
