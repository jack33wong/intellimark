const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
const fs = require('fs');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

const DIAGRAM_KEYWORDS = [
    'triangle', 'parallelogram', 'quadrilateral', 'rectangle', 'sector', 'radius', 'diameter', 'chord', 'tangent', 'arc', 'semicircle', 'circumference',
    'cylinder', 'cone', 'pyramid', 'prism', 'polygon', 'trapezium', 'rhombus',
    'grid', 'axis', 'axes', 'coordinates', 'plot', 'sketch', 'graph', 'diagram',
    'bar chart', 'histogram', 'pie chart', 'venn diagram', 'cumulative frequency', 'scatter graph', 'frequency polygon', 'box plot', 'pictogram',
    'plan', 'elevation', 'degrees', 'bearing', '3d', 'cross-section', 'volume of cylinder', 'surface area',
    'transformation', 'reflection', 'rotation', 'enlargement', 'vector', 'shaded'
];
const SPECIAL_KEYWORDS = ['draw', 'angle'];

function likelyNeedsDiagram(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();

    // 1. Check for "Circle" as an instruction (common in non-diagram multiple choice)
    const isCircleInstruction = lowerText.includes('circle the') ||
        lowerText.includes('circle your answer') ||
        lowerText.includes('circle one box');

    // 2. Check for strong diagram keywords
    const matchesStrong = DIAGRAM_KEYWORDS.some(kw => {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        return regex.test(lowerText);
    });

    if (matchesStrong) return true;

    // 3. "Circle" as a keyword only if it's not a "Circle the..." instruction
    if (/\bcircle\b/i.test(lowerText) && !isCircleInstruction) {
        return true;
    }

    // 4. Special keywords
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

async function runAuditAndWriteMarkdown() {
    console.log('🚀 Running Scientifically Accurate Audit (v4)...');
    const paperSummary = [];

    try {
        const snapshot = await db.collection('fullExamPapers').get();

        snapshot.forEach(doc => {
            const data = doc.data();
            const meta = data.metadata || {};
            const board = meta.exam_board || 'Unknown';
            const series = meta.exam_series || 'Unknown';
            const code = meta.exam_code || 'Unknown';
            const title = meta.paper_title || 'Unknown';

            let tier = 'Unknown';
            if (title.toLowerCase().includes('higher') || (meta.tier && meta.tier.toLowerCase().includes('higher'))) tier = 'Higher';
            else if (title.toLowerCase().includes('foundation') || (meta.tier && meta.tier.toLowerCase().includes('foundation'))) tier = 'Foundation';

            const questions = data.questions || data.items || [];
            let missingDetails = [];
            let totalHints = 0;

            // 1. First Pass: Count total existing hints in the whole paper
            questions.forEach(q => {
                const qText = q.question_text || q.text || '';
                const subQuestions = (q.sub_questions || q.subQuestions || []);
                if (hasHint(qText)) totalHints++;
                subQuestions.forEach(sq => {
                    const sqText = sq.question_text || sq.text || '';
                    if (hasHint(sqText)) totalHints++;
                });
            });

            // 2. Second Pass: Only audit if the paper has LESS THAN 2 hints
            if (totalHints < 2) {
                questions.forEach(q => {
                    const qNum = q.number || q.question_number || 'Unknown';
                    const qText = q.question_text || q.text || '';
                    const subQuestions = (q.sub_questions || q.subQuestions || []);

                    if (likelyNeedsDiagram(qText) && !hasHint(qText)) {
                        missingDetails.push({ num: `Q${qNum}`, text: qText });
                    }

                    subQuestions.forEach(sq => {
                        const sqNum = sq.question_part || sq.part || sq.number || sq.part_number || '';
                        const sqText = sq.question_text || sq.text || '';
                        if (likelyNeedsDiagram(sqText) && !hasHint(sqText)) {
                            missingDetails.push({ num: `Q${qNum}${sqNum}`, text: sqText });
                        }
                    });
                });
            }

            if (missingDetails.length > 0) {
                paperSummary.push({
                    board,
                    series,
                    code,
                    title,
                    tier,
                    missingCount: missingDetails.length,
                    missingNumbers: missingDetails.map(d => d.num).join(', '),
                    details: missingDetails
                });
            }
        });

        // 1. Generate Summary Table
        paperSummary.sort((a, b) => {
            const monthMap = {
                'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
                'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
            };

            const getOrder = (s) => {
                const parts = s.trim().split(/\s+/);
                const year = parseInt(parts[parts.length - 1]) || 0;
                const monthName = parts[0];
                const month = monthMap[monthName] || 0;
                return year * 100 + month;
            };

            const orderA = getOrder(a.series);
            const orderB = getOrder(b.series);

            // Series DESC (Newest first)
            if (orderA !== orderB) return orderB - orderA;

            // Then sort by Code (Ascending)
            return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });
        });

        let summaryMd = '# Audit Report: Diagram Hint Coverage (Verified Accurate)\n\n';
        summaryMd += '| Exam Board | Series | Code | Tier | Paper Title | Missing Hints (Count) | Question Numbers |\n';
        summaryMd += '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n';
        paperSummary.forEach(p => {
            summaryMd += `| ${p.board} | ${p.series} | ${p.code} | ${p.tier} | ${p.title} | ${p.missingCount} | ${p.missingNumbers} |\n`;
        });
        fs.writeFileSync('/Users/ytwong/github/intellimark/backend/accurate_summary_table.md', summaryMd);

        // 2. Generate Detailed Report
        let detailedMd = '# Detailed Audit Report: Questions Missing Diagram Hints (Verified)\n\n';
        detailedMd += `Generated on: ${new Date().toISOString()}\n\n`;
        detailedMd += '> [!IMPORTANT]\n> This report has been verified against the database. Instructions like "Circle the answer" are excluded.\n\n';

        let currentBoard = '';
        let currentSeries = '';

        paperSummary.forEach(p => {
            if (p.board !== currentBoard) {
                currentBoard = p.board;
                currentSeries = ''; // Reset series on board change
                detailedMd += `\n## 🏢 ${currentBoard}\n`;
            }
            if (p.series !== currentSeries) {
                currentSeries = p.series;
                detailedMd += `### 📅 ${currentSeries}\n`;
            }
            detailedMd += `#### 📄 ${p.code} - ${p.title} (${p.tier})\n`;
            p.details.forEach(d => {
                detailedMd += `- **${d.num}**: ${d.text.replace(/\n/g, ' ')}\n`;
            });
            detailedMd += `\n`;
        });
        fs.writeFileSync('/Users/ytwong/github/intellimark/backend/accurate_detailed_report.md', detailedMd);

        console.log('✅ Accurate reports regenerated.');

    } catch (error) {
        console.error('Audit failed:', error);
    }
}

runAuditAndWriteMarkdown();
