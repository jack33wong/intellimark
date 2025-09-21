#!/usr/bin/env node

/**
 * Test Authentication Check
 * 
 * Simple test to verify user authentication is working
 */

const puppeteer = require('puppeteer');

async function testAuthCheck() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  
  try {
    console.log('🧪 Testing Authentication Check...\n');

    // Navigate to login page
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    console.log('✅ Navigated to login page');

    // Login
    await page.type('input[type="email"]', 'admin@intellimark.com');
    await page.type('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log('✅ Logged in successfully');

    // Navigate to mark homework page
    await page.goto('http://localhost:3000/mark-homework', { waitUntil: 'networkidle0' });
    console.log('✅ Navigated to mark homework page');

    // Check if user is authenticated by looking for user info in console
    const userInfo = await page.evaluate(() => {
      // Try to access the user from the React context
      const reactRoot = document.querySelector('#root');
      if (reactRoot && reactRoot._reactInternalFiber) {
        return 'React fiber found';
      }
      return 'No React fiber found';
    });
    console.log('📊 User info check:', userInfo);

    // Check if there are any authentication-related console logs
    const authLogs = [];
    page.on('console', msg => {
      if (msg.text().includes('user') || msg.text().includes('auth') || msg.text().includes('login')) {
        authLogs.push(msg.text());
      }
    });

    // Wait a moment for any auth logs
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('📋 Auth-related console messages:');
    authLogs.forEach(log => console.log('  ', log));

    console.log('🎉 Auth check completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  testAuthCheck().catch(console.error);
}

module.exports = { testAuthCheck };
