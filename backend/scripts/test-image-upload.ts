import { ImageStorageService } from '../services/imageStorageService';

/**
 * Test image upload to Firebase Storage
 */
async function testImageUpload() {
  try {
    console.log('🧪 Testing Image Upload to Firebase Storage');
    console.log('==========================================');
    
    // Create a simple test image (1x1 pixel PNG in base64)
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    const userId = 'test-user-123';
    const sessionId = 'test-session-456';
    
    console.log('📤 Uploading test image...');
    console.log(`  User ID: ${userId}`);
    console.log(`  Session ID: ${sessionId}`);
    
    const imageUrl = await ImageStorageService.uploadImage(
      testImageBase64,
      userId,
      sessionId,
      'original'
    );
    
    console.log('✅ Image uploaded successfully!');
    console.log(`📎 Image URL: ${imageUrl}`);
    
    // Test cleanup
    console.log('\n🧹 Testing cleanup...');
    await ImageStorageService.deleteSessionImages(userId, sessionId);
    console.log('✅ Cleanup completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testImageUpload()
  .then(() => console.log('\n✅ Image upload test completed'))
  .catch(error => console.error('\n❌ Image upload test failed:', error));
