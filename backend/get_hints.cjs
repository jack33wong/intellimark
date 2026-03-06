const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
const fs = require('fs');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function getHintsForPapers(paperIds) {
    let allReport = '';

    for (const paperId of paperIds) {
        console.log(`🔍 Fetching Paper: ${paperId}`);
        const doc = await db.collection('fullExamPapers').doc(paperId).get();

        if (!doc.exists) {
            console.log(`❌ Paper ${paperId} not found.`);
            continue;
        }

        const data = doc.data();
        const meta = data.metadata || {};
        const title = meta.paper_title || 'Unknown';
        const board = meta.exam_board || 'Unknown';
        const code = meta.exam_code || 'Unknown';

        let report = `\n================================================================================\n`;
        report += `PAPER: ${board} | ${code} | ${title}\n`;
        report += `ID: ${paperId}\n`;
        report += `================================================================================\n\n`;

        const questions = data.questions || data.items || [];

        questions.forEach(q => {
            const qNum = q.number || q.question_number || 'Unknown';
            const text = q.question_text || q.text || '';
            const hints = q.diagram_hints || q.hints || [];
            const subQuestions = q.sub_questions || q.subQuestions || [];

            if (hints.length > 0) {
                report += `[Q${qNum}] ${text.substring(0, 80).replace(/\n/g, ' ')}...\n`;
                hints.forEach((h, i) => {
                    report += `  - HINT ${i + 1}: ${JSON.stringify(h, null, 2).replace(/\n/g, '\n    ')}\n`;
                });
                report += `\n`;
            }

            subQuestions.forEach((sq, idx) => {
                const sqNum = sq.number || sq.question_number || `${qNum}${String.fromCharCode(97 + idx)}`;
                const sqText = sq.question_text || sq.text || '';
                const sqHints = sq.diagram_hints || sq.hints || [];
                if (sqHints.length > 0) {
                    report += `  [Q${sqNum}] ${sqText.substring(0, 80).replace(/\n/g, ' ')}...\n`;
                    sqHints.forEach((h, i) => {
                        report += `    - HINT ${i + 1}: ${JSON.stringify(h, null, 2).replace(/\n/g, '\n      ')}\n`;
                    });
                    report += `\n`;
                }
            });
        });

        allReport += report;
    }

    fs.writeFileSync('diverse_diagram_hints.txt', allReport);
    console.log('✅ Diverse hints written to diverse_diagram_hints.txt');
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
    console.log('Usage: node get_hints.cjs <paperId1> <paperId2> ...');
    process.exit(1);
}

getHintsForPapers(ids).then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
