/**
 * Test User ID Mismatch Issue
 * 
 * This script tests the user ID mismatch between frontend and backend
 */

const puppeteer = require('puppeteer-core');

async function testUserIdMismatch() {
  console.log('🧪 Testing User ID Mismatch Issue...\n');

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

    // Navigate to login and sign in
    console.log('📋 Step 1: Navigate to login and sign in');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    // Sign in as admin
    await page.type('input[name="email"]', 'admin@intellimark.com');
    await page.type('input[name="password"]', '123456');
    await page.click('.auth-submit-button');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Navigate to mark-homework page
    console.log('📋 Step 2: Navigate to mark-homework page');
    await page.goto('http://localhost:3000/mark-homework', { waitUntil: 'networkidle0' });

    // Wait for the page to load and check for user ID logs
    console.log('📋 Step 3: Check for user ID logs');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Filter logs for user ID information
    const userLogs = consoleLogs.filter(log => 
      log.includes('User ID') || 
      log.includes('Authenticated') || 
      log.includes('Requested') || 
      log.includes('Match') ||
      log.includes('Access denied') ||
      log.includes('MarkingHistoryService') ||
      log.includes('userId:') ||
      log.includes('uid:')
    );

    console.log('\n📊 User ID Related Logs:');
    userLogs.forEach(log => {
      console.log(`  ${log}`);
    });

    // Check if we can find the specific mismatch
    const mismatchLogs = userLogs.filter(log => 
      log.includes('Access denied') || 
      log.includes('Match: false') ||
      log.includes('UID mismatch')
    );

    if (mismatchLogs.length > 0) {
      console.log('\n❌ User ID Mismatch Found:');
      mismatchLogs.forEach(log => {
        console.log(`  ${log}`);
      });
    } else {
      console.log('\n✅ No User ID Mismatch Found in Logs');
    }

    // Check the user object in localStorage
    const userInfo = await page.evaluate(() => {
      const token = localStorage.getItem('authToken');
      return {
        token: token ? token.substring(0, 50) + '...' : null,
        tokenLength: token ? token.length : 0
      };
    });

    console.log('\n📊 Token Information:');
    console.log(`  Token present: ${!!userInfo.token}`);
    console.log(`  Token length: ${userInfo.tokenLength}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testUserIdMismatch().catch(console.error);
