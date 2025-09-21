#!/usr/bin/env node

/**
 * Test Metadata API
 * 
 * Test that the API returns proper metadata with LLM tokens and Mathpix calls
 */

const fs = require('fs');
const path = require('path');

async function testMetadataAPI() {
  try {
    console.log('🧪 Testing Metadata API...\n');

    // Read test image
    const imagePath = path.resolve(__dirname, 'testingdata', 'q19.png');
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    const imageData = `data:image/png;base64,${imageBase64}`;

    // Test the API
    const response = await fetch('http://localhost:5001/api/mark-homework/process-single', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token' // This will work for unauthenticated users
      },
      body: JSON.stringify({
        imageData: imageData,
        model: 'chatgpt-4o',
        textInput: 'Test metadata'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error Response:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log('📊 API Response:');
    console.log('  - Success:', result.success);
    console.log('  - Session ID:', result.sessionId);
    console.log('  - Session Title:', result.sessionTitle);
    console.log('  - UnifiedSession Title:', result.unifiedSession?.title);
    console.log('  - Full Response Keys:', Object.keys(result));
    
    if (result.unifiedSession?.sessionMetadata) {
      console.log('  - Session Metadata:');
      console.log('    - Total Processing Time:', result.unifiedSession.sessionMetadata.totalProcessingTimeMs, 'ms');
      console.log('    - LLM Tokens:', result.unifiedSession.sessionMetadata.llmTokens);
      console.log('    - Mathpix Calls:', result.unifiedSession.sessionMetadata.mathpixCalls);
      console.log('    - Total Tokens:', result.unifiedSession.sessionMetadata.totalTokens);
      console.log('    - Average Confidence:', result.unifiedSession.sessionMetadata.averageConfidence);
      console.log('    - Image Size:', result.unifiedSession.sessionMetadata.imageSize);
      console.log('    - Total Annotations:', result.unifiedSession.sessionMetadata.totalAnnotations);
    } else {
      console.log('  - ❌ No session metadata found');
    }

    if (result.metadata) {
      console.log('  - Result Metadata:');
      console.log('    - Tokens Array:', result.metadata.tokens);
      console.log('    - Total Processing Time:', result.metadata.totalProcessingTimeMs, 'ms');
      console.log('    - Confidence:', result.metadata.confidence);
      console.log('    - Image Size:', result.metadata.imageSize);
      console.log('    - Total Annotations:', result.metadata.totalAnnotations);
    } else {
      console.log('  - ❌ No result metadata found');
    }

    // Check the AI message metadata
    if (result.aiMessage?.metadata) {
      console.log('  - AI Message Metadata:');
      console.log('    - Tokens Array:', result.aiMessage.metadata.tokens);
      console.log('    - Processing Time:', result.aiMessage.metadata.processingTimeMs, 'ms');
      console.log('    - Confidence:', result.aiMessage.metadata.confidence);
      console.log('    - Model Used:', result.aiMessage.metadata.modelUsed);
      console.log('    - API Used:', result.aiMessage.metadata.apiUsed);
    } else {
      console.log('  - ❌ No AI message metadata found');
    }

    console.log('🎉 Metadata API test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testMetadataAPI().catch(console.error);
}

module.exports = { testMetadataAPI };