/**
 * Test script for Parent-Child UnifiedSessions/Messages structure
 * Tests the new parent-child collection structure
 */

const BASE_URL = 'http://localhost:5001';

async function testParentChildStructure() {

  try {
    // Test 1: Simulate marking mode upload (creates parent session + child messages)
    
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
    
    if (markResult.session) {
        id: markResult.session.id,
        messageCount: markResult.session.messages?.length || 0,
        messageTypes: markResult.session.messages?.map(m => m.type) || []
      });

      const sessionId = markResult.session.id;

      // Test 2: Load session using parent-child structure
      const sessionResponse = await fetch(`${BASE_URL}/api/messages/session/${sessionId}`);
      const sessionResult = await sessionResponse.json();
      
      if (sessionResult.session && sessionResult.session.messages) {
        sessionResult.session.messages.forEach((msg, index) => {
            hasImageData: !!msg.imageData,
            hasMarkingData: !!msg.markingData,
            annotatedImageInMarkingData: !!msg.markingData?.annotatedImage,
            content: msg.content.substring(0, 50) + '...'
          });
        });

        // Test 3: Check for annotated image data
        const assistantMessage = sessionResult.session.messages.find(m => m.role === 'assistant');
        if (assistantMessage) {
          const hasDirectImageData = !!assistantMessage.imageData;
          const hasMarkingDataImage = !!assistantMessage.markingData?.annotatedImage;
          
          
          if (hasDirectImageData || hasMarkingDataImage) {
          } else {
          }
        }
      }

      // Test 4: Get user sessions list
      const userSessionsResponse = await fetch(`${BASE_URL}/api/messages/sessions/test-user-123`);
      const userSessionsResult = await userSessionsResponse.json();

      if (userSessionsResult.sessions && userSessionsResult.sessions.length > 0) {
          id: userSessionsResult.sessions[0].id,
          title: userSessionsResult.sessions[0].title,
          messageType: userSessionsResult.sessions[0].messageType,
          messageCount: userSessionsResult.sessions[0].messageCount,
          hasImage: userSessionsResult.sessions[0].hasImage
        });
      }
    }

    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('📋 Full error:', error);
  }
}

// Run the test
testParentChildStructure();
