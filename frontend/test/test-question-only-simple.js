/**
 * Simple Question-Only Image Upload Test
 * This script can be run directly in the browser console to test question-only image upload
 */

async function testQuestionOnlyUpload() {
  console.log('📝 Testing Question-Only Image Upload (q21.png)...');
  console.log('================================================');
  
  try {
    // Test 1: Check authentication
    console.log('\n1️⃣ Checking authentication...');
    const authToken = localStorage.getItem('authToken');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    
    if (!authToken || !user) {
      console.log('❌ User not authenticated. Please log in first.');
      console.log('   Go to the login page and log in with admin@intellimark.com / 123456');
      return;
    }
    
    console.log('✅ User authenticated:', user.email);
    
    // Test 2: Load q21.png image
    console.log('\n2️⃣ Loading q21.png test image...');
    
    // Create a file input to load the image
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    
    // We'll need to manually select the file, so we'll use a base64 approach
    // For now, let's use a test image data URL
    const testImageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    console.log('✅ Test image data prepared');
    
    // Test 3: Upload the image via API
    console.log('\n3️⃣ Uploading image via API...');
    
    const response = await fetch('http://localhost:5001/api/mark-homework', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        imageData: testImageData,
        model: 'chatgpt-4o'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ API response received:', {
      success: data.success,
      hasUnifiedSession: !!data.unifiedSession,
      sessionId: data.unifiedSession?.id,
      messageCount: data.unifiedSession?.messages?.length
    });
    
    // Test 4: Check classification result
    console.log('\n4️⃣ Checking classification result...');
    
    if (data.unifiedSession) {
      const session = data.unifiedSession;
      console.log('📊 Session details:', {
        id: session.id,
        title: session.title,
        messageType: session.messageType,
        userId: session.userId,
        messageCount: session.messages?.length
      });
      
      // Check if it was classified as question-only
      const isQuestionOnly = session.messageType === 'Question' || 
                            session.title?.includes('Question') ||
                            session.messages?.some(msg => msg.type === 'question');
      
      console.log('🔍 Classification result:', {
        messageType: session.messageType,
        isQuestionOnly: isQuestionOnly,
        title: session.title
      });
      
      if (isQuestionOnly) {
        console.log('✅ SUCCESS: Image was correctly classified as question-only!');
      } else {
        console.log('⚠️ WARNING: Image was classified as marking, not question-only');
        console.log('   This indicates the AI classification may need adjustment');
      }
      
      // Test 5: Check messages
      console.log('\n5️⃣ Checking messages...');
      if (session.messages && session.messages.length > 0) {
        session.messages.forEach((msg, index) => {
          console.log(`📝 Message ${index + 1}:`, {
            role: msg.role,
            type: msg.type,
            hasContent: !!msg.content,
            hasImage: !!(msg.imageData || msg.imageUrl),
            contentPreview: msg.content?.substring(0, 100) + '...'
          });
        });
      } else {
        console.log('❌ No messages found in session');
      }
      
    } else {
      console.log('❌ No unified session in response');
    }
    
    // Test 6: Instructions for manual testing
    console.log('\n6️⃣ Manual Testing Instructions...');
    console.log('📋 To test with the actual q21.png image:');
    console.log('   1. Go to the Mark Homework page');
    console.log('   2. Click on the image upload area');
    console.log('   3. Select q21.png from the testingdata folder');
    console.log('   4. Wait for processing to complete');
    console.log('   5. Check the backend console for:');
    console.log('      🔍 [CLASSIFICATION] isQuestionOnly: true/false, reasoning: ...');
    console.log('   6. Verify the session shows messageType: "Question"');
    
    console.log('\n🎉 Test completed!');
    console.log('💡 Check the backend console for detailed classification logs');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Auto-run the test
console.log('🚀 Auto-running question-only upload test...');
testQuestionOnlyUpload();

// Also make it available globally
window.testQuestionOnlyUpload = testQuestionOnlyUpload;

console.log('💡 You can also run testQuestionOnlyUpload() manually in the console');
