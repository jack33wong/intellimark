const puppeteer = require('puppeteer-core');

async function testHookDebug() {
  console.log('🧪 Testing Hook Debug...');
  
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Capture console logs
  page.on('console', msg => {
    console.log(`📋 Console: ${msg.text()}`);
  });
  
  // Capture errors
  page.on('pageerror', error => {
    console.error(`❌ Page Error: ${error.message}`);
  });
  
  try {
    console.log('📋 Navigating to http://localhost:3000/mark-homework...');
    await page.goto('http://localhost:3000/mark-homework', { waitUntil: 'networkidle0', timeout: 10000 });
    
    console.log('📋 Waiting for component to load...');
    await page.waitForSelector('.follow-up-chat-input-container', { timeout: 10000 });
    
    console.log('📋 Component loaded, waiting 10 seconds for debug logs...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testHookDebug().catch(console.error);
