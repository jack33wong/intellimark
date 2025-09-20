/**
 * Direct Classification Test
 * This script directly tests the classification service to see what the AI responds
 */

const fs = require('fs');
const path = require('path');

async function testClassification() {
  console.log('🔍 Testing AI Classification Directly...');
  console.log('=====================================');
  
  try {
    // Load q21.png image
    const imagePath = path.join(__dirname, 'testingdata/q21.png');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    
    console.log('✅ Image loaded:', {
      path: imagePath,
      size: `${(imageBuffer.length / 1024).toFixed(2)} KB`,
      dimensions: '1732x668'
    });
    
    // Call the classification API directly
    console.log('\n🤖 Calling classification API...');
    
    const response = await fetch('http://localhost:5001/api/mark-homework/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageData: base64Image,
        model: 'gemini-2.5-pro'
      })
    });
    
    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('✅ API response received');
    console.log('📋 Full response keys:', Object.keys(data));
    console.log('📋 Classification in response:', !!data.classification);
    
    // Show the classification result
    if (data.unifiedSession) {
      console.log('\n📊 Classification Result:');
      console.log('========================');
      console.log('Session ID:', data.unifiedSession.id);
      console.log('Message Type:', data.unifiedSession.messageType);
      console.log('Title:', data.unifiedSession.title);
      console.log('User ID:', data.unifiedSession.userId);
      
      // Show classification details if available
      if (data.classification) {
        console.log('\n🔍 AI Classification Details:');
        console.log('============================');
        console.log('isQuestionOnly:', data.classification.isQuestionOnly);
        console.log('reasoning:', data.classification.reasoning);
        console.log('extractedQuestionText:', data.classification.extractedQuestionText?.substring(0, 200) + '...');
        console.log('apiUsed:', data.classification.apiUsed);
      }
      
      // Check if there are any messages with classification info
      if (data.unifiedSession.messages && data.unifiedSession.messages.length > 0) {
        console.log('\n📝 Messages:');
        data.unifiedSession.messages.forEach((msg, index) => {
          console.log(`  ${index + 1}. Role: ${msg.role}, Type: ${msg.type}`);
          if (msg.content) {
            console.log(`     Content: ${msg.content.substring(0, 100)}...`);
          }
        });
      }
    }
    
    console.log('\n💡 Check the backend console for detailed AI response logs:');
    console.log('   Look for: 🔍 [AI RESPONSE] Raw ... classification response:');
    console.log('   And: 🔍 [CLASSIFICATION] isQuestionOnly: ...');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testClassification();
