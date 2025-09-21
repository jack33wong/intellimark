#!/usr/bin/env node

/**
 * Test Favorite Persistence
 * 
 * Tests that favorite status is properly saved to the backend
 * and persists across page refreshes
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const TEST_IMAGE_PATH = path.resolve(__dirname, 'testingdata', 'q19.png');

async function testFavoritePersistence() {
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  
  try {
    console.log('🧪 Testing Favorite Persistence...\n');
    console.log('🚀 Starting favorite persistence test...');

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
      await fileInput.uploadFile('testingdata/q19.png');
      console.log('✅ Image uploaded');
      
      // Wait for processing to complete
      await page.waitForSelector('.chat-container', { timeout: 30000 });
      console.log('✅ Chat container appeared - session created');
    }

    // Wait for favorite button to appear
    await page.waitForSelector('.favorite-btn', { timeout: 10000 });
    console.log('✅ Favorite button found');

    // Check initial favorite status
    const initialFavoriteStatus = await page.evaluate(() => {
      const favoriteBtn = document.querySelector('.favorite-btn');
      return favoriteBtn ? favoriteBtn.classList.contains('favorited') : false;
    });
    console.log('📊 Initial favorite status:', initialFavoriteStatus);

    // Click favorite button
    await page.click('.favorite-btn');
    console.log('✅ Clicked favorite button');

    // Wait a moment for the update to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check console logs for any errors
    const consoleLogs = [];
    page.on('console', msg => {
      consoleLogs.push(`${msg.type().toUpperCase()}: ${msg.text()}`);
    });

    // Check if favorite status changed
    const newFavoriteStatus = await page.evaluate(() => {
      const favoriteBtn = document.querySelector('.favorite-btn');
      return favoriteBtn ? favoriteBtn.classList.contains('favorited') : false;
    });
    console.log('📊 New favorite status:', newFavoriteStatus);

    // Check if SessionHeader is rendered
    const sessionHeaderInfo = await page.evaluate(() => {
      const sessionHeader = document.querySelector('.session-header');
      const favoriteBtn = document.querySelector('.favorite-btn');
      const chatContainer = document.querySelector('.chat-container');
      const uploadMode = document.querySelector('.upload-mode');
      const pageMode = document.querySelector('.mark-homework-page');
      
      // Check for any elements with session-related classes
      const sessionElements = Array.from(document.querySelectorAll('[class*="session"]')).map(el => ({
        className: el.className,
        tagName: el.tagName,
        text: el.textContent.trim().substring(0, 50)
      }));
      
      return {
        sessionHeaderExists: !!sessionHeader,
        favoriteBtnExists: !!favoriteBtn,
        chatContainerExists: !!chatContainer,
        uploadModeExists: !!uploadMode,
        pageModeClass: pageMode ? pageMode.className : 'Not found',
        sessionHeaderHTML: sessionHeader ? sessionHeader.outerHTML.substring(0, 200) + '...' : 'Not found',
        sessionElements,
        allButtons: Array.from(document.querySelectorAll('button')).map(btn => ({
          className: btn.className,
          text: btn.textContent.trim(),
          disabled: btn.disabled
        }))
      };
    });
    console.log('📊 SessionHeader info:', sessionHeaderInfo);
    
    // Check if button is disabled
    const isButtonDisabled = await page.evaluate(() => {
      const favoriteBtn = document.querySelector('.favorite-btn');
      return favoriteBtn ? favoriteBtn.disabled : true;
    });
    console.log('📊 Button disabled:', isButtonDisabled);
    
    // Check if click handler is attached
    const hasClickHandler = await page.evaluate(() => {
      const favoriteBtn = document.querySelector('.favorite-btn');
      if (!favoriteBtn) return false;
      
      // Check if onclick is attached
      const hasOnclick = favoriteBtn.onclick !== null;
      
      // Check if addEventListener was used (harder to detect)
      const hasEventListener = favoriteBtn.addEventListener !== undefined;
      
      return { hasOnclick, hasEventListener, buttonHTML: favoriteBtn.outerHTML };
    });
    console.log('📊 Click handler check:', hasClickHandler);
    
    // Log recent console messages
    console.log('📋 Recent console messages:');
    consoleLogs.slice(-10).forEach(log => console.log('  ', log));

    // Verify the status changed
    if (newFavoriteStatus === !initialFavoriteStatus) {
      console.log('✅ Favorite status toggled successfully');
    } else {
      throw new Error(`Favorite status did not toggle: expected ${!initialFavoriteStatus}, got ${newFavoriteStatus}`);
    }

    // Check console logs for backend update
    page.on('console', msg => {
      if (msg.type() === 'log' && msg.text().includes('Session updated successfully')) {
        consoleLogs.push(msg.text());
      }
    });

    // Wait for backend update confirmation
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Refresh the page to test persistence
    await page.reload({ waitUntil: 'networkidle0' });
    console.log('✅ Page refreshed');

    // Wait for the session to load again
    await page.waitForSelector('.favorite-btn', { timeout: 10000 });
    console.log('✅ Favorite button found after refresh');

    // Check if favorite status persisted
    const persistedFavoriteStatus = await page.evaluate(() => {
      const favoriteBtn = document.querySelector('.favorite-btn');
      return favoriteBtn ? favoriteBtn.classList.contains('favorited') : false;
    });
    console.log('📊 Persisted favorite status:', persistedFavoriteStatus);

    // Verify persistence
    if (persistedFavoriteStatus === newFavoriteStatus) {
      console.log('✅ Favorite status persisted after page refresh');
    } else {
      throw new Error(`Favorite status did not persist: expected ${newFavoriteStatus}, got ${persistedFavoriteStatus}`);
    }

    console.log('🎉 Favorite persistence test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the test
if (require.main === module) {
  testFavoritePersistence().catch(console.error);
}

module.exports = { testFavoritePersistence };
