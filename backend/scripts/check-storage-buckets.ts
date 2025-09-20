import { getFirebaseAdmin } from '../config/firebase';
import { getStorage } from 'firebase-admin/storage';

/**
 * Check available Firebase Storage buckets
 */
async function checkStorageBuckets() {
  try {
    
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Firebase Admin not initialized');
    }
    
    const storage = getStorage(app);
    
    // Try to get the default bucket
    try {
      const defaultBucket = storage.bucket();
      
      // Try to list files in the bucket to test access
      try {
        const [files] = await defaultBucket.getFiles({ maxResults: 1 });
      } catch (listError) {
      }
    } catch (error) {
    }
    
    // Try common bucket name patterns
    const commonBucketNames = [
      'intellimark-6649e.appspot.com',
      'intellimark-6649e-default-rtdb.firebaseio.com',
      'intellimark-6649e.firebasestorage.app'
    ];
    
    for (const bucketName of commonBucketNames) {
      try {
        const bucket = storage.bucket(bucketName);
        const [files] = await bucket.getFiles({ maxResults: 1 });
      } catch (error) {
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to check storage buckets:', error);
  }
}

// Run the check
checkStorageBuckets()
  .catch(error => console.error('❌ Bucket check failed:', error));
