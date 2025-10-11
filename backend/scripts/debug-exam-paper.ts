/**
 * Debug script to check specific exam paper in database
 */

import { getFirestore } from '../config/firebase.js';

async function debugExamPaper() {
  try {
    console.log('🔍 [DEBUG] Checking exam paper: c5396ea8-0d8e-4d26-bbd6-109ce48af49f');
    console.log('=' .repeat(80));
    
    const db = getFirestore();
    
    // Get the specific exam paper
    const doc = await db.collection('fullExamPapers').doc('c5396ea8-0d8e-4d26-bbd6-109ce48af49f').get();
    
    if (!doc.exists) {
      console.log('❌ [ERROR] Exam paper not found in database');
      return;
    }
    
    const data = doc.data();
    console.log('📋 [EXAM PAPER DATA]:');
    console.log(JSON.stringify(data, null, 2));
    
    // Check if question 21 exists (questions is an array, not object)
    const question21 = data?.questions?.find((q: any) => q.question_number === '21');
    if (question21) {
      console.log('\n✅ [QUESTION 21 FOUND]:');
      console.log(JSON.stringify(question21, null, 2));
    } else {
      console.log('\n❌ [QUESTION 21 NOT FOUND]');
      console.log('Total questions:', data?.questions?.length);
      console.log('Available question numbers:', data?.questions?.map((q: any) => q.question_number));
    }
    
    // Check marking scheme
    if (data?.markingScheme && data.markingScheme['21']) {
      console.log('\n✅ [MARKING SCHEME 21 FOUND]:');
      console.log(JSON.stringify(data.markingScheme['21'], null, 2));
    } else {
      console.log('\n❌ [MARKING SCHEME 21 NOT FOUND]');
      console.log('Available marking scheme numbers:', Object.keys(data?.markingScheme || {}));
    }
    
  } catch (error) {
    console.error('❌ [ERROR] Debug failed:', error);
  }
}

// Run the debug
debugExamPaper().then(() => {
  console.log('\n🏁 [DEBUG] Completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ [FATAL] Debug script failed:', error);
  process.exit(1);
});
