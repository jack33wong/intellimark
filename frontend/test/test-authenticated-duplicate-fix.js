/**
 * Test Authenticated User Duplicate Fix
 * 
 * Tests that authenticated users don't create duplicate records in database
 */

const puppeteer = require('puppeteer-core');
const path = require('path');

async function testAuthenticatedDuplicateFix() {
  console.log('🧪 Testing Authenticated User Duplicate Fix...\n');

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

    // Check if user is authenticated
    const isAuthenticated = await page.evaluate(() => {
      return !!localStorage.getItem('authToken') || !!sessionStorage.getItem('authToken');
    });
    console.log(`📊 User authenticated: ${isAuthenticated}`);

    // Test 1: First upload (initial) - should create new session
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
            return logs.includes('Upload type detection - currentSession: false') && logs.includes('Calling onAnalyzeImage (initial upload)');
          },
          { timeout: 10000 }
        );
        console.log('✅ Initial upload type detection working');
      }
    }

    // Wait for first upload to complete
    await page.waitForTimeout(5000);

    // Test 2: Second upload (follow-up) - should use same session
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
            return logs.includes('Upload type detection - currentSession: true') && logs.includes('Calling onFollowUpImage (follow-up upload)');
          },
          { timeout: 10000 }
        );
        console.log('✅ Follow-up upload type detection working');
      }
    }

    // Wait for second upload to complete
    await page.waitForTimeout(5000);

    // Test 3: Check console logs for session ID consistency
    console.log('\n📋 Test 3: Check console logs for session ID consistency');
    
    const sessionIdLogs = consoleLogs.filter(log => 
      log.includes('sessionId=') || log.includes('session-')
    );
    
    console.log(`📊 Session ID logs found: ${sessionIdLogs.length}`);
    sessionIdLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    // Extract session IDs
    const sessionIds = sessionIdLogs
      .map(log => {
        const match = log.match(/session-(\d+)-(\w+)/);
        return match ? match[0] : null;
      })
      .filter(Boolean);
    
    const uniqueSessionIds = [...new Set(sessionIds)];
    console.log(`📊 Unique session IDs: ${uniqueSessionIds.length}`);
    uniqueSessionIds.forEach(id => {
      console.log(`  ${id}`);
    });
    
    if (uniqueSessionIds.length === 1) {
      console.log('✅ Same session ID used for both uploads');
    } else {
      console.log(`❌ Different session IDs used: ${uniqueSessionIds.length} unique IDs`);
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
    
    const hasInitialUpload = duplicatePreventionLogs.some(log => 
      log.includes('Creating user message for initial upload')
    );
    const hasFollowUpUpload = duplicatePreventionLogs.some(log => 
      log.includes('Skipping local user message for follow-up upload')
    );
    
    if (hasInitialUpload && hasFollowUpUpload) {
      console.log('✅ Duplicate prevention working correctly');
    } else {
      console.log('❌ Duplicate prevention not working properly');
      console.log(`  Initial upload detected: ${hasInitialUpload}`);
      console.log(`  Follow-up upload detected: ${hasFollowUpUpload}`);
    }

    // Test 5: Check for upload type detection logs
    console.log('\n📋 Test 5: Check for upload type detection logs');
    
    const uploadTypeLogs = consoleLogs.filter(log => 
      log.includes('Upload type detection') || 
      log.includes('Calling onAnalyzeImage (initial upload)') ||
      log.includes('Calling onFollowUpImage (follow-up upload)')
    );
    
    console.log(`📊 Upload type detection logs found: ${uploadTypeLogs.length}`);
    uploadTypeLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    const hasInitialUploadType = uploadTypeLogs.some(log => 
      log.includes('currentSession: false') && log.includes('Calling onAnalyzeImage (initial upload)')
    );
    const hasFollowUpUploadType = uploadTypeLogs.some(log => 
      log.includes('currentSession: true') && log.includes('Calling onFollowUpImage (follow-up upload)')
    );
    
    if (hasInitialUploadType && hasFollowUpUploadType) {
      console.log('✅ Upload type detection working correctly for both initial and follow-up');
    } else {
      console.log('❌ Upload type detection not working properly');
      console.log(`  Initial upload type detected: ${hasInitialUploadType}`);
      console.log(`  Follow-up upload type detected: ${hasFollowUpUploadType}`);
    }

    // Test 6: Check for API call logs
    console.log('\n📋 Test 6: Check for API call logs');
    
    const apiLogs = consoleLogs.filter(log => 
      log.includes('Phase 1: Calling /mark-homework/upload endpoint') ||
      log.includes('Phase 2: Calling /mark-homework/process endpoint')
    );
    
    console.log(`📊 API call logs found: ${apiLogs.length}`);
    apiLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    // Count API calls
    const phase1Calls = apiLogs.filter(log => log.includes('Phase 1: Calling /mark-homework/upload endpoint')).length;
    const phase2Calls = apiLogs.filter(log => log.includes('Phase 2: Calling /mark-homework/process endpoint')).length;
    
    console.log(`📊 Phase 1 API calls: ${phase1Calls}`);
    console.log(`📊 Phase 2 API calls: ${phase2Calls}`);
    
    if (phase1Calls === 2 && phase2Calls === 2) {
      console.log('✅ Correct number of API calls (2 uploads × 2 phases each)');
    } else {
      console.log(`❌ Incorrect number of API calls - Expected: 4 total, Got: ${phase1Calls + phase2Calls}`);
    }

    console.log('\n🎉 Authenticated User Duplicate Fix Test Completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testAuthenticatedDuplicateFix().catch(console.error);
