/**
 * Example Test - Basic Authentication and Image Upload
 * 
 * This is a simple example showing how to write tests using the test account.
 * Use this as a template for creating new tests.
 */

const puppeteer = require('puppeteer');

// Test configuration
const TEST_CONFIG = {
  // Test account credentials
  email: 'admin@intellimark.com',
  password: '123456',
  
  // URLs
  loginUrl: 'http://localhost:3000/login',
  markHomeworkUrl: 'http://localhost:3000/mark-homework',
  
  // Test image (should be in project root)
  testImagePath: '/Users/ytwong/github/intellimark/q19.png',
  
  // Timeouts
  pageLoadTimeout: 10000,
  apiTimeout: 30000
};

async function runExampleTest() {
  console.log('🧪 Example Test: Basic Authentication and Image Upload');
  console.log(`📋 Using test account: ${TEST_CONFIG.email} / ${TEST_CONFIG.password}`);
  
  const browser = await puppeteer.launch({ 
    headless: false, // Set to true for headless mode
    defaultViewport: { width: 1280, height: 720 }
  });
  
  const page = await browser.newPage();
  
  // Capture console logs for debugging
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (text.includes('❌') || text.includes('Error')) {
      console.log(`📋 Console: ${text}`);
    }
  });
  
  try {
    // Step 1: Navigate to login page
    console.log('\n📋 Step 1: Navigate to login page');
    await page.goto(TEST_CONFIG.loginUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.email-password-form');
    console.log('✅ Login page loaded');
    
    // Step 2: Sign in
    console.log('\n📋 Step 2: Sign in with test account');
    await page.type('input[name="email"]', TEST_CONFIG.email);
    await page.type('input[name="password"]', TEST_CONFIG.password);
    await page.click('.auth-submit-button');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    console.log('✅ Signed in successfully');
    
    // Step 3: Navigate to mark homework page
    console.log('\n📋 Step 3: Navigate to mark homework page');
    await page.goto(TEST_CONFIG.markHomeworkUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.follow-up-chat-input-container');
    console.log('✅ Mark homework page loaded');
    
    // Step 4: Upload test image
    console.log('\n📋 Step 4: Upload test image');
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(TEST_CONFIG.testImagePath);
      await page.waitForSelector('.followup-preview-image', { timeout: 5000 });
      console.log('✅ Image uploaded and preview displayed');
    } else {
      throw new Error('File input not found');
    }
    
    // Step 5: Click send button
    console.log('\n📋 Step 5: Click send button');
    await page.click('.send-button');
    console.log('✅ Send button clicked');
    
    // Step 6: Wait for processing
    console.log('\n📋 Step 6: Wait for AI processing...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    
    // Step 7: Check for messages
    console.log('\n📋 Step 7: Check for messages');
    const messages = await page.$$('.message');
    console.log(`✅ Found ${messages.length} messages in chat`);
    
    // Step 8: Verify no errors
    const errorLogs = consoleLogs.filter(log => 
      log.includes('❌') || 
      log.includes('Error') || 
      log.includes('Failed')
    );
    
    if (errorLogs.length === 0) {
      console.log('✅ No errors found in console logs');
    } else {
      console.log(`⚠️  Found ${errorLogs.length} errors in console logs:`);
      errorLogs.forEach(log => console.log(`   ${log}`));
    }
    
    console.log('\n🎉 Example test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    // Print helpful debug information
    console.log('\n📋 Debug Information:');
    console.log(`   Current URL: ${page.url()}`);
    console.log(`   Console logs: ${consoleLogs.length} messages`);
    
    if (consoleLogs.length > 0) {
      console.log('   Recent console logs:');
      consoleLogs.slice(-5).forEach(log => console.log(`     ${log}`));
    }
    
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  runExampleTest()
    .then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runExampleTest, TEST_CONFIG };

