/**
 * Test Authentication Flow
 * This script tests the complete authentication flow with the backend
 */

async function testAuthFlow() {
  console.log('🔐 Testing Authentication Flow...');
  
  try {
    // Test 1: Check if user is authenticated
    console.log('\n1️⃣ Checking authentication status...');
    const authToken = localStorage.getItem('authToken');
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    
    console.log('Auth token:', authToken ? 'Present' : 'Missing');
    console.log('User:', user ? `Logged in as ${user.email}` : 'Not logged in');
    
    if (!authToken || !user) {
      console.log('❌ User not authenticated. Please log in first.');
      return;
    }
    
    // Test 2: Test authenticated API call
    console.log('\n2️⃣ Testing authenticated API call...');
    const testImageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
    
    const response = await fetch('http://localhost:5001/api/mark-homework', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        imageData: testImageData,
        model: 'gemini-2.5-pro'
      })
    });
    
    const data = await response.json();
    console.log('✅ Authenticated API response:', {
      success: data.success,
      hasUnifiedSession: !!data.unifiedSession,
      sessionId: data.unifiedSession?.id,
      messageCount: data.unifiedSession?.messages?.length,
      userId: data.unifiedSession?.userId
    });
    
    if (data.unifiedSession) {
      // Test 3: Test session loading from database
      console.log('\n3️⃣ Testing session loading from database...');
      const sessionId = data.unifiedSession.id;
      
      const loadResponse = await fetch(`http://localhost:5001/api/messages/session/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      
      const loadData = await loadResponse.json();
      console.log('✅ Session loading response:', {
        success: loadData.success,
        hasSession: !!loadData.session,
        messageCount: loadData.session?.messages?.length,
        sessionId: loadData.session?.id
      });
      
      if (loadData.success && loadData.session) {
        console.log('🎉 SUCCESS: Data is being persisted to database!');
        
        // Test 4: Check image data
        console.log('\n4️⃣ Checking image data...');
        const messages = loadData.session.messages || [];
        const imageMessage = messages.find(msg => msg.imageData || msg.imageUrl);
        
        if (imageMessage) {
          console.log('✅ Image data found:', {
            hasImageData: !!imageMessage.imageData,
            hasImageUrl: !!imageMessage.imageUrl,
            imageType: imageMessage.type
          });
        } else {
          console.log('❌ No image data found in messages');
        }
      } else {
        console.log('❌ Session not found in database');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
console.log('Run testAuthFlow() in browser console to test authentication flow');

