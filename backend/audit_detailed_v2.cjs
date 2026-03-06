const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

// Keywords with word boundaries to prevent false positives like "Circle the answer"
const DIAGRAM_KEYWORDS = [
    'triangle', 'parallelogram', 'quadrilateral', 'rectangle', 'circle', 'sector', 'radius', 'diameter', 'chord', 'tangent',
    'cylinder', 'cone', 'pyramid', 'prism', 'polygon', 'trapezium', 'rhombus',
    'grid', 'axis', 'axes', 'coordinates', 'plot', 'sketch',
    'bar chart', 'histogram', 'pie chart', 'venn diagram', 'cumulative frequency', 'scatter graph', 'frequency polygon',
    'degrees', 'bearing', '3d', 'cross-section', 'volume of cylinder', 'surface area'
];
// "draw" and "angle" are special as they are common but usually indicate a diagram requirement
const SPECIAL_KEYWORDS = ['draw', 'angle'];

function likelyNeedsDiagram(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    // Check main keywords with word boundaries
    const matchesKeyword = DIAGRAM_KEYWORDS.some(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lowerText);
    });

    if (matchesKeyword) {
        // Exclude common false positives
        if (lowerText.includes('circle the answer') || lowerText.includes('circle your answer')) {
            return false;
        }
        return true;
    }

    // Check special keywords
    const matchesSpecial = SPECIAL_KEYWORDS.some(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lowerText);
    });

    return matchesSpecial;
}

function hasHint(text) {
    if (!text) return false;
    return /\[.*?\]/.test(text);
}

async function runRefinedAudit() {
    console.log('🚀 Starting Refined Granular Audit...');
    const report = {}; // board -> series -> paperTitle -> questions[]

    try {
        const snapshot = await db.collection('fullExamPapers').get();
        console.log(`Auditing ${snapshot.size} papers...`);

        snapshot.forEach(doc => {
            const data = doc.data();
            const meta = data.metadata || {};
            const board = meta.exam_board || 'Unknown';
            const series = meta.exam_series || 'Unknown';
            const paperTitle = `${meta.paper_title || 'Paper'} (${meta.exam_code || doc.id})`;

            const questions = data.questions || data.items || [];

            questions.forEach(q => {
                const qNum = q.question_number || q.number || q.id;
                const qText = q.question_text || q.text || '';
                const subQuestions = q.sub_questions || q.subQuestions || [];

                const missingInQ = [];

                // Check main text
                if (likelyNeedsDiagram(qText) && !hasHint(qText)) {
                    missingInQ.push(qNum);
                }

                // Check sub-questions
                subQuestions.forEach(sq => {
                    const sqPart = sq.question_part || sq.part || '';
                    const sqText = sq.question_text || sq.text || '';
                    if (likelyNeedsDiagram(sqText) && !hasHint(sqText)) {
                        missingInQ.push(`${qNum}${sqPart}`);
                    }
                });

                if (missingInQ.length > 0) {
                    if (!report[board]) report[board] = {};
                    if (!report[board][series]) report[board][series] = {};
                    if (!report[board][series][paperTitle]) report[board][series][paperTitle] = [];
                    report[board][series][paperTitle].push(...new Set(missingInQ));
                }
            });
        });

        console.log('--- AUDIT_DATA_START ---');
        console.log(JSON.stringify(report, null, 2));
        console.log('--- AUDIT_DATA_END ---');

    } catch (error) {
        console.error('Audit failed:', error);
    }
}

runRefinedAudit();
