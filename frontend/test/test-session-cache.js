#!/usr/bin/env node

/**
 * Test Session Chat Message Cache Problem
 * 
 * Tests for cache issues:
 * - Multiple uploads should not show cached messages
 * - Each new upload should start fresh
 * - Messages should not persist between sessions
 * - File selection should be cleared properly
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TEST_IMAGE_PATH = path.resolve(__dirname, 'testingdata', 'q19.png');

async function testSessionCache() {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  try {
    console.log('🧪 Testing Session Chat Message Cache...\n');

    // Test 1: First upload
    console.log('📋 Test 1: First upload');
    await page.goto(`${BASE_URL}/mark-homework`);
    await page.waitForSelector('.follow-up-chat-input-container', { timeout: 10000 });
    console.log('  ✓ Page loaded successfully');

    // Upload first image
    const fileInput = await page.$('input[type="file"]');
    console.log('  📋 File input found:', !!fileInput);
    
    // Listen for console logs
    page.on('console', msg => {
      if (msg.text().includes('FollowUpChatInput') || msg.text().includes('File selected') || msg.text().includes('Clearing existing session') || msg.text().includes('handleAnalyzeImage')) {
        console.log('  📋 Console:', msg.text());
      }
    });
    
    await fileInput.uploadFile(TEST_IMAGE_PATH);
    console.log('  ✓ First image uploaded');
    
    // Wait a bit for the file change event to process
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Wait for image preview
    try {
      await page.waitForSelector('.followup-image-preview img', { timeout: 5000 });
      console.log('  ✓ First image preview shown');
    } catch (error) {
      console.log('  ❌ Image preview not found, checking what is on the page...');
      
      // Check what elements are actually present
      const elements = await page.evaluate(() => {
        const previews = document.querySelectorAll('.followup-image-preview');
        const images = document.querySelectorAll('img');
        const fileInputs = document.querySelectorAll('input[type="file"]');
        
        return {
          previewCount: previews.length,
          imageCount: images.length,
          fileInputCount: fileInputs.length,
          previewHTML: previews.length > 0 ? previews[0].innerHTML : 'No preview found',
          allImages: Array.from(images).map(img => ({
            src: img.src.substring(0, 50) + '...',
            className: img.className,
            parentClassName: img.parentElement?.className
          }))
        };
      });
      
      console.log('  📋 Page elements:', elements);
      throw error;
    }

    // Click send
    await page.click('.send-button');
    console.log('  ✓ First send button clicked');

    // Wait for first response
    await page.waitForFunction(() => {
      const messages = document.querySelectorAll('.chat-message');
      return messages.length >= 2;
    }, { timeout: 60000 });
    console.log('  ✓ First response received');

    // Check message count after first upload
    const firstUploadMessageCount = await page.evaluate(() => {
      return document.querySelectorAll('.chat-message').length;
    });
    console.log(`  📊 First upload message count: ${firstUploadMessageCount}`);

    if (firstUploadMessageCount !== 2) {
      throw new Error(`Expected exactly 2 messages after first upload, but got ${firstUploadMessageCount}`);
    }
    console.log('  ✅ First upload: Exactly 2 messages');

    // Test 2: Second upload (should not show cached messages)
    console.log('\n📋 Test 2: Second upload (check for cache issues)');
    
    // Upload second image
    await fileInput.uploadFile(TEST_IMAGE_PATH);
    console.log('  ✓ Second image uploaded');

    // Wait for image preview
    await page.waitForSelector('.followup-image-preview img', { timeout: 5000 });
    console.log('  ✓ Second image preview shown');

    // Click send
    const sendButton = await page.$('.send-button');
    const isDisabled = await sendButton.evaluate(btn => btn.disabled);
    console.log(`  📋 Second send button disabled: ${isDisabled}`);
    
    await page.click('.send-button');
    console.log('  ✓ Second send button clicked');

    // Wait for second response
    try {
      await page.waitForFunction(() => {
        const messages = document.querySelectorAll('.chat-message');
        return messages.length >= 4; // Should have 4 messages total (2 from first + 2 from second)
      }, { timeout: 30000 }); // Reduced timeout to 30 seconds
      console.log('  ✓ Second response received');
    } catch (error) {
      console.log('  ❌ Second response timeout, checking current message count...');
      
      const currentMessageCount = await page.evaluate(() => {
        return document.querySelectorAll('.chat-message').length;
      });
      
      console.log(`  📊 Current message count: ${currentMessageCount}`);
      
      if (currentMessageCount >= 4) {
        console.log('  ✅ Second response actually received (4+ messages)');
      } else {
        throw error;
      }
    }

    // Check message count after second upload
    const secondUploadMessageCount = await page.evaluate(() => {
      return document.querySelectorAll('.chat-message').length;
    });
    console.log(`  📊 Second upload message count: ${secondUploadMessageCount}`);

    if (secondUploadMessageCount !== 4) {
      throw new Error(`Expected exactly 4 messages after second upload, but got ${secondUploadMessageCount}`);
    }
    console.log('  ✅ Second upload: Exactly 4 messages (2 + 2)');

    // Test 3: Check for duplicate messages
    console.log('\n📋 Test 3: Check for duplicate messages');
    
    const messageContents = await page.evaluate(() => {
      const messages = document.querySelectorAll('.chat-message');
      return Array.from(messages).map((msg, index) => {
        const text = msg.textContent.trim();
        const hasImage = !!msg.querySelector('img');
        const isUser = msg.classList.contains('user');
        const isAssistant = msg.classList.contains('assistant');
        return {
          index,
          text: text.substring(0, 50) + '...',
          hasImage,
          isUser,
          isAssistant
        };
      });
    });

    console.log('  📋 All messages:', messageContents);

    // Check for duplicate user messages
    const userMessages = messageContents.filter(m => m.isUser);
    const assistantMessages = messageContents.filter(m => m.isAssistant);

    if (userMessages.length !== 2) {
      throw new Error(`Expected exactly 2 user messages, but got ${userMessages.length}`);
    }
    if (assistantMessages.length !== 2) {
      throw new Error(`Expected exactly 2 assistant messages, but got ${assistantMessages.length}`);
    }

    console.log('  ✅ No duplicate messages found');

    // Test 4: Check file selection is cleared
    console.log('\n📋 Test 4: Check file selection is cleared');
    
    // Check if file input is cleared
    const fileInputValue = await page.evaluate(() => {
      const fileInput = document.querySelector('input[type="file"]');
      return fileInput ? fileInput.value : null;
    });

    if (fileInputValue) {
      console.log('  ❌ File input not cleared - cache issue detected');
      throw new Error('File input should be cleared after upload');
    } else {
      console.log('  ✅ File input is cleared');
    }

    // Test 5: Check if send button is enabled for next upload
    console.log('\n📋 Test 5: Check send button state');
    
    const sendButtonDisabled = await page.evaluate(() => {
      const sendButton = document.querySelector('.send-button');
      return sendButton ? sendButton.disabled : true;
    });

    if (sendButtonDisabled) {
      console.log('  ❌ Send button is disabled - cache issue detected');
      throw new Error('Send button should be enabled for next upload');
    } else {
      console.log('  ✅ Send button is enabled for next upload');
    }

    console.log('\n✅ Session Cache Test PASSED!');
    console.log('📊 Summary:');
    console.log('  - First upload: 2 messages ✅');
    console.log('  - Second upload: 4 messages total ✅');
    console.log('  - No duplicate messages ✅');
    console.log('  - File input cleared ✅');
    console.log('  - Send button enabled ✅');

  } catch (error) {
    console.error('❌ Session Cache Test FAILED:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

testSessionCache().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
