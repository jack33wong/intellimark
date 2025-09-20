/**
 * Test Follow-up Image Upload Duplicate Fix
 * 
 * Tests that follow-up image uploads don't create duplicate records in database
 */

const puppeteer = require('puppeteer-core');
const path = require('path');

async function testFollowUpDuplicateFix() {
  console.log('🧪 Testing Follow-up Image Upload Duplicate Fix...\n');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Capture console logs
    const consoleLogs = [];
    page.on('console', msg => {
      const logText = msg.text();
      consoleLogs.push(logText);
      console.log(`📋 Console: ${logText}`);
    });

    // Navigate to mark homework page
    console.log('📋 Navigating to mark homework page...');
    await page.goto('http://localhost:3000/mark-homework', { waitUntil: 'networkidle0' });
    
    // Wait for component to load
    await page.waitForSelector('.follow-up-chat-input-container', { timeout: 10000 });
    console.log('✅ Page loaded successfully');

    // Test 1: First upload (initial)
    console.log('\n📋 Test 1: First upload (initial)');
    
    // Upload first image
    const fileInput = await page.$('#followup-file-input');
    if (fileInput) {
      const filePath = path.join(__dirname, 'testingdata', 'q19.png');
      await fileInput.uploadFile(filePath);
      console.log('✅ First image uploaded');
      
      // Wait for preview
      await page.waitForSelector('.followup-preview-image', { timeout: 5000 });
      console.log('✅ First image preview shown');
      
      // Click send button
      const sendButton = await page.$('.send-button');
      if (sendButton) {
        await sendButton.click();
        console.log('✅ First send button clicked');
        
        // Wait for response
        await page.waitForFunction(
          () => {
            const messages = document.querySelectorAll('.message');
            return messages.length >= 2;
          },
          { timeout: 60000 }
        );
        console.log('✅ First response received');
        
        // Count messages after first upload
        const firstUploadMessages = await page.$$eval('.message', messages => messages.length);
        console.log(`📊 First upload message count: ${firstUploadMessages}`);
        
        if (firstUploadMessages === 2) {
          console.log('✅ First upload: Exactly 2 messages (user + AI)');
        } else {
          console.log(`❌ First upload: Expected 2 messages, got ${firstUploadMessages}`);
        }
      }
    }

    // Wait a bit before second upload
    await page.waitForTimeout(2000);

    // Test 2: Second upload (follow-up)
    console.log('\n📋 Test 2: Second upload (follow-up)');
    
    // Upload second image
    const fileInput2 = await page.$('#followup-file-input');
    if (fileInput2) {
      const filePath2 = path.join(__dirname, 'testingdata', 'q19.png');
      await fileInput2.uploadFile(filePath2);
      console.log('✅ Second image uploaded');
      
      // Wait for preview
      await page.waitForSelector('.followup-preview-image', { timeout: 5000 });
      console.log('✅ Second image preview shown');
      
      // Click send button
      const sendButton2 = await page.$('.send-button');
      if (sendButton2) {
        await sendButton2.click();
        console.log('✅ Second send button clicked');
        
        // Wait for response
        await page.waitForFunction(
          () => {
            const messages = document.querySelectorAll('.message');
            return messages.length >= 4;
          },
          { timeout: 60000 }
        );
        console.log('✅ Second response received');
        
        // Count messages after second upload
        const secondUploadMessages = await page.$$eval('.message', messages => messages.length);
        console.log(`📊 Second upload message count: ${secondUploadMessages}`);
        
        if (secondUploadMessages === 4) {
          console.log('✅ Second upload: Exactly 4 messages (2 pairs of user + AI)');
        } else {
          console.log(`❌ Second upload: Expected 4 messages, got ${secondUploadMessages}`);
        }
      }
    }

    // Test 3: Check for duplicate user messages
    console.log('\n📋 Test 3: Check for duplicate user messages');
    
    const userMessages = await page.$$eval('.message', messages => {
      return messages
        .filter(msg => msg.querySelector('.message-role')?.textContent?.includes('user'))
        .map(msg => ({
          content: msg.querySelector('.message-content')?.textContent || '',
          timestamp: msg.querySelector('.message-timestamp')?.textContent || ''
        }));
    });
    
    console.log(`📊 User messages found: ${userMessages.length}`);
    userMessages.forEach((msg, index) => {
      console.log(`  ${index + 1}. "${msg.content}" (${msg.timestamp})`);
    });
    
    // Check for duplicates
    const duplicateContent = userMessages.filter((msg, index, arr) => 
      arr.findIndex(m => m.content === msg.content) !== index
    );
    
    if (duplicateContent.length === 0) {
      console.log('✅ No duplicate user messages found');
    } else {
      console.log(`❌ Found ${duplicateContent.length} duplicate user messages:`);
      duplicateContent.forEach((msg, index) => {
        console.log(`  ${index + 1}. "${msg.content}"`);
      });
    }

    // Test 4: Check console logs for upload type detection
    console.log('\n📋 Test 4: Check console logs for upload type detection');
    
    const uploadTypeLogs = consoleLogs.filter(log => 
      log.includes('Upload type:') || log.includes('INITIAL') || log.includes('FOLLOW-UP')
    );
    
    console.log(`📊 Upload type logs found: ${uploadTypeLogs.length}`);
    uploadTypeLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    if (uploadTypeLogs.some(log => log.includes('INITIAL')) && 
        uploadTypeLogs.some(log => log.includes('FOLLOW-UP'))) {
      console.log('✅ Upload type detection working correctly');
    } else {
      console.log('❌ Upload type detection not working properly');
    }

    console.log('\n🎉 Follow-up Image Upload Duplicate Fix Test Completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testFollowUpDuplicateFix().catch(console.error);
