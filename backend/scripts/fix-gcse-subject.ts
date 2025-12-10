/**
 * Script to find and optionally fix "Gcse" subject records
 * Run with: npx tsx scripts/fix-gcse-subject.ts
 */

import { getFirestore } from '../config/firebase.js';

async function findGcseSubjects() {
    const db = getFirestore();

    console.log('🔍 Searching for subject records with "Gcse" or "gcse"...\n');

    const snapshot = await db.collection('subjectMarkingResults').get();

    const problematicDocs: any[] = [];

    snapshot.forEach((doc) => {
        const data = doc.data();
        const subject = data.subject;

        // Check if subject is "Gcse" or variations
        if (subject && (subject.toLowerCase() === 'gcse' || subject === 'Gcse')) {
            problematicDocs.push({
                docId: doc.id,
                subject: subject,
                userId: data.userId,
                numMarkingResults: data.markingResults?.length || 0,
                createdAt: data.createdAt,
                examBoards: data.statistics?.examBoards || []
            });
        }
    });

    if (problematicDocs.length === 0) {
        console.log('✅ No problematic "Gcse" subjects found!');
        return;
    }

    console.log(`❌ Found ${problematicDocs.length} documents with "Gcse" subject:\n`);

    problematicDocs.forEach((doc, index) => {
        console.log(`${index + 1}. Document ID: ${doc.docId}`);
        console.log(`   Subject: "${doc.subject}"`);
        console.log(`   User ID: ${doc.userId}`);
        console.log(`   Marking Results: ${doc.numMarkingResults}`);
        console.log(`   Exam Boards: ${doc.examBoards.join(', ')}`);
        console.log(`   Created At: ${doc.createdAt}`);
        console.log('');
    });

    console.log('\n📋 Summary:');
    console.log(`Total documents with "Gcse" subject: ${problematicDocs.length}`);
    console.log(`Total marking results affected: ${problematicDocs.reduce((sum, doc) => sum + doc.numMarkingResults, 0)}`);

    console.log('\n💡 To fix these records:');
    console.log('1. Check the marking results in each document to determine the actual subject (e.g., Mathematics, English)');
    console.log('2. Delete these documents from Firebase Console');
    console.log('3. Re-mark the homework PDFs to create proper subject records');
    console.log('   OR');
    console.log('4. Manually update the subject field in Firebase Console to the correct subject name');
}

// Run the script
findGcseSubjects()
    .then(() => {
        console.log('\n✅ Script completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
