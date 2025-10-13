/**
 * Simple script to check if question 21 exists
 */

import { getFirestore } from '../config/firebase.js';

async function checkQuestion21() {
  try {
    const db = getFirestore();
    const doc = await db.collection('fullExamPapers').doc('c5396ea8-0d8e-4d26-bbd6-109ce48af49f').get();
    const data = doc.data();
    
    console.log('Total questions:', data?.questions?.length);
    console.log('Question numbers:', data?.questions?.map((q: any) => q.question_number));
    
    const question21 = data?.questions?.find((q: any) => q.question_number === '21');
    if (question21) {
      console.log('\n✅ QUESTION 21 FOUND:');
      console.log('Text:', question21.question_text);
      console.log('Marks:', question21.marks);
    } else {
      console.log('\n❌ QUESTION 21 NOT FOUND');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkQuestion21();






