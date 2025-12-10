/**
 * Script to check if fullExamPapers have subject field populated
 * Run with: npx tsx scripts/check-exam-paper-subjects.ts
 */

import { getFirestore } from '../config/firebase.js';

async function checkExamPaperSubjects() {
    const db = getFirestore();

    console.log('🔍 Checking fullExamPapers for subject field...\n');

    const snapshot = await db.collection('fullExamPapers').limit(5).get();

    if (snapshot.empty) {
        console.log('❌ No exam papers found in database!');
        return;
    }

    console.log(`Found ${snapshot.size} exam papers (showing first 5):\n`);

    snapshot.forEach((doc, index) => {
        const data = doc.data();
        const metadata = data.metadata;

        console.log(`${index + 1}. Document ID: ${doc.id}`);
        console.log(`   Exam Code: ${metadata?.exam_code || 'N/A'}`);
        console.log(`   Exam Board: ${metadata?.exam_board || 'N/A'}`);
        console.log(`   Qualification: ${metadata?.qualification || 'N/A'}`);
        console.log(`   Subject: ${metadata?.subject || '❌ MISSING'}`);
        console.log(`   Exam Series: ${metadata?.exam_series || 'N/A'}`);
        console.log('');
    });

    // Check if any are missing subject
    let missingCount = 0;
    const allSnapshot = await db.collection('fullExamPapers').get();
    allSnapshot.forEach((doc) => {
        const metadata = doc.data().metadata;
        if (!metadata?.subject) {
            missingCount++;
        }
    });

    console.log('\n📊 Summary:');
    console.log(`Total exam papers: ${allSnapshot.size}`);
    console.log(`Missing subject field: ${missingCount}`);

    if (missingCount > 0) {
        console.log('\n⚠️  WARNING: Some exam papers are missing the subject field!');
        console.log('This will cause "gcse" to be used as subject instead of the actual subject.');
        console.log('\nTo fix: Update fullExamPapers documents to include metadata.subject field');
        console.log('Example: { metadata: { subject: "Mathematics", ... } }');
    } else {
        console.log('\n✅ All exam papers have subject field populated!');
    }
}

// Run the script
checkExamPaperSubjects()
    .then(() => {
        console.log('\n✅ Script completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
