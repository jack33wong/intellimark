const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function list() {
    const snapshot = await db.collection('fullExamPapers')
        .where('metadata.exam_board', '==', 'AQA')
        .where('metadata.exam_series', '==', 'November 2024')
        .get();

    console.log(`Docs found: ${snapshot.size}`);
    snapshot.forEach(doc => {
        const data = doc.data();
        const meta = data.metadata || {};
        console.log(`- ${doc.id}: ${meta.exam_code} - ${meta.paper_title}`);
        const questions = data.questions || [];
        if (questions.length > 0) {
            const q = questions[0];
            const sqs = q.subQuestions || q.sub_questions || [];
            console.log(`  Q${q.number || q.question_number} has ${sqs.length} sub-questions`);
            if (sqs.length > 0) {
                console.log('  First SQ fields:', Object.keys(sqs[0]));
                console.log('  First SQ numbering:', { number: sqs[0].number, part: sqs[0].part, sub_number: sqs[0].sub_number });
            }
        }
    });
}

list();
