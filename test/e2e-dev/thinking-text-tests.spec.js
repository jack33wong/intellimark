const { test, expect } = require('@playwright/test');
const path = require('path');
const LoginPage = require('./pages/LoginPage');
const MarkHomeworkPage = require('./pages/MarkHomeworkPage');

// Test configuration
const TEST_CONFIG = {
  email: 'admin@intellimark.com',
  password: '123456',
  testImages: {
    q19: path.join(__dirname, 'test-data/q19.png'),
    q21: path.join(__dirname, 'test-data/q21.png')
  }
};

test.describe('Thinking Text Update Tests', () => {
  let loginPage, markHomeworkPage;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    
    loginPage = new LoginPage(page);
    markHomeworkPage = new MarkHomeworkPage(page);
    
    // Login
    await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
    await markHomeworkPage.navigateToMarkHomework();
    await markHomeworkPage.selectModel('auto');
  });

  test('Thinking Text Test 1: Verify thinking text updates progressively during image processing', async ({ page }) => {
    await test.step('Setup: Start image upload', async () => {
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText('Can you help me with this math problem?');
    });

    await test.step('Test: Verify thinking text updates step by step', async () => {
      // Start the AI processing
      await markHomeworkPage.sendMessage();
      
      // Wait for AI thinking indicator to appear
      const thinkingIndicator = page.locator('.thinking-indicator');
      await expect(thinkingIndicator).toBeVisible();
      
      const thinkingText = page.locator('.thinking-text');
      
      // Expected thinking text steps for marking mode:
      const expectedSteps = [
        'Analyzing image...',
        'Detecting question type...',
        'Extracting text and math...',
        'Generating feedback...',
        'Creating annotations...',
        'Finalizing response...',
        'Almost done...'
      ];
      
      // Track which steps we've seen
      const seenSteps = new Set();
      
      // Monitor thinking text changes for up to 90 seconds
      const startTime = Date.now();
      const timeout = 90000; // 90 seconds
      
      while (Date.now() - startTime < timeout) {
        const currentText = await thinkingText.textContent();
        
        if (currentText && currentText.trim() !== '') {
          console.log(`🧠 Current thinking text: "${currentText}"`);
          
          // Check if this matches any expected step
          const matchedStep = expectedSteps.find(step => 
            currentText.includes(step) || step.includes(currentText)
          );
          
          if (matchedStep && !seenSteps.has(matchedStep)) {
            seenSteps.add(matchedStep);
            console.log(`✅ Found step: ${matchedStep}`);
          }
        }
        
        // Check if AI response is complete
        const aiResponse = page.locator('.chat-message.assistant .chat-message-renderer');
        if (await aiResponse.isVisible()) {
          console.log('🎉 AI response completed');
          break;
        }
        
        // Wait a bit before checking again
        await page.waitForTimeout(500);
      }
      
      // Expected: Should have seen at least 3 different thinking steps
      expect(seenSteps.size).toBeGreaterThanOrEqual(3);
      console.log(`📊 Total unique steps seen: ${seenSteps.size}`);
      console.log(`📋 Steps seen: ${Array.from(seenSteps).join(', ')}`);
    });

    await test.step('Verify: Final state shows "Show thinking"', async () => {
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
      
      // Wait for "Almost done..." step if it appears, then wait for "Show thinking"
      const thinkingText = page.locator('.thinking-text');
      
      // First wait for "Almost done..." if it appears (with timeout)
      try {
        await thinkingText.waitFor({ state: 'visible', timeout: 2000 });
        const currentText = await thinkingText.textContent();
        if (currentText && currentText.includes('Almost done...')) {
          console.log('⏳ Waiting for "Almost done..." step to complete...');
          await thinkingText.waitFor({ 
            state: 'visible', 
            timeout: 10000 
          });
        }
      } catch (e) {
        // "Almost done..." might not appear, that's okay
        console.log('ℹ️ "Almost done..." step not detected, continuing...');
      }
      
      // Now wait for "Show thinking" with longer timeout
      await thinkingText.waitFor({ 
        state: 'visible', 
        timeout: 15000 
      });
      
      // Wait a bit more to ensure the final state is stable
      await page.waitForTimeout(1000);
      
      const finalText = await thinkingText.textContent();
      console.log(`🎯 Final thinking text: "${finalText}"`);
      
      // Expected: Should show "Show thinking" when completed
      expect(finalText).toContain('Show thinking');
    });
  });

  test('Thinking Text Test 2: Verify thinking text updates for text-only submissions', async ({ page }) => {
    await test.step('Setup: Send text-only message', async () => {
      await markHomeworkPage.enterText('What is 2 + 2?');
    });

    await test.step('Test: Verify thinking text updates for text mode', async () => {
      // Start the AI processing
      await markHomeworkPage.sendMessage();
      
      // Wait for AI thinking indicator to appear
      const thinkingIndicator = page.locator('.thinking-indicator');
      await expect(thinkingIndicator).toBeVisible();
      
      const thinkingText = page.locator('.thinking-text');
      
      // Expected thinking text steps for text mode:
      const expectedSteps = [
        'Processing your question...',
        'Generating response...'
      ];
      
      // Track which steps we've seen
      const seenSteps = new Set();
      
      // Monitor thinking text changes for up to 15 seconds
      const startTime = Date.now();
      const timeout = 15000; // 15 seconds
      
      while (Date.now() - startTime < timeout) {
        const currentText = await thinkingText.textContent();
        
        if (currentText && currentText.trim() !== '') {
          console.log(`🧠 Current thinking text: "${currentText}"`);
          
          // Check if this matches any expected step
          const matchedStep = expectedSteps.find(step => 
            currentText.includes(step) || step.includes(currentText)
          );
          
          if (matchedStep && !seenSteps.has(matchedStep)) {
            seenSteps.add(matchedStep);
            console.log(`✅ Found step: ${matchedStep}`);
          }
        }
        
        // Check if AI response is complete
        const aiResponse = page.locator('.chat-message.assistant .chat-message-renderer');
        if (await aiResponse.isVisible()) {
          console.log('🎉 AI response completed');
          break;
        }
        
        // Wait a bit before checking again
        await page.waitForTimeout(500);
      }
      
      // Expected: Should have seen at least 1 thinking step
      expect(seenSteps.size).toBeGreaterThanOrEqual(1);
      console.log(`📊 Total unique steps seen: ${seenSteps.size}`);
      console.log(`📋 Steps seen: ${Array.from(seenSteps).join(', ')}`);
    });

    await test.step('Verify: Final state shows "Show thinking"', async () => {
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
      
      // Wait for "Almost done..." step if it appears, then wait for "Show thinking"
      const thinkingText = page.locator('.thinking-text');
      
      // First wait for "Almost done..." if it appears (with timeout)
      try {
        await thinkingText.waitFor({ state: 'visible', timeout: 2000 });
        const currentText = await thinkingText.textContent();
        if (currentText && currentText.includes('Almost done...')) {
          console.log('⏳ Waiting for "Almost done..." step to complete...');
          await thinkingText.waitFor({ 
            state: 'visible', 
            timeout: 10000 
          });
        }
      } catch (e) {
        // "Almost done..." might not appear, that's okay
        console.log('ℹ️ "Almost done..." step not detected, continuing...');
      }
      
      // Now wait for "Show thinking" with longer timeout
      await thinkingText.waitFor({ 
        state: 'visible', 
        timeout: 15000 
      });
      
      // Wait a bit more to ensure the final state is stable
      await page.waitForTimeout(1000);
      
      const finalText = await thinkingText.textContent();
      console.log(`🎯 Final thinking text: "${finalText}"`);
      
      // Expected: Should show "Show thinking" when completed
      expect(finalText).toContain('Show thinking');
    });
  });

  test('Thinking Text Test 3: Verify thinking text shows current step description', async ({ page }) => {
    await test.step('Setup: Start image upload', async () => {
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText('Help me solve this problem');
    });

    await test.step('Test: Verify thinking text shows specific step descriptions', async () => {
      // Start the AI processing
      await markHomeworkPage.sendMessage();
      
      // Wait for AI thinking indicator to appear
      const thinkingIndicator = page.locator('.thinking-indicator');
      await expect(thinkingIndicator).toBeVisible();
      
      const thinkingText = page.locator('.thinking-text');
      
      // Expected: Should show specific step descriptions, not generic "Processing..."
      const genericTexts = ['Processing...', 'AI is thinking...', 'Thinking...'];
      
      let foundSpecificStep = false;
      const startTime = Date.now();
      const timeout = 20000; // 20 seconds
      
      while (Date.now() - startTime < timeout) {
        const currentText = await thinkingText.textContent();
        
        if (currentText && currentText.trim() !== '') {
          console.log(`🧠 Current thinking text: "${currentText}"`);
          
          // Check if it's NOT a generic text
          const isGeneric = genericTexts.some(generic => 
            currentText.includes(generic) || generic.includes(currentText)
          );
          
          if (!isGeneric && currentText.length > 10) {
            foundSpecificStep = true;
            console.log(`✅ Found specific step: "${currentText}"`);
            break;
          }
        }
        
        // Check if AI response is complete
        const aiResponse = page.locator('.chat-message.assistant .chat-message-renderer');
        if (await aiResponse.isVisible()) {
          break;
        }
        
        await page.waitForTimeout(500);
      }
      
      // Expected: Should have found at least one specific step description
      expect(foundSpecificStep).toBe(true);
    });
  });
});
