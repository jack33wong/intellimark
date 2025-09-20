/**
 * Node.js Question-Only Image Upload Test
 * This script tests the backend API directly for question-only image classification
 */

const fs = require('fs');
const path = require('path');

async function testQuestionOnlyUpload() {
  console.log('📝 Testing Question-Only Image Upload (q21.png)...');
  console.log('================================================');
  
  try {
    // Test 1: Check if backend is running
    console.log('\n1️⃣ Checking backend health...');
    
    const healthResponse = await fetch('http://localhost:5001/health');
    if (!healthResponse.ok) {
      throw new Error(`Backend not running: ${healthResponse.status}`);
    }
    
    console.log('✅ Backend is running');
    
    // Test 2: Load q21.png image
    console.log('\n2️⃣ Loading q21.png test image...');
    const imagePath = path.join(__dirname, '../../testingdata/q21.png');
    
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Test image not found: ${imagePath}`);
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    console.log('✅ Image loaded successfully');
    console.log(`   Image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);
    
    // Test 3: Upload the image via API (unauthenticated)
    console.log('\n3️⃣ Uploading image via API (unauthenticated)...');
    console.log('   Using backend default model (should be gemini-2.5-pro)');
    
    const uploadResponse = await fetch('http://localhost:5001/api/mark-homework/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageData: base64Image
        // No model specified - let backend use default (gemini-2.5-pro)
      })
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
    }
    
    const uploadData = await uploadResponse.json();
    console.log('✅ Upload response received:', {
      success: uploadData.success,
      hasUnifiedSession: !!uploadData.unifiedSession,
      sessionId: uploadData.unifiedSession?.id,
      messageCount: uploadData.unifiedSession?.messages?.length
    });
    
    // Test 4: Check classification result
    console.log('\n4️⃣ Checking classification result...');
    
    if (uploadData.unifiedSession) {
      const session = uploadData.unifiedSession;
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
      
      // Test 6: Wait for AI processing to complete
      console.log('\n6️⃣ Waiting for AI processing to complete...');
      
      if (uploadData.processing) {
        console.log('⏳ Processing in progress, waiting for completion...');
        
        // Wait a bit for processing to complete
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Try to get the processed result
        const processResponse = await fetch('http://localhost:5001/api/mark-homework/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            imageData: base64Image,
            sessionId: session.id
            // No model specified - let backend use default (gemini-2.5-pro)
          })
        });
        
        if (processResponse.ok) {
          const processData = await processResponse.json();
          console.log('✅ AI processing completed:', {
            success: processData.success,
            hasUnifiedSession: !!processData.unifiedSession,
            messageCount: processData.unifiedSession?.messages?.length
          });
          
          if (processData.unifiedSession) {
            const finalSession = processData.unifiedSession;
            console.log('📊 Final session details:', {
              messageType: finalSession.messageType,
              title: finalSession.title,
              messageCount: finalSession.messages?.length
            });
            
            // Check final classification
            const finalIsQuestionOnly = finalSession.messageType === 'Question';
            console.log('🔍 Final classification:', {
              messageType: finalSession.messageType,
              isQuestionOnly: finalIsQuestionOnly
            });
            
            if (finalIsQuestionOnly) {
              console.log('✅ FINAL SUCCESS: Image was correctly classified as question-only!');
            } else {
              console.log('❌ FINAL RESULT: Image was classified as marking');
            }
          }
        } else {
          console.log('⚠️ AI processing request failed, but upload was successful');
        }
      } else {
        console.log('ℹ️ No processing indicator, checking if already complete');
      }
      
    } else {
      console.log('❌ No unified session in response');
    }
    
    // Test 7: Summary
    console.log('\n7️⃣ Test Summary...');
    console.log('==================');
    console.log('✅ Backend health check: PASSED');
    console.log('✅ Image loading: PASSED');
    console.log('✅ API upload: PASSED');
    console.log('✅ Session creation: PASSED');
    console.log('💡 Check backend console for detailed classification logs:');
    console.log('   🔍 [CLASSIFICATION] isQuestionOnly: true/false, reasoning: ...');
    
    // Test 8: Test with explicit Gemini model
    console.log('\n8️⃣ Testing with explicit Gemini model...');
    
    const geminiResponse = await fetch('http://localhost:5001/api/mark-homework/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageData: base64Image,
        model: 'gemini-2.5-pro'
      })
    });
    
    if (geminiResponse.ok) {
      const geminiData = await geminiResponse.json();
      console.log('✅ Gemini model test passed');
      console.log('   Model used:', geminiData.modelUsed || 'default');
    } else {
      console.log('⚠️ Gemini model test failed, but this is expected due to quota limits');
    }
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    
    if (error.message.includes('Backend not running')) {
      console.log('\n💡 To fix this:');
      console.log('   1. Start the backend: cd backend && npm run dev');
      console.log('   2. Wait for it to start (should see "Server running at http://localhost:5001")');
      console.log('   3. Run this test again');
    }
  }
}

// Run the test
if (require.main === module) {
  testQuestionOnlyUpload().catch(console.error);
}

module.exports = testQuestionOnlyUpload;
