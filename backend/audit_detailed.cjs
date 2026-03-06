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

async function runDetailedAudit() {
    console.log('🚀 Starting Granular Audit of fullExamPapers...');
    const report = {}; // board -> year -> paperTitle -> questions[]

    try {
        const snapshot = await db.collection('fullExamPapers').get();
        console.log(`Found ${snapshot.size} papers to audit.`);

        snapshot.forEach(doc => {
            const data = doc.data();
            const meta = data.metadata || {};
            const board = meta.exam_board || 'Unknown';
            const series = meta.exam_series || 'Unknown';
            const yearMatch = series.match(/\d{4}/);
            const year = yearMatch ? yearMatch[0] : 'Unknown';
            const paperTitle = `${meta.paper_title || 'Paper'} (${meta.exam_code || doc.id})`;

            if (data.questions) {
                data.questions.forEach(q => {
                    const missingInQ = [];

                    // Check main question text
                    if (likelyNeedsDiagram(q.question_text) && !hasHint(q.question_text)) {
                        missingInQ.push(q.question_number);
                    }

                    // Check sub-questions
                    if (q.sub_questions) {
                        q.sub_questions.forEach(sq => {
                            if (likelyNeedsDiagram(sq.question_text) && !hasHint(sq.question_text)) {
                                missingInQ.push(`${q.question_number}${sq.question_part || ''}`);
                            }
                        });
                    }

                    if (missingInQ.length > 0) {
                        if (!report[board]) report[board] = {};
                        if (!report[board][year]) report[board][year] = {};
                        if (!report[board][year][paperTitle]) report[board][year][paperTitle] = [];

                        report[board][year][paperTitle].push(...missingInQ);
                    }
                });
            }
        });

        // Generate JSON output for the agent to read and format
        console.log('--- AUDIT_DATA_START ---');
        console.log(JSON.stringify(report, null, 2));
        console.log('--- AUDIT_DATA_END ---');

    } catch (error) {
        console.error('Audit failed:', error);
    }
}

runDetailedAudit();
