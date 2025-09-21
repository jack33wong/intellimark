/**
 * Main Page Test
 * Test the main page to see if image upload is working
 */

const puppeteer = require('puppeteer');

async function testMainPage() {
  console.log('🔍 Starting Main Page Test...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  
  try {
    const page = await browser.newPage();
    
    // Capture all console messages
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ Console Error:', msg.text());
      } else if (msg.text().includes('pageMode') || msg.text().includes('upload')) {
        console.log('📸 Log:', msg.text());
      }
    });
    
    // Navigate to the main page
    console.log('🌐 Navigating to main page...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    
    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check what elements are actually on the page
    console.log('🔍 Checking page content...');
    console.log('Page title:', await page.title());
    
    // Look for specific text content
    const pageText = await page.evaluate(() => document.body.textContent);
    console.log('Page text preview:', pageText.substring(0, 200));
    
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
    
    console.log('✅ Main page test completed');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testMainPage().catch(console.error);
