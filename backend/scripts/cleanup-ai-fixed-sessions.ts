/**
 * Cleanup script to remove sessions with old 'ai-fixed' message IDs
 * This is a one-time cleanup to remove sessions created during bug fixing
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Initialize Firebase Admin
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceAccountPath = join(__dirname, '../intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

// Use dynamic import for JSON
const serviceAccount = JSON.parse(
  await import('fs').then(fs => fs.promises.readFile(serviceAccountPath, 'utf-8'))
);

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function cleanupAiFixedSessions() {
  try {
    console.log('🔍 Searching for sessions with ai-fixed message IDs...');
    
    const sessionsSnapshot = await db.collection('unifiedSessions').get();
    let deletedCount = 0;
    let updatedCount = 0;
    
    for (const doc of sessionsSnapshot.docs) {
      const sessionData = doc.data();
      const messages = sessionData.messages || [];
      
      // Check if session has any messages with ai-fixed ID
      const hasAiFixed = messages.some((msg: any) => 
        msg.id === 'ai-fixed' || msg.messageId === 'ai-fixed'
      );
      
      if (hasAiFixed) {
        console.log(`📦 Found session ${doc.id} with ai-fixed messages`);
        
        // Option 1: Delete the entire session
        await doc.ref.delete();
        deletedCount++;
        console.log(`  ✅ Deleted session ${doc.id}`);
        
        // Option 2: Remove only the ai-fixed messages (commented out)
        // const filteredMessages = messages.filter((msg: any) => 
        //   msg.id !== 'ai-fixed' && msg.messageId !== 'ai-fixed'
        // );
        // await doc.ref.update({ messages: filteredMessages });
        // updatedCount++;
        // console.log(`  ✅ Updated session ${doc.id} (removed ${messages.length - filteredMessages.length} messages)`);
      }
    }
    
    console.log(`\n✅ Cleanup complete!`);
    console.log(`  - Deleted sessions: ${deletedCount}`);
    console.log(`  - Updated sessions: ${updatedCount}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupAiFixedSessions();

