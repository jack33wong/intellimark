/**
 * Debug Image Upload Test
 * Test the actual image upload functionality to identify specific problems
 */

const puppeteer = require('puppeteer');

async function testImageUpload() {
  console.log('🔍 Starting Image Upload Debug Test...');
  
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
      } else if (msg.text().includes('Image') || msg.text().includes('upload')) {
        console.log('📸 Image Log:', msg.text());
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
    
    // Wait a bit and check what's on the page
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check what elements are actually on the page
    console.log('🔍 Checking page content...');
    const pageContent = await page.content();
    console.log('Page title:', await page.title());
    
    // Look for any upload-related elements
    const uploadElements = await page.$$('[class*="upload"], [class*="Upload"], input[type="file"]');
    console.log(`Found ${uploadElements.length} upload-related elements`);
    
    // Check for main content area
    const mainContent = await page.$('.main-content, .upload-main-content, .mark-homework-page');
    if (mainContent) {
      console.log('✅ Main content area found');
    } else {
      console.log('❌ Main content area NOT found');
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
    
    // Check console for any errors
    console.log('🔍 Checking for JavaScript errors...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('✅ Image upload debug test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testImageUpload().catch(console.error);