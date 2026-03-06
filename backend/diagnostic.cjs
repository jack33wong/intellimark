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
    'grid', 'axis', 'axes', 'coordinates', 'plot', 'sketch',
    'bar chart', 'histogram', 'pie chart', 'venn diagram', 'cumulative frequency', 'scatter graph', 'frequency polygon',
    'degrees', 'bearing', '3d', 'cross-section', 'volume of cylinder', 'surface area'
];
const SPECIAL_KEYWORDS = ['draw', 'angle'];

function likelyNeedsDiagram(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    const matchesKeyword = DIAGRAM_KEYWORDS.some(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lowerText);
    });

    if (matchesKeyword) {
        if (lowerText.includes('circle the answer') ||
            lowerText.includes('circle your answer') ||
            lowerText.includes('circle the letter') ||
            lowerText.includes('circle the expression')) {
            return false;
        }
        return true;
    }

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

async function diagnostic() {
    console.log('🧪 Diagnostic: Detection Logic for AQA Nov 2020 8300/2H');
    const snapshot = await db.collection('fullExamPapers')
        .where('metadata.exam_board', '==', 'AQA')
        .where('metadata.exam_series', '==', 'November 2020')
        .where('metadata.exam_code', '==', '8300/2H')
        .get();

    snapshot.forEach(doc => {
        const data = doc.data();
        const questions = data.questions || data.items || [];

        questions.forEach(q => {
            const qNum = q.number || q.question_number || 'Unknown';
            const qText = q.question_text || q.text || '';
            const subQuestions = q.sub_questions || q.subQuestions || [];

            if (likelyNeedsDiagram(qText) && !hasHint(qText)) {
                console.log(`[HIT] Q${qNum}: ${qText.substring(0, 40)}`);
            }

            subQuestions.forEach(sq => {
                const sqNum = sq.number || sq.part || 'Unknown';
                const sqText = sq.question_text || sq.text || '';
                if (likelyNeedsDiagram(sqText) && !hasHint(sqText)) {
                    console.log(`[HIT] Q${qNum}${sqNum}: ${sqText.substring(0, 40)}`);
                }
            });
        });
    });
}

diagnostic();
