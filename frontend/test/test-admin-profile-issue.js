/**
 * Test Admin Profile Issue
 * 
 * Tests that signing in as admin@intellimark.com loads the correct profile
 */

const puppeteer = require('puppeteer-core');

async function testAdminProfileIssue() {
  console.log('🧪 Testing Admin Profile Issue...\n');

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

    // Navigate to login page
    console.log('📋 Navigating to login page...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    
    // Wait for component to load
    await page.waitForSelector('.auth-container', { timeout: 10000 });
    console.log('✅ Login page loaded successfully');

    // Test 1: Clear any existing tokens
    console.log('\n📋 Test 1: Clear existing tokens');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    console.log('✅ Local storage cleared');

    // Test 2: Sign in as admin@intellimark.com
    console.log('\n📋 Test 2: Sign in as admin@intellimark.com');
    
    // Fill out signin form
    await page.type('input[name="email"]', 'admin@intellimark.com');
    await page.type('input[name="password"]', 'admin123');
    console.log('✅ Admin credentials entered');
    
    // Click signin button
    await page.click('.auth-submit-button');
    console.log('✅ Signin button clicked');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 3: Check if redirected to mark-homework page
    console.log('\n📋 Test 3: Check if redirected to mark-homework page');
    
    const currentUrl = page.url();
    console.log(`📊 Current URL: ${currentUrl}`);
    
    if (currentUrl.includes('/mark-homework')) {
      console.log('✅ Successfully redirected to mark-homework page');
    } else {
      console.log('❌ Not redirected to mark-homework page');
    }

    // Test 4: Check user profile in console logs
    console.log('\n📋 Test 4: Check user profile in console logs');
    
    const authLogs = consoleLogs.filter(log => 
      log.includes('User authenticated') || 
      log.includes('Signin successful') ||
      log.includes('admin@intellimark.com')
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

    // Test 5: Check for wrong profile (jack.33.wong@gmail.com)
    console.log('\n📋 Test 5: Check for wrong profile (jack.33.wong@gmail.com)');
    
    const wrongProfileLogs = consoleLogs.filter(log => 
      log.includes('jack.33.wong@gmail.com')
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

    // Test 6: Check localStorage for correct token
    console.log('\n📋 Test 6: Check localStorage for correct token');
    
    const token = await page.evaluate(() => localStorage.getItem('authToken'));
    console.log(`📊 Token in localStorage: ${token ? 'Present' : 'Not present'}`);
    
    if (token) {
      console.log(`📊 Token length: ${token.length}`);
      console.log(`📊 Token starts with: ${token.substring(0, 20)}...`);
      console.log(`📊 Full token: ${token}`);
    } else {
      console.log('❌ No token found in localStorage');
      
      // Check all localStorage items
      const allItems = await page.evaluate(() => {
        const items = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          items[key] = localStorage.getItem(key);
        }
        return items;
      });
      console.log(`📊 All localStorage items:`, allItems);
    }

    // Test 7: Check if user is displayed correctly in UI
    console.log('\n📋 Test 7: Check if user is displayed correctly in UI');
    
    // Look for user email in the page content
    const pageContent = await page.content();
    const hasAdminInPage = pageContent.includes('admin@intellimark.com');
    const hasWrongUserInPage = pageContent.includes('jack.33.wong@gmail.com');
    
    console.log(`📊 Admin email in page: ${hasAdminInPage}`);
    console.log(`📊 Wrong user email in page: ${hasWrongUserInPage}`);
    
    if (hasAdminInPage && !hasWrongUserInPage) {
      console.log('✅ Correct user profile displayed in UI');
    } else if (hasWrongUserInPage) {
      console.log('❌ Wrong user profile displayed in UI - this is the issue!');
    } else {
      console.log('⚠️ User profile not clearly visible in UI');
    }

    console.log('\n🎉 Admin Profile Issue Test Completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testAdminProfileIssue().catch(console.error);
