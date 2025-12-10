
import { getFirestore } from './config/firebase.js';

async function debugMarks() {
    const db = getFirestore();
    const papers = await db.collection('fullExamPapers').get();

    let targetPaper: any = null;

    papers.forEach(doc => {
        const data = doc.data();
        if (data.metadata?.paper_name?.includes('Pearson Edexcel GCSE 1MA1/1F') ||
            (data.metadata?.exam_board === 'Pearson Edexcel' && data.metadata?.exam_code === '1MA1/1F' && data.metadata?.exam_series === 'November 2023')) {
            targetPaper = data;
        }
    });

    if (!targetPaper) {
        console.log('Target paper not found');
        return;
    }

    console.log('\n=== FULL PAPER STRUCTURE (DB TRUTH) ===');
    if (targetPaper.questions && Array.isArray(targetPaper.questions)) {
        // Sort for readability
        const sortedQuestions = targetPaper.questions.sort((a: any, b: any) => {
            const numA = parseInt(a.question_number) || 0;
            const numB = parseInt(b.question_number) || 0;
            return numA - numB;
        });

        sortedQuestions.forEach((q: any) => {
            console.log(`Q${q.question_number || '?'} (Total Marks: ${q.marks})`);
            if (q.sub_questions && q.sub_questions.length > 0) {
                q.sub_questions.forEach((sq: any) => {
                    console.log(`   - SubQ "${sq.question_part}": ${sq.marks} marks`);
                });
            } else {
                console.log(`   - (No sub-questions)`);
            }
        });
    } else {
        console.log('No questions array found in paper object.');
    }
}

debugMarks().catch(console.error);
