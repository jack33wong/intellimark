import { ImageStorageService } from '../services/imageStorageService.js';

/**
 * Test image upload to Firebase Storage
 */
async function testImageUpload() {
  try {
    
    // Create a simple test image (1x1 pixel PNG in base64)
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    const userId = 'test-user-123';
    const sessionId = 'test-session-456';
    
    
    const imageUrl = await ImageStorageService.uploadImage(
      testImageBase64,
      userId,
      sessionId,
      'original'
    );
    
    
    // Test cleanup
    await ImageStorageService.deleteSessionImages(userId, sessionId);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testImageUpload()
  .then(() => {})
  .catch(error => console.error('\n❌ Image upload test failed:', error));
