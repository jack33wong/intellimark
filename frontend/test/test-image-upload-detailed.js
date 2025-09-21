/**
 * Detailed Image Upload Test
 * Test the actual image upload functionality to identify specific problems
 */

const puppeteer = require('puppeteer');

async function testImageUploadDetailed() {
  console.log('🔍 Starting Detailed Image Upload Test...');
  
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
      } else if (msg.text().includes('Image') || msg.text().includes('upload') || msg.text().includes('pageMode')) {
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
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    
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
    
    // Check for any upload buttons
    const uploadButtons = await page.$$('button, [class*="upload"], [class*="Upload"]');
    console.log(`Found ${uploadButtons.length} potential upload elements`);
    
    // Check the page mode
    const pageMode = await page.evaluate(() => {
      // Try to find pageMode in window or component state
      if (window.React && window.React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) {
        return 'React found';
      }
      return 'No React state found';
    });
    console.log('Page mode check:', pageMode);
    
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
    
    // Take a screenshot for debugging
    await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
    console.log('📸 Screenshot saved as debug-screenshot.png');
    
    console.log('✅ Detailed image upload test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testImageUploadDetailed().catch(console.error);
