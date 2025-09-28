const { test, expect } = require('@playwright/test');

test.describe('Text-Only Auto-Scroll Tests', () => {
  test('Text-Only Auto-Scroll Test: Verify text-only submissions auto-scroll to bottom', async ({ page }) => {
    await test.step('Setup: Login and navigate to mark-homework page', async () => {
      // Navigate to the mark-homework page
      await page.goto('http://localhost:3000/mark-homework');
      
      // Wait for the page to load
      await page.waitForLoadState('networkidle');
      
      // Check if we need to login
      const loginButton = page.locator('button:has-text("Login")');
      if (await loginButton.isVisible()) {
        await loginButton.click();
        await page.waitForSelector('input[type="email"]');
        await page.fill('input[type="email"]', 'test@intellimark.com');
        await page.fill('input[type="password"]', '123456');
        await page.click('button[type="submit"]');
        await page.waitForLoadState('networkidle');
      }
      
      console.log('✅ Login successful - authentication token stored');
    });

    await test.step('Setup: Create initial content to make page scrollable', async () => {
      // Send a few text messages to create scrollable content
      const chatInput = page.locator('.main-chat-input');
      
      // Send first text message
      await chatInput.fill('First question to create content');
      await page.locator('button:has-text("Send")').click();
      await page.waitForSelector('.chat-message', { timeout: 10000 });
      
      // Send second text message
      await chatInput.fill('Second question to create more content');
      await page.locator('button:has-text("Send")').click();
      await page.waitForSelector('.chat-message', { timeout: 10000 });
      
      // Send third text message
      await chatInput.fill('Third question to create even more content');
      await page.locator('button:has-text("Send")').click();
      await page.waitForSelector('.chat-message', { timeout: 10000 });
      
      console.log('📝 Initial text messages sent to create scrollable content');
    });

    await test.step('Test: Send text-only message and verify auto-scroll', async () => {
      // Scroll to middle of the page first
      const chatContainer = page.locator('.chat-messages');
      await chatContainer.evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2;
      });
      
      // Get initial scroll position (should be in middle)
      const initialScrollTop = await chatContainer.evaluate((el) => el.scrollTop);
      console.log(`📍 Initial scroll position (middle): ${initialScrollTop}px`);
      
      // Enter text in the chat input
      const chatInput = page.locator('.main-chat-input');
      await chatInput.fill('What is 2 + 2?');
      console.log('📝 Text entered: "What is 2 + 2?"');
      
      // Click send button
      const sendButton = page.locator('button:has-text("Send")');
      await sendButton.click();
      console.log('🖱️ Send button clicked');
      
      // Wait for AI response
      await page.waitForSelector('.chat-message:has-text("What is 2 + 2?")', { timeout: 10000 });
      await page.waitForSelector('.chat-message .assistant-header', { timeout: 10000 });
      
      // Wait a bit for auto-scroll to complete
      await page.waitForTimeout(1000);
      
      // Get final scroll position
      const finalScrollTop = await chatContainer.evaluate((el) => el.scrollTop);
      const maxScrollTop = await chatContainer.evaluate((el) => el.scrollHeight - el.clientHeight);
      
      console.log(`📍 Final scroll position: ${finalScrollTop}px, Max scroll: ${maxScrollTop}px`);
      
      // Expected: Should be scrolled to bottom (within 50px tolerance)
      expect(finalScrollTop).toBeGreaterThanOrEqual(maxScrollTop - 50);
    });
  });
});
