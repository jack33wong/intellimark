/**
 * JavaScript Errors Test
 * Check for JavaScript errors preventing React from loading
 */

const puppeteer = require('puppeteer');

async function testJSErrors() {
  console.log('🔍 Starting JavaScript Errors Test...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  try {
    const page = await browser.newPage();
    
    // Capture all console messages
    page.on('console', msg => {
      console.log(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    });
    
    // Capture page errors
    page.on('pageerror', error => {
      console.log('❌ Page Error:', error.message);
      console.log('Stack:', error.stack);
    });
    
    // Navigate to the main page
    console.log('🌐 Navigating to main page...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if React loaded
    const reactLoaded = await page.evaluate(() => {
      return typeof window.React !== 'undefined';
    });
    
    console.log('React loaded:', reactLoaded);
    
    // Check for any error messages
    const errorElements = await page.$$('.error, .alert-danger, [class*="error"]');
    if (errorElements.length > 0) {
      console.log(`❌ Found ${errorElements.length} error elements`);
      for (let i = 0; i < errorElements.length; i++) {
        const text = await page.evaluate(el => el.textContent, errorElements[i]);
        console.log(`Error ${i + 1}: ${text}`);
      }
    }
    
    console.log('✅ JavaScript errors test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testJSErrors().catch(console.error);
