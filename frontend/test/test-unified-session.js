/**
 * Test Script for UnifiedSession Implementation
 * This script tests the complete flow: upload → process → save → display
 */

// Test data
const testImageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

async function testUnifiedSession() {
  console.log('🧪 Testing UnifiedSession Implementation...');
  
  try {
    // Test 1: Check if backend is running
    console.log('\n1️⃣ Testing backend connectivity...');
    const healthResponse = await fetch('http://localhost:5001/api/mark-homework/health');
    const healthData = await healthResponse.json();
    console.log('✅ Backend health:', healthData);
    
    // Test 2: Test image processing
    console.log('\n2️⃣ Testing image processing...');
    const processResponse = await fetch('http://localhost:5001/api/mark-homework', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageData: testImageData,
        model: 'gemini-2.5-pro'
      })
    });
    
    const processData = await processResponse.json();
    console.log('✅ Image processing response:', {
      success: processData.success,
      hasUnifiedSession: !!processData.unifiedSession,
      sessionId: processData.unifiedSession?.id,
      messageCount: processData.unifiedSession?.messages?.length
    });
    
    if (processData.unifiedSession) {
      // Test 3: Test session loading
      console.log('\n3️⃣ Testing session loading...');
      const sessionId = processData.unifiedSession.id;
      const loadResponse = await fetch(`http://localhost:5001/api/messages/session/${sessionId}`);
      const loadData = await loadResponse.json();
      console.log('✅ Session loading response:', {
        success: loadData.success,
        hasSession: !!loadData.session,
        messageCount: loadData.session?.messages?.length
      });
    }
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testUnifiedSession();

