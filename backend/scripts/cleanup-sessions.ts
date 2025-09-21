import { getFirestore } from '../config/firebase.js';
import admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps || admin.apps.length === 0) {
  try {
    admin.initializeApp();
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
  }
}

/**
 * Clean up sessions collection - delete all sessions
 */
export async function cleanupSessions() {

  try {
    const db = getFirestore();
    if (!db) {
      throw new Error('Firestore not available');
    }
    
    const collectionRef = db.collection('sessions');
    let totalDeleted = 0;
    let batchCount = 0;

    while (true) {
      // Process in batches of 50
      const snapshot = await collectionRef.limit(50).get();
      
      if (snapshot.size === 0) {
        break;
      }

      batchCount++;

      // Delete in batch
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      totalDeleted += snapshot.size;

      // If we got less than 50 documents, we've reached the end
      if (snapshot.size < 50) {
        break;
      }
    }


  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
}

/**
 * Clean up sessions for a specific user
 */
export async function cleanupUserSessions(userId: string) {

  try {
    const db = getFirestore();
    if (!db) {
      throw new Error('Firestore not available');
    }
    
    const collectionRef = db.collection('sessions');
    const userSessionsQuery = collectionRef.where('userId', '==', userId);
    
    let totalDeleted = 0;
    let batchCount = 0;

    while (true) {
      // Process in batches of 50
      const snapshot = await userSessionsQuery.limit(50).get();
      
      if (snapshot.size === 0) {
        break;
      }

      batchCount++;

      // Delete in batch
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      totalDeleted += snapshot.size;

      // If we got less than 50 documents, we've reached the end
      if (snapshot.size < 50) {
        break;
      }
    }


  } catch (error) {
    console.error('❌ User sessions cleanup failed:', error);
    throw error;
  }
}

/**
 * List sessions without deleting them
 */
export async function listSessions(limit: number = 10) {

  try {
    const db = getFirestore();
    if (!db) {
      throw new Error('Firestore not available');
    }
    
    const collectionRef = db.collection('sessions');
    const snapshot = await collectionRef.limit(limit).get();
    
    
    snapshot.docs.forEach((doc, index) => {
      const data = doc.data();
    });

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

  } catch (error) {
    console.error('❌ Failed to list sessions:', error);
    throw error;
  }
}

// Command line interface
const command = process.argv[2];
const userId = process.argv[3];

switch (command) {
  case 'list':
    const limit = parseInt(process.argv[3]) || 10;
    listSessions(limit)
      .catch(error => console.error('❌ List failed:', error));
    break;
  
  case 'cleanup-user':
    if (!userId) {
      console.error('❌ Please provide userId: npm run cleanup-sessions cleanup-user <userId>');
      process.exit(1);
    }
    cleanupUserSessions(userId)
      .catch(error => console.error('❌ User cleanup failed:', error));
    break;
  
  case 'cleanup-all':
    
    setTimeout(() => {
      cleanupSessions()
        .catch(error => console.error('❌ All sessions cleanup failed:', error));
    }, 5000);
    break;
  
  default:
    break;
}
