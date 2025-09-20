const puppeteer = require('puppeteer-core');

async function testDebugPage() {
  console.log('🧪 Testing Debug Page Load...');
  
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
    
    console.log('📋 Waiting for root element...');
    await page.waitForSelector('#root', { timeout: 5000 });
    
    console.log('📋 Checking if MarkHomeworkPageConsolidated is loaded...');
    const content = await page.content();
    console.log('📋 Page content length:', content.length);
    
    // Check for specific elements
    const hasFollowUpChatInput = await page.$('.follow-up-chat-input-container');
    console.log('📋 Has follow-up chat input:', !!hasFollowUpChatInput);
    
    const hasMainLayout = await page.$('.main-layout');
    console.log('📋 Has main layout:', !!hasMainLayout);
    
    // Wait a bit more to see if component loads
    console.log('📋 Waiting 5 seconds for component to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const hasFollowUpChatInputAfter = await page.$('.follow-up-chat-input-container');
    console.log('📋 Has follow-up chat input after wait:', !!hasFollowUpChatInputAfter);
    
    // Check what's actually in the root
    const rootContent = await page.$eval('#root', el => el.innerHTML);
    console.log('📋 Root content length:', rootContent.length);
    console.log('📋 Root content preview:', rootContent.substring(0, 500));
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await browser.close();
  }
}

testDebugPage().catch(console.error);
