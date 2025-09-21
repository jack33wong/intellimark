/**
 * Error Capture Test
 * Capture the full React error message
 */

const puppeteer = require('puppeteer');

async function testErrorCapture() {
  console.log('🔍 Starting Error Capture Test...');
  
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
    
    // Navigate to the app
    console.log('🌐 Navigating to app...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Login
    console.log('🔐 Logging in...');
    await page.goto('http://localhost:3000/login');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'admin@intellimark.com');
    await page.type('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    
    // Wait for login to complete
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Navigate to mark homework page
    console.log('📚 Navigating to mark homework page...');
    await page.goto('http://localhost:3000/mark-homework');
    
    // Wait for page to load and capture any errors
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('✅ Error capture test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testErrorCapture().catch(console.error);
