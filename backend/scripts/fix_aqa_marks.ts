
import { getFirestore } from '../config/firebase.js';

async function dryRunFixAQAMarks() {
    const db = getFirestore();
    const snapshot = await db.collection('fullExamPapers')
        .where('metadata.exam_board', '==', 'AQA')
        .get();

    console.log(`Scanning ${snapshot.size} AQA papers...`);

    let totalPapersAffected = 0;
    let totalQuestionsFixed = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const questions = data.questions || [];
        let paperNeedsUpdate = false;

        const updatedQuestions = questions.map((q: any) => {
            if (!q.marks && q.sub_questions && q.sub_questions.length > 0) {
                const calculatedMarks = q.sub_questions.reduce((sum: number, sq: any) => sum + (sq.marks || 0), 0);
                if (calculatedMarks > 0) {
                    console.log(`[DRY-RUN] Paper: ${data.metadata.exam_code} (${data.metadata.exam_series}) | Q${q.question_number}: Adding marks=${calculatedMarks}`);
                    totalQuestionsFixed++;
                    paperNeedsUpdate = true;
                    return { ...q, marks: calculatedMarks };
                }
            }
            return q;
        });

        if (paperNeedsUpdate) {
            totalPapersAffected++;
            if (process.env.COMMIT === 'true') {
                console.log(`[COMMIT] Updating paper ${doc.id}...`);
                await db.collection('fullExamPapers').doc(doc.id).update({ questions: updatedQuestions });
            }
        }
    }

    console.log("\n--- Dry Run Summary ---");
    console.log(`Total Papers Affected: ${totalPapersAffected}`);
    console.log(`Total Questions to be Fixed: ${totalQuestionsFixed}`);
    if (process.env.COMMIT !== 'true') {
        console.log("\nNOTE: This was a DRY RUN. No changes were made to the database.");
        console.log("Run with COMMIT=true to apply changes.");
    } else {
        console.log("\nSUCCESS: Database updated!");
    }
}

dryRunFixAQAMarks().catch(console.error);
