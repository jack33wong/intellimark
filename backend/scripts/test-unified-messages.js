/**
 * Test script for Parent-Child UnifiedSessions/Messages structure
 * Tests the new parent-child collection structure
 */

const BASE_URL = 'http://localhost:5001';

async function testParentChildStructure() {
  console.log('🧪 Testing Parent-Child UnifiedSessions/Messages Structure...\n');

  try {
    // Test 1: Simulate marking mode upload (creates parent session + child messages)
    console.log('📝 Test 1: Simulating marking mode upload...');
    
    const testImageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const annotatedImageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBgAAAABQABhxZ5YwAAAABJRU5ErkJggg==';
    
    const markHomeworkResponse = await fetch(`${BASE_URL}/api/mark-homework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageData: testImageData,
        model: 'chatgpt-4o',
        userId: 'test-user-123'
      })
    });
    
    const markResult = await markHomeworkResponse.json();
    console.log('   ✅ Marking upload completed:', markResult.success);
    console.log('   📊 Session saved:', markResult.sessionSaved);
    
    if (markResult.session) {
      console.log('   🔍 Session preview:', {
        id: markResult.session.id,
        messageCount: markResult.session.messages?.length || 0,
        messageTypes: markResult.session.messages?.map(m => m.type) || []
      });

      const sessionId = markResult.session.id;

      // Test 2: Load session using parent-child structure
      console.log('\n📖 Test 2: Loading session from parent-child structure...');
      const sessionResponse = await fetch(`${BASE_URL}/api/messages/session/${sessionId}`);
      const sessionResult = await sessionResponse.json();
      console.log('   ✅ Session loaded:', sessionResult.success);
      console.log('   📊 Message count:', sessionResult.messageCount);
      
      if (sessionResult.session && sessionResult.session.messages) {
        console.log('   🔍 Message details:');
        sessionResult.session.messages.forEach((msg, index) => {
          console.log(`     ${index + 1}. ${msg.role} (${msg.type}):`, {
            hasImageData: !!msg.imageData,
            hasMarkingData: !!msg.markingData,
            annotatedImageInMarkingData: !!msg.markingData?.annotatedImage,
            content: msg.content.substring(0, 50) + '...'
          });
        });

        // Test 3: Check for annotated image data
        console.log('\n🖼️  Test 3: Checking annotated image availability...');
        const assistantMessage = sessionResult.session.messages.find(m => m.role === 'assistant');
        if (assistantMessage) {
          const hasDirectImageData = !!assistantMessage.imageData;
          const hasMarkingDataImage = !!assistantMessage.markingData?.annotatedImage;
          
          console.log('   📊 Annotated image locations:');
          console.log('     - Direct imageData:', hasDirectImageData);
          console.log('     - markingData.annotatedImage:', hasMarkingDataImage);
          
          if (hasDirectImageData || hasMarkingDataImage) {
            console.log('   ✅ Annotated image data is available for frontend display');
          } else {
            console.log('   ❌ No annotated image data found');
          }
        }
      }

      // Test 4: Get user sessions list
      console.log('\n📚 Test 4: Getting user sessions from parent collection...');
      const userSessionsResponse = await fetch(`${BASE_URL}/api/messages/sessions/test-user-123`);
      const userSessionsResult = await userSessionsResponse.json();
      console.log('   ✅ User sessions retrieved:', userSessionsResult.success);
      console.log('   📊 Session count:', userSessionsResult.count);

      if (userSessionsResult.sessions && userSessionsResult.sessions.length > 0) {
        console.log('   🔍 Latest session preview:', {
          id: userSessionsResult.sessions[0].id,
          title: userSessionsResult.sessions[0].title,
          messageType: userSessionsResult.sessions[0].messageType,
          messageCount: userSessionsResult.sessions[0].messageCount,
          hasImage: userSessionsResult.sessions[0].hasImage
        });
      }
    }

    console.log('\n🎉 Parent-Child structure tests completed!');
    console.log('\n📋 Expected Database Structure:');
    console.log('   📁 unifiedSessions (single collection)');
    console.log('     └── sessionId (document with session metadata + nested messages)');
    console.log('         ├── session metadata (title, userId, messageType, etc.)');
    console.log('         └── unifiedMessages: [');
    console.log('               ├── { messageId1: user message with original image }');
    console.log('               └── { messageId2: assistant message with annotated image }');
    console.log('             ]');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('📋 Full error:', error);
  }
}

// Run the test
testParentChildStructure();
