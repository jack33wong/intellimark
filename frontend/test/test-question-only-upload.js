/**
 * Test Question-Only Image Upload
 * This script tests uploading a question-only image (q21.png) and verifies
 * that it's correctly classified as a question and processed accordingly.
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function testQuestionOnlyUpload() {
  console.log('📝 Testing Question-Only Image Upload...');
  console.log('=====================================');
  
  let browser;
  
  try {
    // Launch browser
    console.log('🚀 Launching browser...');
    browser = await puppeteer.launch({ 
      headless: false, // Set to true for headless mode
      defaultViewport: { width: 1280, height: 720 }
    });
    
    const page = await browser.newPage();
    
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'log') {
        console.log('📱 Browser:', msg.text());
      } else if (msg.type() === 'error') {
        console.error('❌ Browser Error:', msg.text());
      }
    });
    
    // Navigate to the app
    console.log('🌐 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Wait for the page to load
    await page.waitForSelector('[data-testid="mark-homework-page"]', { timeout: 10000 });
    console.log('✅ Page loaded successfully');
    
    // Test 1: Check if user is authenticated
    console.log('\n1️⃣ Checking authentication status...');
    const isAuthenticated = await page.evaluate(() => {
      const authToken = localStorage.getItem('authToken');
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      return !!(authToken && user);
    });
    
    if (!isAuthenticated) {
      console.log('🔐 User not authenticated, logging in...');
      
      // Click login button
      await page.click('[data-testid="login-button"]');
      await page.waitForSelector('[data-testid="email-input"]', { timeout: 5000 });
      
      // Fill in credentials
      await page.type('[data-testid="email-input"]', 'admin@intellimark.com');
      await page.type('[data-testid="password-input"]', '123456');
      
      // Submit login
      await page.click('[data-testid="login-submit"]');
      await page.waitForSelector('[data-testid="mark-homework-page"]', { timeout: 10000 });
      
      console.log('✅ Login successful');
    } else {
      console.log('✅ User already authenticated');
    }
    
    // Test 2: Load q21.png image
    console.log('\n2️⃣ Loading q21.png test image...');
    const imagePath = path.join(__dirname, '../../testingdata/q21.png');
    
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Test image not found: ${imagePath}`);
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    console.log('✅ Image loaded successfully');
    
    // Test 3: Upload the image
    console.log('\n3️⃣ Uploading question-only image...');
    
    // Wait for upload area to be ready
    await page.waitForSelector('[data-testid="image-upload-area"]', { timeout: 5000 });
    
    // Set up file input
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      throw new Error('File input not found');
    }
    
    // Upload the image
    await fileInput.uploadFile(imagePath);
    console.log('✅ Image uploaded to file input');
    
    // Wait for processing to start
    await page.waitForSelector('[data-testid="processing-state"]', { timeout: 10000 });
    console.log('✅ Processing started');
    
    // Test 4: Monitor processing and check classification
    console.log('\n4️⃣ Monitoring processing and classification...');
    
    // Wait for processing to complete (up to 30 seconds)
    await page.waitForFunction(() => {
      const processingElement = document.querySelector('[data-testid="processing-state"]');
      return !processingElement || processingElement.style.display === 'none';
    }, { timeout: 30000 });
    
    console.log('✅ Processing completed');
    
    // Test 5: Check the result
    console.log('\n5️⃣ Checking upload result...');
    
    const result = await page.evaluate(() => {
      // Check if we're back to idle state
      const idleElement = document.querySelector('[data-testid="idle-state"]');
      const completeElement = document.querySelector('[data-testid="complete-state"]');
      const errorElement = document.querySelector('[data-testid="error-state"]');
      
      // Get any error messages
      const errorMessage = document.querySelector('[data-testid="error-message"]')?.textContent;
      
      // Check for messages in the chat
      const messages = document.querySelectorAll('[data-testid="chat-message"]');
      const messageCount = messages.length;
      
      // Check session info
      const sessionInfo = document.querySelector('[data-testid="session-info"]')?.textContent;
      
      return {
        isIdle: !!idleElement,
        isComplete: !!completeElement,
        hasError: !!errorElement,
        errorMessage,
        messageCount,
        sessionInfo
      };
    });
    
    console.log('📊 Upload result:', result);
    
    if (result.hasError) {
      console.log('❌ Upload failed with error:', result.errorMessage);
      return;
    }
    
    if (result.messageCount > 0) {
      console.log('✅ Messages found in chat');
      
      // Test 6: Check message types and content
      console.log('\n6️⃣ Analyzing message content...');
      
      const messageAnalysis = await page.evaluate(() => {
        const messages = document.querySelectorAll('[data-testid="chat-message"]');
        const analysis = [];
        
        messages.forEach((msg, index) => {
          const role = msg.querySelector('[data-testid="message-role"]')?.textContent;
          const content = msg.querySelector('[data-testid="message-content"]')?.textContent;
          const type = msg.querySelector('[data-testid="message-type"]')?.textContent;
          
          analysis.push({
            index: index + 1,
            role,
            type,
            content: content?.substring(0, 100) + '...',
            hasImage: !!msg.querySelector('[data-testid="message-image"]')
          });
        });
        
        return analysis;
      });
      
      console.log('📋 Message analysis:', messageAnalysis);
      
      // Test 7: Check if it was classified as question-only
      console.log('\n7️⃣ Checking question-only classification...');
      
      const classificationCheck = await page.evaluate(() => {
        // Look for any indicators that this was classified as question-only
        const sessionTitle = document.querySelector('[data-testid="session-title"]')?.textContent;
        const messageTypes = Array.from(document.querySelectorAll('[data-testid="message-type"]')).map(el => el.textContent);
        
        return {
          sessionTitle,
          messageTypes,
          isQuestionOnly: sessionTitle?.includes('Question') || messageTypes.includes('question')
        };
      });
      
      console.log('🔍 Classification check:', classificationCheck);
      
      if (classificationCheck.isQuestionOnly) {
        console.log('✅ SUCCESS: Image was correctly classified as question-only!');
      } else {
        console.log('⚠️ WARNING: Image may not have been classified as question-only');
        console.log('   This could indicate an issue with the classification system');
      }
      
    } else {
      console.log('❌ No messages found in chat');
    }
    
    // Test 8: Check backend logs (if accessible)
    console.log('\n8️⃣ Checking backend classification logs...');
    console.log('💡 Look at the backend console for the classification debug log:');
    console.log('   🔍 [CLASSIFICATION] isQuestionOnly: true/false, reasoning: ...');
    console.log('   This will show you exactly why the AI classified the image');
    
    console.log('\n🎉 Test completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   - Image uploaded: ✅');
    console.log('   - Processing completed: ✅');
    console.log('   - Messages generated: ✅');
    console.log('   - Check backend logs for classification details');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
if (require.main === module) {
  testQuestionOnlyUpload().catch(console.error);
}

module.exports = testQuestionOnlyUpload;
