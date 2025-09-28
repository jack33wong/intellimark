const { test, expect } = require('@playwright/test');
const path = require('path');
const LoginPage = require('./pages/LoginPage');
const MarkHomeworkPage = require('./pages/MarkHomeworkPage');
const SidebarPage = require('./pages/SidebarPage');

// Test configuration
const TEST_CONFIG = {
  email: 'admin@intellimark.com',
  password: '123456',
  testImages: {
    q19: path.join(__dirname, 'test-data/q19.png'),
    q21: path.join(__dirname, 'test-data/q21.png')
  }
};

test.describe('Smart Scroll-to-Bottom Tests', () => {
  let loginPage, markHomeworkPage, sidebarPage;

  test.beforeEach(async ({ page }) => {
    // Set smaller viewport to ensure scroll bars appear
    await page.setViewportSize({ width: 1200, height: 600 });
    
    loginPage = new LoginPage(page);
    markHomeworkPage = new MarkHomeworkPage(page);
    sidebarPage = new SidebarPage(page);
    
    // Login
    await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
    await markHomeworkPage.navigateToMarkHomework();
    await markHomeworkPage.selectModel('auto');
  });

  test('Smart Scroll Test 1: Scroll to bottom when clicking last message progress toggle', async ({ page }) => {
    await test.step('Setup: Create chat content bigger than viewport', async () => {
      // Upload first image to create initial content
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText('First question about this math problem');
      await markHomeworkPage.sendMessage();
      await markHomeworkPage.waitForAIResponse();
      
      // Upload second image to make content taller
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q21);
      await markHomeworkPage.enterText('Follow-up question about this other problem');
      await markHomeworkPage.sendMessage();
      await markHomeworkPage.waitForAIResponse();
      
      // Verify we have scrollable content
      const chatContainer = page.locator('.chat-messages');
      await expect(chatContainer).toBeVisible();
      
      // Check if scroll bar is present (content is taller than viewport)
      const scrollHeight = await chatContainer.evaluate(el => el.scrollHeight);
      const clientHeight = await chatContainer.evaluate(el => el.clientHeight);
      expect(scrollHeight).toBeGreaterThan(clientHeight);
      console.log(`📏 Content height: ${scrollHeight}px, Viewport height: ${clientHeight}px`);
    });

    await test.step('Test: Click last message progress toggle and verify scroll to bottom', async () => {
      // Scroll to middle first to ensure we're not at bottom
      const chatContainer = page.locator('.chat-messages');
      await chatContainer.evaluate(el => el.scrollTop = el.scrollHeight / 2);
      
      // Get initial scroll position
      const initialScrollTop = await chatContainer.evaluate(el => el.scrollTop);
      console.log(`📍 Initial scroll position: ${initialScrollTop}px`);
      
      // Find the last AI message's progress toggle button
      const lastAIMessage = page.locator('.chat-message.assistant').last();
      const progressToggle = lastAIMessage.locator('.progress-toggle-button');
      
      // Click the progress toggle
      await progressToggle.click();
      
      // Wait for scroll animation to complete
      await page.waitForTimeout(500);
      
      // Verify we scrolled to bottom
      const finalScrollTop = await chatContainer.evaluate(el => el.scrollTop);
      const scrollHeight = await chatContainer.evaluate(el => el.scrollHeight);
      const clientHeight = await chatContainer.evaluate(el => el.clientHeight);
      const maxScrollTop = scrollHeight - clientHeight;
      
      console.log(`📍 Final scroll position: ${finalScrollTop}px, Max scroll: ${maxScrollTop}px`);
      
      // Expected: Should be scrolled to bottom (within 10px tolerance)
      expect(finalScrollTop).toBeGreaterThanOrEqual(maxScrollTop - 10);
    });
  });

  test('Smart Scroll Test 2: No auto-scroll when user is in middle during AI response', async ({ page }) => {
    await test.step('Setup: Create initial content', async () => {
      // Upload first image
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText('First question');
      await markHomeworkPage.sendMessage();
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Test: Scroll to middle and verify no auto-scroll during AI response', async () => {
      // Scroll to middle of chat
      const chatContainer = page.locator('.chat-messages');
      await chatContainer.evaluate(el => el.scrollTop = el.scrollHeight / 2);
      
      const initialScrollTop = await chatContainer.evaluate(el => el.scrollTop);
      console.log(`📍 Initial scroll position (middle): ${initialScrollTop}px`);
      
      // Upload second image (this will trigger AI response)
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q21);
      await markHomeworkPage.enterText('Second question');
      
      // Start the AI response but don't wait for completion yet
      await markHomeworkPage.sendMessage();
      
      // Wait a bit for AI processing to start
      await page.waitForTimeout(2000);
      
      // Check scroll position during AI processing
      const scrollTopDuringProcessing = await chatContainer.evaluate(el => el.scrollTop);
      console.log(`📍 Scroll position during AI processing: ${scrollTopDuringProcessing}px`);
      
      // Expected: Should NOT have auto-scrolled (should be close to initial position)
      const scrollDifference = Math.abs(scrollTopDuringProcessing - initialScrollTop);
      expect(scrollDifference).toBeLessThan(50); // Within 50px of original position
      
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
      
      // Check final scroll position
      const finalScrollTop = await chatContainer.evaluate(el => el.scrollTop);
      console.log(`📍 Final scroll position after AI response: ${finalScrollTop}px`);
      
      // Expected: Should still NOT have auto-scrolled (user was in middle)
      const finalScrollDifference = Math.abs(finalScrollTop - initialScrollTop);
      expect(finalScrollDifference).toBeLessThan(50); // Within 50px of original position
    });
  });

  test('Smart Scroll Test 3: Auto-scroll only when user is near bottom', async ({ page }) => {
    await test.step('Setup: Create initial content', async () => {
      // Upload first image
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText('First question');
      await markHomeworkPage.sendMessage();
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Test: Scroll near bottom and verify auto-scroll happens', async () => {
      const chatContainer = page.locator('.chat-messages');
      
      // Scroll to near bottom (within 100px of bottom)
      const scrollHeight = await chatContainer.evaluate(el => el.scrollHeight);
      const clientHeight = await chatContainer.evaluate(el => el.clientHeight);
      const nearBottomPosition = scrollHeight - clientHeight - 50; // 50px from bottom
      
      await chatContainer.evaluate((el, pos) => el.scrollTop = pos, nearBottomPosition);
      
      const initialScrollTop = await chatContainer.evaluate(el => el.scrollTop);
      console.log(`📍 Initial scroll position (near bottom): ${initialScrollTop}px`);
      
      // Upload second image (this should trigger auto-scroll since we're near bottom)
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q21);
      await markHomeworkPage.enterText('Second question');
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
      
      // Check final scroll position
      const finalScrollTop = await chatContainer.evaluate(el => el.scrollTop);
      const maxScrollTop = scrollHeight - clientHeight;
      
      console.log(`📍 Final scroll position: ${finalScrollTop}px, Max scroll: ${maxScrollTop}px`);
      
      // Expected: Should have auto-scrolled to bottom (within 10px tolerance)
      expect(finalScrollTop).toBeGreaterThanOrEqual(maxScrollTop - 10);
    });
  });
});
