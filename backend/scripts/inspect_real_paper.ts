
import { getFirestore } from '../config/firebase';

async function inspectRealPaper() {
    const db = getFirestore();
    const doc = await db.collection('fullExamPapers').doc('6cd9b656-857d-4fd9-b12c-2d6b9adf394e').get();
    if (!doc.exists) {
        console.error("Paper not found");
        return;
    }
    const data = doc.data();
    console.log("=== Real Paper 1MA1/3H June 2024 ===");
    console.log("Metadata:", JSON.stringify(data.metadata, null, 2));

    const questions = data.questions || [];
    console.log(`Found ${questions.length} questions`);

    // Look for Q2
    const q2 = questions.find(q => q.question_number === '2');
    console.log("\nQ2 Data:", JSON.stringify(q2, null, 2));

    const q19 = questions.find(q => q.question_number === '19');
    console.log("\nQ19 Data:", JSON.stringify(q19, null, 2));
}

inspectRealPaper().catch(console.error);
