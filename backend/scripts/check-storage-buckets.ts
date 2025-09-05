import { getFirebaseAdmin } from '../config/firebase';
import { getStorage } from 'firebase-admin/storage';

/**
 * Check available Firebase Storage buckets
 */
async function checkStorageBuckets() {
  try {
    console.log('🔍 Checking Firebase Storage buckets...');
    
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Firebase Admin not initialized');
    }
    
    const storage = getStorage(app);
    
    // Try to get the default bucket
    try {
      const defaultBucket = storage.bucket();
      console.log(`✅ Default bucket: ${defaultBucket.name}`);
      
      // Try to list files in the bucket to test access
      try {
        const [files] = await defaultBucket.getFiles({ maxResults: 1 });
        console.log(`✅ Bucket is accessible (${files.length} files found)`);
      } catch (listError) {
        console.log(`⚠️ Bucket exists but may not be accessible: ${listError}`);
      }
    } catch (error) {
      console.log(`❌ No default bucket available: ${error}`);
      console.log('💡 You need to create a Storage bucket in Firebase Console');
    }
    
    // Try common bucket name patterns
    const commonBucketNames = [
      'intellimark-6649e.appspot.com',
      'intellimark-6649e-default-rtdb.firebaseio.com',
      'intellimark-6649e.firebasestorage.app'
    ];
    
    console.log('\n🔍 Testing common bucket names:');
    for (const bucketName of commonBucketNames) {
      try {
        const bucket = storage.bucket(bucketName);
        const [files] = await bucket.getFiles({ maxResults: 1 });
        console.log(`  ✅ ${bucketName} - Accessible`);
      } catch (error) {
        console.log(`  ❌ ${bucketName} - Not accessible`);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to check storage buckets:', error);
  }
}

// Run the check
checkStorageBuckets()
  .then(() => console.log('✅ Bucket check completed'))
  .catch(error => console.error('❌ Bucket check failed:', error));
