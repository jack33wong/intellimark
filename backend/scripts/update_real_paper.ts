
import { getFirestore } from '../config/firebase';

const CORRECT_DATA = {
    // metadata already exists, but we can ensure it's correct
    metadata: {
        exam_board: "Pearson Edexcel",
        exam_code: "1MA1/3H",
        exam_series: "June 2024",
        tier: "Higher Tier",
        subject: "Mathematics"
    },
    // We will update the questions array. 
    // Usually full papers have all 21 questions. 
    // I will only update the specific questions the user mentioned if they are different.
};

async function updateRealPaper() {
    const db = getFirestore();
    if (!db) return;
    const docRef = db.collection('fullExamPapers').doc('6cd9b656-857d-4fd9-b12c-2d6b9adf394e');
    const doc = await docRef.get();

    if (!doc.exists) {
        console.error("Target paper 6cd9b656-857d-4fd9-b12c-2d6b9adf394e not found");
        return;
    }

    const data = doc.data()!;
    const questions = data.questions || [];

    // Find and Update Q2
    const q2Idx = questions.findIndex((q: any) => q.question_number === '2');
    const q2New = {
        "question_number": "2",
        "marks": 1,
        "question_text": "Write $5.3 \\times 10^{4}$ as an ordinary number.",
        "math_expression": { "latex": "5.3 \\times 10^{4}", "unicode": "5.3 × 10⁴" }
    };
    if (q2Idx !== -1) questions[q2Idx] = q2New;
    else questions.push(q2New);

    // Find and Update Q19
    const q19Idx = questions.findIndex((q: any) => q.question_number === '19');
    const q19New = {
        "question_number": "19",
        "marks": 4,
        "question_text": "R = \\frac{P}{Q}\nP = 5.88 \\times 10^{9} correct to 3 significant figures.\nQ = 3.6 \\times 10^{4} correct to 2 significant figures.\nWork out the lower bound for R.\nGive your answer as an ordinary number correct to the nearest integer.\nYou must show all your working."
    };
    if (q19Idx !== -1) questions[q19Idx] = q19New;
    else questions.push(q19New);

    await docRef.update({
        questions: questions,
        "metadata.exam_series": "June 2024" // ensure series is correct for matching
    });

    console.log("✅ Successfully updated Real Paper 6cd9b656-857d-4fd9-b12c-2d6b9adf394e with corrected Q2 and Q19.");
}

updateRealPaper().catch(console.error);
