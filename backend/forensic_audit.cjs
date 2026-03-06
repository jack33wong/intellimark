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
        const matches = regex.test(lowerText);
        return matches;
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
        const matches = regex.test(lowerText);
        return matches;
    });

    return matchesSpecial;
}

function hasHint(text) {
    if (!text) return false;
    return /\[.*?\]/.test(text);
}

async function forensicAudit() {
    console.log('🔍 Forensic Audit: AQA November 2020 8300/2H');
    try {
        const snapshot = await db.collection('fullExamPapers')
            .where('metadata.exam_board', '==', 'AQA')
            .where('metadata.exam_series', '==', 'November 2020')
            .where('metadata.exam_code', '==', '8300/2H')
            .get();

        snapshot.forEach(doc => {
            console.log(`\n📄 Doc ID: ${doc.id}`);
            const data = doc.data();
            const questions = data.questions || data.items || [];

            questions.forEach(q => {
                const qNum = q.number || q.question_number || 'Unknown';
                const qText = q.question_text || q.text || '';
                const subQuestions = q.sub_questions || q.subQuestions || [];

                console.log(`  - Checking Q${qNum}...`);
                if (likelyNeedsDiagram(qText)) {
                    if (!hasHint(qText)) {
                        console.log(`    [MISSING] Main Q${qNum}: "${qText.substring(0, 50)}..."`);
                    } else {
                        console.log(`    [OK] Main Q${qNum} has hint.`);
                    }
                }

                subQuestions.forEach(sq => {
                    const sqNum = sq.number || sq.part || 'Unknown';
                    const sqText = sq.question_text || sq.text || '';
                    console.log(`    - Checking Part ${sqNum}...`);
                    if (likelyNeedsDiagram(sqText)) {
                        if (!hasHint(sqText)) {
                            console.log(`      [MISSING] Sub Q${qNum}${sqNum}: "${sqText.substring(0, 50)}..."`);
                        } else {
                            console.log(`      [OK] Sub Q${qNum}${sqNum} has hint.`);
                        }
                    }
                });
            });
        });
    } catch (err) {
        console.error(err);
    }
}

forensicAudit();
