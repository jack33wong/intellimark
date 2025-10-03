/**
 * Script to set custom claims for existing admin users
 * This script will set the admin: true custom claim for all users in the ADMIN_EMAILS list
 */

import { getFirebaseAuth, isFirebaseAvailable, ADMIN_EMAILS, setUserCustomClaims } from '../config/firebase.js';

async function setAdminClaims() {
  console.log('🚀 Starting admin claims setup...');
  
  if (!isFirebaseAvailable()) {
    console.error('❌ Firebase is not available. Please check your configuration.');
    process.exit(1);
  }

  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) {
    console.error('❌ Firebase Auth is not available.');
    process.exit(1);
  }

  console.log(`📋 Found ${ADMIN_EMAILS.length} admin emails to process:`);
  ADMIN_EMAILS.forEach((email, index) => {
    console.log(`  ${index + 1}. ${email}`);
  });

  let successCount = 0;
  let errorCount = 0;

  for (const email of ADMIN_EMAILS) {
    try {
      console.log(`\n🔍 Processing: ${email}`);
      
      // Get user by email
      const userRecord = await firebaseAuth.getUserByEmail(email);
      console.log(`   ✅ User found: ${userRecord.uid}`);
      
      // Set custom claims
      const claims = {
        admin: true,
        role: 'admin'
      };
      
      const success = await setUserCustomClaims(userRecord.uid, claims);
      
      if (success) {
        console.log(`   ✅ Custom claims set successfully`);
        successCount++;
      } else {
        console.log(`   ❌ Failed to set custom claims`);
        errorCount++;
      }
      
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        console.log(`   ⚠️  User not found: ${email}`);
        errorCount++;
      } else {
        console.error(`   ❌ Error processing ${email}:`, error.message);
        errorCount++;
      }
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successfully processed: ${successCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);
  console.log(`   📧 Total admin emails: ${ADMIN_EMAILS.length}`);

  if (successCount > 0) {
    console.log(`\n🎉 Admin claims setup completed!`);
    console.log(`   Note: Users will need to refresh their tokens to see the changes.`);
    console.log(`   They can do this by logging out and logging back in.`);
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

// Run the script
setAdminClaims().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
