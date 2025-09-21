/**
 * Simple Image Upload Test
 * Test the actual image upload functionality
 */

const puppeteer = require('puppeteer');

async function testSimpleUpload() {
  console.log('🔍 Starting Simple Upload Test...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  try {
    const page = await browser.newPage();
    
    // Enable console logging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Console Error:', msg.text());
      } else if (msg.text().includes('pageMode') || msg.text().includes('upload')) {
        console.log('📸 Log:', msg.text());
      }
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
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check what elements are actually on the page
    console.log('🔍 Checking page content...');
    console.log('Page title:', await page.title());
    
    // Check for upload mode elements
    const uploadModeElements = await page.$$('.upload-mode, .upload-main-content, .title-upload-btn');
    console.log(`Found ${uploadModeElements.length} upload mode elements`);
    
    // Check for chat mode elements
    const chatModeElements = await page.$$('.chat-mode, .chat-container, .chat-messages');
    console.log(`Found ${chatModeElements.length} chat mode elements`);
    
    // Look for specific text content
    const pageText = await page.evaluate(() => document.body.textContent);
    if (pageText.includes('intellimark')) {
      console.log('✅ Found intellimark text');
    } else {
      console.log('❌ intellimark text not found');
    }
    
    if (pageText.includes('Upload')) {
      console.log('✅ Found Upload text');
    } else {
      console.log('❌ Upload text not found');
    }
    
    // Check for any error messages
    const errorElements = await page.$$('.error, .alert-danger, [class*="error"]');
    if (errorElements.length > 0) {
      console.log(`❌ Found ${errorElements.length} error elements`);
      for (let i = 0; i < errorElements.length; i++) {
        const text = await page.evaluate(el => el.textContent, errorElements[i]);
        console.log(`Error ${i + 1}: ${text}`);
      }
    }
    
    console.log('✅ Simple upload test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testSimpleUpload().catch(console.error);
