/**
 * Simple Test for Follow-up Image Upload Duplicate Fix
 * 
 * Tests that the upload type detection is working correctly
 */

const puppeteer = require('puppeteer-core');
const path = require('path');

async function testDuplicateFixSimple() {
  console.log('🧪 Testing Follow-up Image Upload Duplicate Fix (Simple)...\n');

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

    // Test 1: First upload (initial) - should create local user message
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
        
        // Wait for the upload type detection logs
        await page.waitForFunction(
          () => {
            const logs = Array.from(document.querySelectorAll('*')).map(el => el.textContent).join(' ');
            return logs.includes('Upload type: INITIAL') && logs.includes('Creating user message for initial upload');
          },
          { timeout: 10000 }
        );
        console.log('✅ Upload type detection working for initial upload');
      }
    }

    // Wait a bit before second upload
    await page.waitForTimeout(2000);

    // Test 2: Second upload (follow-up) - should NOT create local user message
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
        
        // Wait for the upload type detection logs
        await page.waitForFunction(
          () => {
            const logs = Array.from(document.querySelectorAll('*')).map(el => el.textContent).join(' ');
            return logs.includes('Upload type: FOLLOW-UP') && logs.includes('Skipping local user message for follow-up upload');
          },
          { timeout: 10000 }
        );
        console.log('✅ Upload type detection working for follow-up upload');
      }
    }

    // Test 3: Check console logs for upload type detection
    console.log('\n📋 Test 3: Check console logs for upload type detection');
    
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

    // Test 4: Check for duplicate prevention logs
    console.log('\n📋 Test 4: Check for duplicate prevention logs');
    
    const duplicatePreventionLogs = consoleLogs.filter(log => 
      log.includes('Creating user message for initial upload') || 
      log.includes('Skipping local user message for follow-up upload')
    );
    
    console.log(`📊 Duplicate prevention logs found: ${duplicatePreventionLogs.length}`);
    duplicatePreventionLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    if (duplicatePreventionLogs.some(log => log.includes('Creating user message for initial upload')) && 
        duplicatePreventionLogs.some(log => log.includes('Skipping local user message for follow-up upload'))) {
      console.log('✅ Duplicate prevention working correctly');
    } else {
      console.log('❌ Duplicate prevention not working properly');
    }

    console.log('\n🎉 Follow-up Image Upload Duplicate Fix Test Completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testDuplicateFixSimple().catch(console.error);
