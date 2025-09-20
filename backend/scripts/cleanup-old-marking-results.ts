#!/usr/bin/env tsx

/**
 * Cleanup script for old marking results collection
 * This script deletes all documents in the markingResults collection
 * since we've moved to storing marking results as session messages
 */

import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin if not already initialized
if (!admin.apps || admin.apps.length === 0) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
    process.exit(1);
  }
}

// Get Firestore instance
const db = admin.firestore();

async function cleanupOldMarkingResults() {
  
  try {
    // Get all documents in markingResults collection
    const markingResults = await db.collection('markingResults').get();
    
    if (markingResults.empty) {
      return;
    }
    
    
    // Delete documents in batches (Firestore batch limit is 500)
    const batchSize = 500;
    const docs = markingResults.docs;
    
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = docs.slice(i, i + batchSize);
      
      batchDocs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
    }
    
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

// Run the cleanup
cleanupOldMarkingResults()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cleanup script failed:', error);
    process.exit(1);
  });
