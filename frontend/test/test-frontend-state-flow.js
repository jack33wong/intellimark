/**
 * Frontend State Flow Test
 * 
 * Tests the actual React component state transitions
 * Verifies the complete user flow works correctly
 */

const puppeteer = require('puppeteer');
const path = require('path');

// Test configuration
const FRONTEND_URL = 'http://localhost:3000/mark-homework';
const TEST_IMAGE_PATH = path.join(__dirname, 'testingdata/q19.png');

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Wait for element to appear
 */
async function waitForElement(page, selector, timeout = 5000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    console.error(`❌ Element not found: ${selector}`);
    return false;
  }
}

/**
 * Get element text content
 */
async function getElementText(page, selector) {
  try {
    const element = await page.$(selector);
    if (!element) return null;
    return await page.evaluate(el => el.textContent, element);
  } catch (error) {
    console.error(`❌ Failed to get text for: ${selector}`);
    return null;
  }
}

/**
 * Check if element exists
 */
async function elementExists(page, selector) {
  try {
    const element = await page.$(selector);
    return element !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Get console logs
 */
async function getConsoleLogs(page) {
  return await page.evaluate(() => {
    return window.consoleLogs || [];
  });
}

// ============================================================================
// STATE FLOW TESTS
// ============================================================================

/**
 * Test 1: Initial State
 */
async function testInitialState(page) {
  console.log('🧪 Test 1: Initial State');
  
  try {
    // Check if upload area is visible
    const uploadAreaVisible = await elementExists(page, '[data-testid="upload-area"]');
    if (!uploadAreaVisible) {
      throw new Error('Upload area not visible in initial state');
    }
    
    // Check if chat area is hidden
    const chatAreaVisible = await elementExists(page, '[data-testid="chat-area"]');
    if (chatAreaVisible) {
      throw new Error('Chat area should be hidden in initial state');
    }
    
    // Check if send button is enabled
    const sendButton = await page.$('[data-testid="send-button"]');
    if (!sendButton) {
      throw new Error('Send button not found');
    }
    
    const isDisabled = await page.evaluate(el => el.disabled, sendButton);
    if (isDisabled) {
      throw new Error('Send button should be enabled in initial state');
    }
    
    console.log('✅ Initial state correct');
    return true;
  } catch (error) {
    console.error('❌ Initial state test failed:', error.message);
    return false;
  }
}

/**
 * Test 2: Upload State
 */
async function testUploadState(page) {
  console.log('🧪 Test 2: Upload State');
  
  try {
    // Upload image file
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
      throw new Error('File input not found');
    }
    
    await fileInput.uploadFile(TEST_IMAGE_PATH);
    console.log('📁 Image uploaded');
    
    // Wait for preview to appear
    const previewVisible = await waitForElement(page, '[data-testid="image-preview"]', 3000);
    if (!previewVisible) {
      throw new Error('Image preview not shown');
    }
    
    console.log('✅ Upload state correct');
    return true;
  } catch (error) {
    console.error('❌ Upload state test failed:', error.message);
    return false;
  }
}

/**
 * Test 3: Processing State
 */
async function testProcessingState(page) {
  console.log('🧪 Test 3: Processing State');
  
  try {
    // Click send button
    const sendButton = await page.$('[data-testid="send-button"]');
    if (!sendButton) {
      throw new Error('Send button not found');
    }
    
    await sendButton.click();
    console.log('🔄 Send button clicked');
    
    // Wait for spinner to appear
    const spinnerVisible = await waitForElement(page, '[data-testid="spinner"]', 2000);
    if (!spinnerVisible) {
      throw new Error('Spinner not shown after clicking send');
    }
    
    // Check if send button is disabled
    const isDisabled = await page.evaluate(el => el.disabled, sendButton);
    if (!isDisabled) {
      throw new Error('Send button should be disabled during processing');
    }
    
    console.log('✅ Processing state correct');
    return true;
  } catch (error) {
    console.error('❌ Processing state test failed:', error.message);
    return false;
  }
}

/**
 * Test 4: User Message State
 */
async function testUserMessageState(page) {
  console.log('🧪 Test 4: User Message State');
  
  try {
    // Wait for user message to appear
    const userMessageVisible = await waitForElement(page, '[data-testid="user-message"]', 10000);
    if (!userMessageVisible) {
      throw new Error('User message not shown');
    }
    
    // Check if image is displayed
    const imageVisible = await elementExists(page, '[data-testid="user-message"] img');
    if (!imageVisible) {
      throw new Error('User message image not shown');
    }
    
    console.log('✅ User message state correct');
    return true;
  } catch (error) {
    console.error('❌ User message state test failed:', error.message);
    return false;
  }
}

/**
 * Test 5: AI Thinking State
 */
async function testAIThinkingState(page) {
  console.log('🧪 Test 5: AI Thinking State');
  
  try {
    // Wait for AI thinking animation
    const aiThinkingVisible = await waitForElement(page, '[data-testid="ai-thinking"]', 5000);
    if (!aiThinkingVisible) {
      throw new Error('AI thinking animation not shown');
    }
    
    console.log('✅ AI thinking state correct');
    return true;
  } catch (error) {
    console.error('❌ AI thinking state test failed:', error.message);
    return false;
  }
}

/**
 * Test 6: Complete State
 */
async function testCompleteState(page) {
  console.log('🧪 Test 6: Complete State');
  
  try {
    // Wait for AI response
    const aiMessageVisible = await waitForElement(page, '[data-testid="ai-message"]', 15000);
    if (!aiMessageVisible) {
      throw new Error('AI message not shown');
    }
    
    // Check if upload area moved to bottom
    const uploadAreaAtBottom = await page.evaluate(() => {
      const uploadArea = document.querySelector('[data-testid="upload-area"]');
      if (!uploadArea) return false;
      const rect = uploadArea.getBoundingClientRect();
      return rect.bottom > window.innerHeight * 0.7; // Should be in bottom half
    });
    
    if (!uploadAreaAtBottom) {
      throw new Error('Upload area did not move to bottom');
    }
    
    // Check if send button is enabled again
    const sendButton = await page.$('[data-testid="send-button"]');
    const isDisabled = await page.evaluate(el => el.disabled, sendButton);
    if (isDisabled) {
      throw new Error('Send button should be enabled after completion');
    }
    
    console.log('✅ Complete state correct');
    return true;
  } catch (error) {
    console.error('❌ Complete state test failed:', error.message);
    return false;
  }
}

// ============================================================================
// MAIN TEST
// ============================================================================

async function runFrontendTest() {
  console.log('🧪 Starting Frontend State Flow Test');
  console.log('🌐 Frontend URL:', FRONTEND_URL);
  console.log('📁 Test image:', TEST_IMAGE_PATH);
  console.log('─'.repeat(80));
  
  let browser;
  let page;
  
  try {
    // Launch browser
    console.log('\n🚀 Launching browser...');
    browser = await puppeteer.launch({ 
      headless: false, // Set to true for CI
      devtools: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    page = await browser.newPage();
    
    // Capture console logs
    await page.evaluateOnNewDocument(() => {
      window.consoleLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        window.consoleLogs.push(args.join(' '));
        originalLog.apply(console, args);
      };
    });
    
    // Navigate to page
    console.log('🌐 Navigating to frontend...');
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle0' });
    
    // Wait for page to load
    await page.waitForTimeout(2000);
    
    // Run tests
    const tests = [
      testInitialState,
      testUploadState,
      testProcessingState,
      testUserMessageState,
      testAIThinkingState,
      testCompleteState
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
      try {
        const result = await test(page);
        if (result) {
          passed++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error('❌ Test error:', error.message);
        failed++;
      }
      
      // Small delay between tests
      await page.waitForTimeout(1000);
    }
    
    // Final results
    console.log('\n📊 TEST RESULTS:');
    console.log('─'.repeat(40));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
    
    if (failed === 0) {
      console.log('\n🎉 ALL FRONTEND TESTS PASSED!');
      console.log('✅ State flow is working correctly');
      console.log('✅ Ready for user testing');
    } else {
      console.log('\n❌ SOME TESTS FAILED');
      console.log('🔧 Check the errors above and fix before proceeding');
    }
    
    // Show console logs for debugging
    const consoleLogs = await getConsoleLogs(page);
    if (consoleLogs.length > 0) {
      console.log('\n📝 Console Logs:');
      console.log('─'.repeat(40));
      consoleLogs.slice(-10).forEach(log => console.log(log)); // Show last 10 logs
    }
    
  } catch (error) {
    console.error('\n❌ TEST SETUP FAILED:', error);
    console.log('\n🔧 Debugging steps:');
    console.log('  1. Check if frontend is running: curl http://localhost:3000');
    console.log('  2. Check if backend is running: curl http://localhost:5001/api/mark-homework/health');
    console.log('  3. Check browser console for errors');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
runFrontendTest();
