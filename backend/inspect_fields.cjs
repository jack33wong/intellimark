const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function inspect() {
    const snapshot = await db.collection('fullExamPapers')
        .where('metadata.exam_board', '==', 'AQA')
        .where('metadata.exam_series', '==', 'November 2024')
        .where('metadata.exam_code', '==', '8300/1F')
        .get();

    snapshot.forEach(doc => {
        const data = doc.data();
        const questions = data.questions || [];
        const q14 = questions.find(q => q.number == '14');
        if (q14) {
            console.log('Q14 Sub-questions:', JSON.stringify(q14.subQuestions || q14.sub_questions, null, 2));
        }
    });
}

inspect();
