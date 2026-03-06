const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
const fs = require('fs');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function inspectPaperDiagrams() {
    console.log('🔍 Inspecting AQA Nov 2022 8300/3H...');

    const examCode = '8300/3H';
    const seriesYear = '2022';
    const seriesMonth = 'November';

    console.log(`🔍 Searching for ${examCode} in ${seriesMonth} ${seriesYear}...`);

    const snapshot = await db.collection('fullExamPapers').get();

    let paperDoc = null;
    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const metadata = data.metadata || {};
        const series = metadata.exam_series || '';
        const code = metadata.exam_code || '';
        if (code === examCode && series.includes(seriesYear) && (series.includes(seriesMonth) || series.includes('Nov'))) {
            paperDoc = doc;
        }
    });

    if (!paperDoc) {
        console.log('❌ Paper not found.');
        return;
    }
    const paperId = paperDoc.id;
    const paperData = paperDoc.data();
    console.log(`✅ Found paper: ${paperId}`);

    let report = `# Diagram Conversion Analysis: AQA Nov 2022 8300/3H\n\n`;
    report += `Paper ID: ${paperId}\n\n`;

    const questions = paperData.questions || paperData.items || [];

    questions.forEach(q => {
        const qNum = q.number || q.question_number || 'Unknown';
        const text = q.question_text || q.text || '';
        const subQuestions = q.sub_questions || q.subQuestions || [];

        report += `## Question ${qNum}\n`;
        report += `**Text Snippet**: ${text.substring(0, 150).replace(/\n/g, ' ')}...\n`;

        const processQ = (item, prefix = '') => {
            const hints = item.diagram_hints || item.hints || [];
            const images = item.images || [];

            if (hints.length > 0) {
                report += `**${prefix}Diagram Hints Content**:\n`;
                hints.forEach((h, i) => {
                    report += `- Hint ${i + 1}: ${JSON.stringify(h, null, 2).replace(/\n/g, '\n' + prefix + '  ')}\n`;
                });
            }

            if (images.length > 0) {
                report += `**${prefix}Images (${images.length})**:\n`;
                images.forEach((img, i) => {
                    report += `- ${i + 1}: ${JSON.stringify(img)}\n`;
                });
            }

            const possibleFields = ['mermaid_code', 'svg_code', 'tikz_code', 'converted_content', 'diagram_data', 'diagram_json'];
            possibleFields.forEach(field => {
                if (item[field]) {
                    const val = item[field];
                    const summary = typeof val === 'string' ? `(Length: ${val.length})` : `(Type: ${typeof val})`;
                    report += `**${prefix}${field}**: Found ${summary}\n`;
                }
            });
        };

        processQ(q);
        subQuestions.forEach((sq, idx) => {
            const sqNum = sq.number || sq.question_number || `${qNum}${String.fromCharCode(97 + idx)}`;
            report += `### Sub-question ${sqNum}\n`;
            processQ(sq, '  ');
        });

        report += `\n---\n\n`;
    });

    fs.writeFileSync('diagram_quality_report_final.md', report);
    console.log('✅ Analysis report written to diagram_quality_report_final.md');
}

inspectPaperDiagrams().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
