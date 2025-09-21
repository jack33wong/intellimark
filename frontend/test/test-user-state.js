#!/usr/bin/env node

/**
 * Test User State
 * 
 * Test to verify user state in React components
 */

const puppeteer = require('puppeteer');

async function testUserState() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  
  try {
    console.log('🧪 Testing User State...\n');

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

    // Wait for the page to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check user state in the component
    const userState = await page.evaluate(() => {
      // Try to find the user state in the React component
      const favoriteBtn = document.querySelector('.favorite-btn');
      if (!favoriteBtn) return 'No favorite button found';
      
      return {
        buttonDisabled: favoriteBtn.disabled,
        buttonTitle: favoriteBtn.title,
        hasOnclick: favoriteBtn.onclick !== null,
        buttonClasses: favoriteBtn.className
      };
    });
    console.log('📊 User state in component:', userState);

    // Check if there are any console logs about user authentication
    const authLogs = [];
    page.on('console', msg => {
      if (msg.text().includes('AuthContext') || msg.text().includes('user') || msg.text().includes('auth')) {
        authLogs.push(msg.text());
      }
    });

    // Wait for any auth logs
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('📋 Auth-related console messages:');
    authLogs.forEach(log => console.log('  ', log));

    console.log('🎉 User state test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  testUserState().catch(console.error);
}

module.exports = { testUserState };
