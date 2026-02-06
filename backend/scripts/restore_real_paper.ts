
import { getFirestore } from '../config/firebase';

const ORIGINAL_Q2 = {
    "question_number": "2",
    "marks": 4,
    "sub_questions": [
        {
            "question_part": "a(i)",
            "question_text": "Write $5.3 \\times 10^{4}$ as an ordinary number.",
            "math_expression": {
                "latex": "5.3 \\times 10^{4}",
                "unicode": "5.3 × 10⁴"
            },
            "marks": 1
        },
        {
            "question_part": "a(ii)",
            "question_text": "Write $7.4 \\times 10^{-5}$ as an ordinary number.",
            "math_expression": {
                "latex": "7.4 \\times 10^{-5}",
                "unicode": "7.4 × 10⁻⁵"
            },
            "marks": 1
        },
        {
            "question_part": "b",
            "question_text": "Calculate the value of $9.7 \\times 10^{6} + 2.45 \\times 10^{7}$. Give your answer in standard form.",
            "math_expression": {
                "latex": "9.7 \\times 10^{6} + 2.45 \\times 10^{7}",
                "unicode": "9.7 × 10⁶ + 2.45 × 10⁷"
            },
            "marks": 2
        }
    ]
};

const ORIGINAL_Q19 = {
    "question_number": "19",
    "question_text": "$R=\\frac{P}{Q}$. $P=5.88\\times10^{8}$ correct to 3 significant figures. $Q=3.6\\times10^{5}$ correct to 2 significant figures. Work out the lower bound for R. Give your answer as an ordinary number correct to the nearest integer. You must show all your working.",
    "math_expression": {
        "latex": [
            "R=\\frac{P}{Q}",
            "P=5.88\\times10^{8}",
            "Q=3.6\\times10^{5}"
        ],
        "unicode": [
            "R = P/Q",
            "P = 5.88 × 10⁸",
            "Q = 3.6 × 10⁵"
        ]
    },
    "marks": 3
};

async function restoreRealPaper() {
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

    // Restore Q2
    const q2Idx = questions.findIndex((q: any) => q.question_number === '2');
    if (q2Idx !== -1) questions[q2Idx] = ORIGINAL_Q2;

    // Restore Q19
    const q19Idx = questions.findIndex((q: any) => q.question_number === '19');
    if (q19Idx !== -1) questions[q19Idx] = ORIGINAL_Q19;

    await docRef.update({
        questions: questions
    });

    console.log("✅ RESTORED Real Paper 6cd9b656-857d-4fd9-b12c-2d6b9adf394e to its ORIGINAL state.");
}

restoreRealPaper().catch(console.error);
