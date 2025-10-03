/**
 * Test script to verify admin claims are working
 * This script will check if admin users have the correct custom claims set
 */

import { getFirebaseAuth, isFirebaseAvailable, ADMIN_EMAILS } from '../config/firebase.js';

async function testAdminClaims() {
  console.log('🧪 Testing admin claims setup...');
  
  if (!isFirebaseAvailable()) {
    console.error('❌ Firebase is not available. Please check your configuration.');
    process.exit(1);
  }

  const firebaseAuth = getFirebaseAuth();
  if (!firebaseAuth) {
    console.error('❌ Firebase Auth is not available.');
    process.exit(1);
  }

  console.log(`📋 Testing ${ADMIN_EMAILS.length} admin emails:`);
  
  let successCount = 0;
  let errorCount = 0;

  for (const email of ADMIN_EMAILS) {
    try {
      console.log(`\n🔍 Testing: ${email}`);
      
      // Get user by email
      const userRecord = await firebaseAuth.getUserByEmail(email);
      console.log(`   ✅ User found: ${userRecord.uid}`);
      
      // Get custom claims
      const customClaims = userRecord.customClaims || {};
      console.log(`   📋 Custom claims:`, customClaims);
      
      // Check if admin claim is set
      if (customClaims.admin === true) {
        console.log(`   ✅ Admin claim is correctly set`);
        successCount++;
      } else {
        console.log(`   ❌ Admin claim is missing or incorrect`);
        errorCount++;
      }
      
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        console.log(`   ⚠️  User not found: ${email}`);
        errorCount++;
      } else {
        console.error(`   ❌ Error testing ${email}:`, error.message);
        errorCount++;
      }
    }
  }

  console.log(`\n📊 Test Results:`);
  console.log(`   ✅ Admin claims working: ${successCount}`);
  console.log(`   ❌ Issues found: ${errorCount}`);
  console.log(`   📧 Total admin emails tested: ${ADMIN_EMAILS.length}`);

  if (successCount === ADMIN_EMAILS.length) {
    console.log(`\n🎉 All admin claims are working correctly!`);
    console.log(`   The admin sidebar should now appear for admin users.`);
  } else {
    console.log(`\n⚠️  Some admin claims are not working.`);
    console.log(`   Run the set-admin-claims.ts script to fix them.`);
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

// Run the test
testAdminClaims().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
