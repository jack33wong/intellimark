
import { getFirestore } from '../config/firebase.js';

async function scanAQAPapers() {
    const db = getFirestore();
    const snapshot = await db.collection('fullExamPapers').get();

    const stats: Record<string, { total: number, affected: number }> = {};
    const affectedPapers: string[] = [];

    console.log(`Scanning ${snapshot.size} papers...`);

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const meta = data.metadata || {};
        if (meta.exam_board !== 'AQA') return;

        const series = meta.exam_series || 'Unknown';
        if (!stats[series]) stats[series] = { total: 0, affected: 0 };
        stats[series].total++;

        const questions = data.questions || [];
        const hasIssue = questions.some(q =>
            !q.marks && q.sub_questions && q.sub_questions.length > 0
        );

        if (hasIssue) {
            stats[series].affected++;
            affectedPapers.push(`${meta.exam_code} (${series})`);
        }
    });

    console.log("\n--- AQA Paper Analysis ---");
    Object.entries(stats).sort().forEach(([series, s]) => {
        console.log(`${series}: ${s.affected}/${s.total} papers affected`);
    });

    if (affectedPapers.length > 0) {
        console.log("\nSample Affected Papers:");
        console.log(affectedPapers.slice(0, 10).join("\n"));
    }
}

scanAQAPapers().catch(console.error);
