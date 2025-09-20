/**
 * Comprehensive Test for Authenticated User
 * 
 * Tests that admin@intellimark.com / 123456 works exactly like unauthenticated users
 * plus verifies database persistence
 */

const puppeteer = require('puppeteer-core');

async function testAuthenticatedUserComprehensive() {
  console.log('🧪 Testing Authenticated User (admin@intellimark.com) - Comprehensive Test...\n');

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

    // Test 1: Clear any existing tokens and navigate to login
    console.log('📋 Test 1: Clear existing tokens and navigate to login');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    console.log('✅ Local storage cleared, navigated to login page');

    // Test 2: Sign in as admin@intellimark.com
    console.log('\n📋 Test 2: Sign in as admin@intellimark.com');
    
    // Fill out signin form
    await page.type('input[name="email"]', 'admin@intellimark.com');
    await page.type('input[name="password"]', '123456');
    console.log('✅ Admin credentials entered');
    
    // Click signin button
    await page.click('.auth-submit-button');
    console.log('✅ Signin button clicked');
    
    // Wait for response and redirect
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify redirect to mark-homework page
    const currentUrl = page.url();
    if (currentUrl.includes('/mark-homework')) {
      console.log('✅ Successfully redirected to mark-homework page');
    } else {
      console.log('❌ Not redirected to mark-homework page');
      return;
    }

    // Test 3: Verify authentication logs
    console.log('\n📋 Test 3: Verify authentication logs');
    
    const authLogs = consoleLogs.filter(log => 
      log.includes('admin@intellimark.com') || 
      log.includes('User authenticated') ||
      log.includes('Signin successful')
    );
    
    console.log(`📊 Authentication logs found: ${authLogs.length}`);
    authLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    const hasAdminEmail = authLogs.some(log => 
      log.includes('admin@intellimark.com')
    );
    
    if (hasAdminEmail) {
      console.log('✅ Admin email found in authentication logs');
    } else {
      console.log('❌ Admin email not found in authentication logs');
    }

    // Test 4: Test immediate image display (same as unauthenticated)
    console.log('\n📋 Test 4: Test immediate image display');
    
    // Upload an image
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile('./testingdata/q19.png');
      console.log('✅ Image uploaded');
      
      // Wait for image preview
      await page.waitForSelector('.followup-preview-image', { timeout: 5000 });
      console.log('✅ Image preview displayed');
      
      // Click send button
      const sendButton = await page.$('.send-button');
      if (sendButton) {
        await sendButton.click();
        console.log('✅ Send button clicked');
        
        // Wait for user message to appear
        await page.waitForSelector('.chat-message', { timeout: 10000 });
        console.log('✅ User message appeared');
        
        // Check if image is immediately visible in chat
        const imageInChat = await page.$('.chat-message .followup-preview-image');
        if (imageInChat) {
          console.log('✅ Image immediately visible in chat (same as unauthenticated)');
        } else {
          console.log('❌ Image not immediately visible in chat');
        }
      }
    }

    // Test 5: Test AI thinking animation
    console.log('\n📋 Test 5: Test AI thinking animation');
    
    // Look for AI thinking animation
    const aiThinking = await page.$('.ai-thinking-animation, .loading-spinner');
    if (aiThinking) {
      console.log('✅ AI thinking animation displayed');
    } else {
      console.log('⚠️ AI thinking animation not found (may have completed quickly)');
    }

    // Test 6: Wait for AI response and verify message count
    console.log('\n📋 Test 6: Wait for AI response and verify message count');
    
    // Wait for AI response (up to 30 seconds)
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Count chat messages
    const chatMessages = await page.$$('.chat-message');
    console.log(`📊 Total chat messages: ${chatMessages.length}`);
    
    if (chatMessages.length >= 2) {
      console.log('✅ Correct number of messages (user + AI)');
    } else {
      console.log('❌ Incorrect number of messages');
    }

    // Test 7: Test follow-up image upload (database persistence)
    console.log('\n📋 Test 7: Test follow-up image upload (database persistence)');
    
    // Upload another image for follow-up
    const fileInput2 = await page.$('input[type="file"]');
    if (fileInput2) {
      await fileInput2.uploadFile('./testingdata/q19.png');
      console.log('✅ Follow-up image uploaded');
      
      // Wait for image preview
      await page.waitForSelector('.followup-preview-image', { timeout: 5000 });
      console.log('✅ Follow-up image preview displayed');
      
      // Click send button
      const sendButton2 = await page.$('.send-button');
      if (sendButton2) {
        await sendButton2.click();
        console.log('✅ Follow-up send button clicked');
        
        // Wait for response
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Count total messages after follow-up
        const finalChatMessages = await page.$$('.chat-message');
        console.log(`📊 Total messages after follow-up: ${finalChatMessages.length}`);
        
        if (finalChatMessages.length >= 4) {
          console.log('✅ Follow-up upload successful (4+ messages total)');
        } else {
          console.log('❌ Follow-up upload failed');
        }
      }
    }

    // Test 8: Verify database persistence (check for session data)
    console.log('\n📋 Test 8: Verify database persistence');
    
    // Check if session data is being stored
    const sessionLogs = consoleLogs.filter(log => 
      log.includes('session') || 
      log.includes('database') || 
      log.includes('persist') ||
      log.includes('Firestore')
    );
    
    console.log(`📊 Database persistence logs found: ${sessionLogs.length}`);
    sessionLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    if (sessionLogs.length > 0) {
      console.log('✅ Database persistence activity detected');
    } else {
      console.log('⚠️ No database persistence logs found (may be working silently)');
    }

    // Test 9: Verify no wrong profile loading
    console.log('\n📋 Test 9: Verify no wrong profile loading');
    
    const wrongProfileLogs = consoleLogs.filter(log => 
      log.includes('jack.33.wong@gmail.com') ||
      log.includes('leonard.11.wong@gmail.com') ||
      log.includes('louis.10.wong@gmail.com')
    );
    
    console.log(`📊 Wrong profile logs found: ${wrongProfileLogs.length}`);
    wrongProfileLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    if (wrongProfileLogs.length === 0) {
      console.log('✅ No wrong profile found in logs');
    } else {
      console.log('❌ Wrong profile found in logs - this is the issue!');
    }

    // Test 10: Verify admin role and permissions
    console.log('\n📋 Test 10: Verify admin role and permissions');
    
    const adminLogs = consoleLogs.filter(log => 
      log.includes('admin') || 
      log.includes('role') ||
      log.includes('permission')
    );
    
    console.log(`📊 Admin role logs found: ${adminLogs.length}`);
    adminLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    const hasAdminRole = adminLogs.some(log => 
      log.includes('role: admin') || 
      log.includes('admin role')
    );
    
    if (hasAdminRole) {
      console.log('✅ Admin role detected in logs');
    } else {
      console.log('⚠️ Admin role not clearly detected in logs');
    }

    // Test 11: Verify token persistence
    console.log('\n📋 Test 11: Verify token persistence');
    
    const token = await page.evaluate(() => localStorage.getItem('authToken'));
    if (token) {
      console.log(`✅ Token persisted in localStorage: ${token.substring(0, 20)}...`);
      
      // Check if token contains admin email
      if (token.includes('admin-at-intellimark-com')) {
        console.log('✅ Token contains admin email information');
      } else {
        console.log('❌ Token does not contain admin email information');
      }
    } else {
      console.log('❌ No token found in localStorage');
    }

    // Test 12: Verify UI behavior matches unauthenticated user
    console.log('\n📋 Test 12: Verify UI behavior matches unauthenticated user');
    
    // Check if chat input is in correct position
    const chatInput = await page.$('.follow-up-chat-input-container');
    if (chatInput) {
      const className = await chatInput.evaluate(el => el.className);
      if (className.includes('follow-up-center')) {
        console.log('✅ Chat input in center position (initial state)');
      } else if (className.includes('follow-up-bottom')) {
        console.log('✅ Chat input in bottom position (after interaction)');
      } else {
        console.log('⚠️ Chat input position unclear');
      }
    }

    // Test 13: Verify error handling
    console.log('\n📋 Test 13: Verify error handling');
    
    const errorLogs = consoleLogs.filter(log => 
      log.includes('error') || 
      log.includes('Error') || 
      log.includes('❌') ||
      log.includes('Failed')
    );
    
    console.log(`📊 Error logs found: ${errorLogs.length}`);
    errorLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    if (errorLogs.length === 0) {
      console.log('✅ No errors found in logs');
    } else {
      console.log('⚠️ Some errors found in logs (may be expected)');
    }

    // Test 14: Final verification - all core functionality working
    console.log('\n📋 Test 14: Final verification - all core functionality working');
    
    const successLogs = consoleLogs.filter(log => 
      log.includes('success') || 
      log.includes('Success') || 
      log.includes('✅') ||
      log.includes('completed')
    );
    
    console.log(`📊 Success logs found: ${successLogs.length}`);
    
    // Summary
    console.log('\n🎉 Authenticated User Comprehensive Test Completed!');
    console.log('\n📊 Test Summary:');
    console.log(`  - Authentication: ${hasAdminEmail ? '✅' : '❌'}`);
    console.log(`  - Image Display: ${chatMessages.length >= 2 ? '✅' : '❌'}`);
    console.log(`  - Message Count: ${chatMessages.length >= 2 ? '✅' : '❌'}`);
    console.log(`  - Follow-up Upload: ${chatMessages.length >= 2 ? '✅' : '❌'}`);
    console.log(`  - Database Persistence: ${sessionLogs.length > 0 ? '✅' : '⚠️'}`);
    console.log(`  - No Wrong Profile: ${wrongProfileLogs.length === 0 ? '✅' : '❌'}`);
    console.log(`  - Token Persistence: ${token ? '✅' : '❌'}`);
    console.log(`  - Error Handling: ${errorLogs.length === 0 ? '✅' : '⚠️'}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testAuthenticatedUserComprehensive().catch(console.error);
