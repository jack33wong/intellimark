const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

const DIAGRAM_KEYWORDS = [
    'triangle', 'parallelogram', 'quadrilateral', 'rectangle', 'circle', 'sector', 'radius', 'diameter', 'chord', 'tangent',
    'cylinder', 'cone', 'pyramid', 'prism', 'polygon', 'trapezium', 'rhombus',
    'graph', 'grid', 'axis', 'axes', 'coordinates', 'plot', 'draw', 'sketch',
    'bar chart', 'histogram', 'pie chart', 'venn diagram', 'cumulative frequency', 'scatter graph', 'frequency polygon',
    'angle', 'degrees', 'bearing', '3d', 'cross-section', 'volume of cylinder', 'surface area'
];

function likelyNeedsDiagram(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return DIAGRAM_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

function hasHint(text) {
    if (!text) return false;
    return /\[.*?\]/.test(text);
}

async function runAudit() {
    console.log('🚀 Starting Audit of fullExamPapers...');
    const stats = {}; // grouped by exam board

    try {
        const snapshot = await db.collection('fullExamPapers').get();
        console.log(`Found ${snapshot.size} papers to audit.`);

        snapshot.forEach(doc => {
            const data = doc.data();
            const examBoard = data.metadata?.exam_board || 'Unknown';

            if (!stats[examBoard]) {
                stats[examBoard] = {
                    totalPapers: 0,
                    totalQuestions: 0,
                    likelyNeedsDiagram: 0,
                    hasHint: 0,
                    missingHint: 0,
                    sampleMissing: []
                };
            }

            stats[examBoard].totalPapers++;

            if (data.questions) {
                data.questions.forEach(q => {
                    // Check main question text
                    processText(q.question_text, q.question_number, doc.id, stats[examBoard]);

                    // Check sub-questions
                    if (q.sub_questions) {
                        q.sub_questions.forEach(sq => {
                            processText(sq.question_text, `${q.question_number}${sq.question_part || ''}`, doc.id, stats[examBoard]);
                        });
                    }
                });
            }
        });

        // Final Table Generation
        console.log('\n--- 📊 DIAGRAM HINT AUDIT REPORT ---');
        console.log('| Exam Board | Likely Needs Diagram | Has Hint | Missing Hint | Hint Coverage (%) |');
        console.log('| :--- | :---: | :---: | :---: | :---: |');

        for (const [board, data] of Object.entries(stats)) {
            const coverage = data.likelyNeedsDiagram > 0
                ? ((data.hasHint / data.likelyNeedsDiagram) * 100).toFixed(1)
                : 'N/A';
            console.log(`| ${board} | ${data.likelyNeedsDiagram} | ${data.hasHint} | ${data.missingHint} | ${coverage}% |`);
        }

        console.log('\n--- 🔍 SAMPLES MISSING HINTS (Last 5) ---');
        for (const [board, data] of Object.entries(stats)) {
            if (data.sampleMissing.length > 0) {
                console.log(`\nBoard: ${board}`);
                data.sampleMissing.slice(-5).forEach(s => {
                    console.log(` - [Paper: ${s.paperId}] Q${s.qNum}: "${s.text.substring(0, 100)}..."`);
                });
            }
        }

    } catch (error) {
        console.error('Audit failed:', error);
    }
}

function processText(text, qNum, paperId, boardStats) {
    if (!text) return;
    boardStats.totalQuestions++;

    if (likelyNeedsDiagram(text)) {
        boardStats.likelyNeedsDiagram++;
        if (hasHint(text)) {
            boardStats.hasHint++;
        } else {
            boardStats.missingHint++;
            boardStats.sampleMissing.push({ paperId, qNum, text });
        }
    }
}

runAudit();
