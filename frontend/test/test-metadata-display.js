#!/usr/bin/env node

/**
 * Test Metadata Display
 * 
 * Test that LLM tokens and Mathpix calls are properly displayed in task details
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TEST_IMAGE_PATH = path.resolve(__dirname, 'testingdata', 'q19.png');

async function testMetadataDisplay() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  
  try {
    console.log('🧪 Testing Metadata Display...\n');

    // Navigate to login page
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    console.log('✅ Navigated to login page');

    // Login
    await page.type('input[type="email"]', 'admin@intellimark.com');
    await page.type('input[type="password"]', '123456');
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log('✅ Logged in successfully');

    // Navigate to mark homework page
    await page.goto('http://localhost:3000/mark-homework', { waitUntil: 'networkidle0' });
    console.log('✅ Navigated to mark homework page');

    // Upload an image to create a session
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.uploadFile(TEST_IMAGE_PATH);
      console.log('✅ Image uploaded');
      
      // Wait for processing to complete
      await page.waitForSelector('.chat-container', { timeout: 30000 });
      console.log('✅ Chat container appeared - session created');
    }

    // Wait for task details button to appear
    await page.waitForSelector('.info-btn', { timeout: 10000 });
    console.log('✅ Task details button found');

    // Click on task details button
    await page.click('.info-btn');
    console.log('✅ Clicked task details button');

    // Wait for dropdown to appear
    await page.waitForSelector('.info-dropdown', { timeout: 5000 });
    console.log('✅ Task details dropdown appeared');

    // Check if metadata is displayed
    const metadataInfo = await page.evaluate(() => {
      const dropdown = document.querySelector('.info-dropdown');
      if (!dropdown) return { found: false };

      const llmTokens = dropdown.querySelector('.token-count .value')?.textContent?.trim();
      const mathpixCalls = dropdown.querySelector('.mathpix-count .value')?.textContent?.trim();
      const imageSize = dropdown.querySelector('.image-size .value')?.textContent?.trim();
      const confidence = dropdown.querySelector('.confidence .value')?.textContent?.trim();
      const annotations = dropdown.querySelector('.annotations .value')?.textContent?.trim();

      // Check console logs for debug information
      const consoleLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        consoleLogs.push(args.join(' '));
        originalLog(...args);
      };

      return {
        found: true,
        llmTokens,
        mathpixCalls,
        imageSize,
        confidence,
        annotations,
        allText: dropdown.textContent,
        consoleLogs: consoleLogs.slice(-10) // Get last 10 console logs
      };
    });

    console.log('📊 Metadata display info:', metadataInfo);

    // Verify that metadata is displayed
    if (metadataInfo.found) {
      console.log('✅ Task details dropdown is visible');
      
      if (metadataInfo.llmTokens && metadataInfo.llmTokens !== 'N/A') {
        console.log('✅ LLM Tokens displayed:', metadataInfo.llmTokens);
      } else {
        console.log('⚠️ LLM Tokens not displayed or N/A');
      }
      
      if (metadataInfo.mathpixCalls && metadataInfo.mathpixCalls !== 'N/A') {
        console.log('✅ Mathpix Calls displayed:', metadataInfo.mathpixCalls);
      } else {
        console.log('⚠️ Mathpix Calls not displayed or N/A');
      }
      
      if (metadataInfo.imageSize && metadataInfo.imageSize !== 'N/A') {
        console.log('✅ Image Size displayed:', metadataInfo.imageSize);
      } else {
        console.log('⚠️ Image Size not displayed or N/A');
      }
      
      if (metadataInfo.confidence && metadataInfo.confidence !== 'N/A') {
        console.log('✅ Confidence displayed:', metadataInfo.confidence);
      } else {
        console.log('⚠️ Confidence not displayed or N/A');
      }
      
      if (metadataInfo.annotations && metadataInfo.annotations !== 'N/A') {
        console.log('✅ Annotations displayed:', metadataInfo.annotations);
      } else {
        console.log('⚠️ Annotations not displayed or N/A');
      }
    } else {
      console.log('❌ Task details dropdown not found');
    }

    console.log('🎉 Metadata display test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  testMetadataDisplay().catch(console.error);
}

module.exports = { testMetadataDisplay };
