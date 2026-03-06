const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function checkCircleQuestions() {
    const snapshot = await db.collection('fullExamPapers').get();
    const results = [];

    snapshot.forEach(doc => {
        const data = doc.data();
        const questions = data.questions || [];
        questions.forEach(q => {
            const qText = (q.text || '').toLowerCase();
            if (qText.includes('circle')) {
                results.push({ paper: doc.id, num: q.number, text: q.text });
            }
            const subQuestions = (q.subQuestions || q.sub_questions || []);
            subQuestions.forEach(sq => {
                const sqText = (sq.text || '').toLowerCase();
                if (sqText.includes('circle')) {
                    results.push({ paper: doc.id, num: q.number + (sq.part || ''), text: sq.text });
                }
            });
        });
    });

    console.log(JSON.stringify(results, null, 2));
}

checkCircleQuestions();
