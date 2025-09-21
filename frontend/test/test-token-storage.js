#!/usr/bin/env node

/**
 * Test Token Storage
 * 
 * Test to verify authentication token is being stored properly
 */

const puppeteer = require('puppeteer');

async function testTokenStorage() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  
  try {
    console.log('🧪 Testing Token Storage...\n');

    // Navigate to login page
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    console.log('✅ Navigated to login page');

    // Check if token exists before login
    const tokenBeforeLogin = await page.evaluate(() => {
      return localStorage.getItem('authToken');
    });
    console.log('📊 Token before login:', tokenBeforeLogin ? 'EXISTS' : 'NOT FOUND');

    // Login
    await page.type('input[type="email"]', 'admin@intellimark.com');
    await page.type('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log('✅ Logged in successfully');

    // Check if token exists after login
    const tokenAfterLogin = await page.evaluate(() => {
      return localStorage.getItem('authToken');
    });
    console.log('📊 Token after login:', tokenAfterLogin ? 'EXISTS' : 'NOT FOUND');

    if (tokenAfterLogin) {
      console.log('📊 Token value (first 20 chars):', tokenAfterLogin.substring(0, 20) + '...');
    }

    // Navigate to mark homework page
    await page.goto('http://localhost:3000/mark-homework', { waitUntil: 'networkidle0' });
    console.log('✅ Navigated to mark homework page');

    // Check if token still exists after navigation
    const tokenAfterNavigation = await page.evaluate(() => {
      return localStorage.getItem('authToken');
    });
    console.log('📊 Token after navigation:', tokenAfterNavigation ? 'EXISTS' : 'NOT FOUND');

    // Check if user is set in the app
    const userState = await page.evaluate(() => {
      // Try to find user in localStorage or sessionStorage
      const userFromStorage = localStorage.getItem('user') || sessionStorage.getItem('user');
      return userFromStorage || 'No user found in storage';
    });
    console.log('📊 User from storage:', userState);

    console.log('🎉 Token storage test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  testTokenStorage().catch(console.error);
}

module.exports = { testTokenStorage };
