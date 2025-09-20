/**
 * Test Gemini API Access with Service Account
 * This script tests if the service account can access the Gemini API
 */

const { GoogleAuth } = require('google-auth-library');

async function testGeminiAPIAccess() {
  console.log('🔍 Testing Gemini API Access with Service Account...');
  console.log('================================================');
  
  try {
    // Step 1: Test authentication
    console.log('\n1️⃣ Testing service account authentication...');
    
    const auth = new GoogleAuth({
      keyFile: './intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json',
      scopes: [
        'https://www.googleapis.com/auth/cloud-platform',
        'https://www.googleapis.com/auth/generative-language'
      ]
    });
    
    const client = await auth.getClient();
    console.log('✅ GoogleAuth client created successfully');
    
    const accessToken = await client.getAccessToken();
    if (!accessToken.token) {
      throw new Error('Failed to get access token');
    }
    console.log('✅ Access token obtained successfully');
    console.log(`   Token length: ${accessToken.token.length} characters`);
    
    // Step 2: Test API availability
    console.log('\n2️⃣ Testing API availability...');
    
    const modelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`   API Response Status: ${modelsResponse.status}`);
    
    if (modelsResponse.status === 200) {
      const models = await modelsResponse.json();
      console.log('✅ API access successful!');
      console.log(`   Available models: ${models.models?.length || 0}`);
      
      // Look for Gemini models
      const geminiModels = models.models?.filter(m => m.name?.includes('gemini')) || [];
      console.log(`   Gemini models found: ${geminiModels.length}`);
      
      if (geminiModels.length > 0) {
        console.log('   Available Gemini models:');
        geminiModels.forEach(model => {
          console.log(`     - ${model.name}`);
        });
      }
    } else if (modelsResponse.status === 403) {
      console.log('❌ 403 Forbidden - API not enabled or insufficient permissions');
      console.log('   Please enable the Generative Language API in Google Cloud Console');
      console.log('   And ensure your service account has the required roles');
    } else if (modelsResponse.status === 404) {
      console.log('❌ 404 Not Found - API endpoint not found');
      console.log('   The Generative Language API might not be available in your region');
    } else {
      const errorText = await modelsResponse.text();
      console.log(`❌ API Error (${modelsResponse.status}): ${errorText}`);
    }
    
    // Step 3: Test actual Gemini API call
    console.log('\n3️⃣ Testing actual Gemini API call...');
    
    const testResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: "Hello, this is a test message. Please respond with 'API access working!'"
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 50
        }
      })
    });
    
    console.log(`   Gemini API Response Status: ${testResponse.status}`);
    
    if (testResponse.status === 200) {
      const result = await testResponse.json();
      const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
      console.log('✅ Gemini API call successful!');
      console.log(`   Response: ${content}`);
    } else {
      const errorText = await testResponse.text();
      console.log(`❌ Gemini API Error (${testResponse.status}): ${errorText}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.message.includes('Could not load the default credentials')) {
      console.log('\n💡 Solution: Make sure the service account JSON file exists and is readable');
    } else if (error.message.includes('403')) {
      console.log('\n💡 Solution: Enable the Generative Language API and grant proper permissions');
    } else if (error.message.includes('404')) {
      console.log('\n💡 Solution: The API might not be available in your region, try Vertex AI instead');
    }
  }
}

// Run the test
if (require.main === module) {
  testGeminiAPIAccess().catch(console.error);
}

module.exports = testGeminiAPIAccess;
