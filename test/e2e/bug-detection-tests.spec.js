const { test, expect } = require('@playwright/test');
const path = require('path');
const LoginPage = require('./pages/LoginPage');
const MarkHomeworkPage = require('./pages/MarkHomeworkPage');
const SidebarPage = require('./pages/SidebarPage');
const DatabaseHelper = require('./utils/DatabaseHelper');

// Test configuration
const TEST_CONFIG = {
  email: 'admin@intellimark.com',
  password: '123456',
  userId: 'GdH3EGZ4mLQrBO5w20seIzbqVKv1',
  testImages: {
    q19: path.join(__dirname, 'test-data/q19.png'),
  },
  testTexts: {
    textOnly: 'what is 2 + 2?'
  }
};

test.describe('Bug Detection E2E Tests', () => {
  let loginPage, markHomeworkPage, sidebarPage, databaseHelper;

  test.beforeAll(async () => {
    databaseHelper = new DatabaseHelper();
    await databaseHelper.connectToFirestore();
    await databaseHelper.cleanupUnifiedSessions(TEST_CONFIG.userId);
  });

  test.afterAll(async () => {
    await databaseHelper.close();
  });
  
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await databaseHelper.cleanupUnifiedSessions(TEST_CONFIG.userId);
    
    loginPage = new LoginPage(page);
    markHomeworkPage = new MarkHomeworkPage(page);
    sidebarPage = new SidebarPage(page);
  });

  test('Ghost Message Bug Detection - Text-only submission should not create duplicate assistant messages', { timeout: 120000 }, async ({ page }) => {
    
    await test.step('Step 1: Login and Navigate', async () => {
      await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
      await markHomeworkPage.navigateToMarkHomework();
      await expect(page).toHaveURL(/.*mark-homework/);
      await markHomeworkPage.selectModel('auto');
    });

    await test.step('Step 2: Submit Text-Only Message', async () => {
      // Clear any file input that might be selected
      await page.evaluate(() => {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
          input.value = '';
        });
      });
      
      await markHomeworkPage.enterText(TEST_CONFIG.testTexts.textOnly);
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Step 3: Verify No Ghost Messages', async () => {
      // Count all assistant messages - should be exactly 1
      const assistantMessages = await page.locator('.chat-message.assistant').count();
      expect(assistantMessages).toBe(1);
      
      // Count all messages - should be exactly 2 (1 user + 1 assistant)
      const allMessages = await page.locator('.chat-message').count();
      expect(allMessages).toBe(2);
      
      // Verify no duplicate assistant messages by checking content
      const assistantMessageTexts = await page.locator('.chat-message.assistant .chat-message-content').allTextContents();
      const uniqueTexts = [...new Set(assistantMessageTexts)];
      expect(uniqueTexts.length).toBe(1);
      
      console.log(`✅ Ghost Message Test: Found ${assistantMessages} assistant messages (expected 1)`);
      console.log(`✅ Ghost Message Test: Found ${allMessages} total messages (expected 2)`);
    });
  });

  test('Auto-Closing Dropdown Bug Detection - Dropdown should stay open during AI responses', { timeout: 120000 }, async ({ page }) => {
    
    await test.step('Step 1: Login and Navigate', async () => {
      await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
      await markHomeworkPage.navigateToMarkHomework();
      await expect(page).toHaveURL(/.*mark-homework/);
      await markHomeworkPage.selectModel('auto');
    });

    await test.step('Step 2: Create a Session with Messages', async () => {
      // Upload an image to create a session
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText('Test message for dropdown bug detection');
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Step 3: Open Dropdown and Test Persistence', async () => {
      // Look for task details button (SessionManagement component)
      const taskDetailsButton = page.locator('button:has-text("Task Details")').or(page.locator('[data-testid="task-details-button"]'));
      
      // If no task details button, skip this test (no session management visible)
      const buttonExists = await taskDetailsButton.count() > 0;
      if (!buttonExists) {
        console.log('⚠️  Dropdown test skipped: No Task Details button found (SessionManagement not rendered)');
        return;
      }
      
      // Click to open dropdown
      await taskDetailsButton.click();
      
      // Verify dropdown content is visible
      const dropdownContent = page.locator('.dropdown-content, [data-testid="dropdown-content"]');
      await expect(dropdownContent).toBeVisible();
      
      console.log('✅ Dropdown opened successfully');
    });

    await test.step('Step 4: Send Message While Dropdown is Open', async () => {
      // Send another message while dropdown is open
      await markHomeworkPage.enterText('Another test message');
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response
      await markHomeworkPage.waitForAIResponse();
      
      // Verify dropdown is still accessible (not auto-closed)
      const taskDetailsButton = page.locator('button:has-text("Task Details")').or(page.locator('[data-testid="task-details-button"]'));
      await expect(taskDetailsButton).toBeVisible();
      
      // Verify dropdown content is still visible
      const dropdownContent = page.locator('.dropdown-content, [data-testid="dropdown-content"]');
      await expect(dropdownContent).toBeVisible();
      
      console.log('✅ Dropdown remained open during AI response');
    });

    await test.step('Step 5: Test Rapid Interactions', async () => {
      // Test rapid clicking on dropdown button
      const taskDetailsButton = page.locator('button:has-text("Task Details")').or(page.locator('[data-testid="task-details-button"]'));
      
      // Rapid clicks
      await taskDetailsButton.click();
      await taskDetailsButton.click();
      await taskDetailsButton.click();
      
      // Verify button is still functional
      await expect(taskDetailsButton).toBeVisible();
      
      // Send another message
      await markHomeworkPage.enterText('Rapid interaction test');
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response
      await markHomeworkPage.waitForAIResponse();
      
      // Verify dropdown is still accessible
      await expect(taskDetailsButton).toBeVisible();
      
      console.log('✅ Dropdown survived rapid interactions and AI responses');
    });
  });

  test('Message Count Validation - Enhanced validation to catch ghost messages', { timeout: 120000 }, async ({ page }) => {
    
    await test.step('Step 1: Login and Navigate', async () => {
      await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
      await markHomeworkPage.navigateToMarkHomework();
      await expect(page).toHaveURL(/.*mark-homework/);
      await markHomeworkPage.selectModel('auto');
    });

    await test.step('Step 2: Submit Multiple Messages and Validate Counts', async () => {
      const messages = [
        'First message',
        'Second message', 
        'Third message'
      ];
      
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        
        // Clear file input
        await page.evaluate(() => {
          const fileInputs = document.querySelectorAll('input[type="file"]');
          fileInputs.forEach(input => {
            input.value = '';
          });
        });
        
        await markHomeworkPage.enterText(message);
        await markHomeworkPage.sendMessage();
        
        // Wait for AI response
        await markHomeworkPage.waitForAIResponse();
        
        // Validate message count after each interaction
        const expectedUserMessages = i + 1;
        const expectedAIMessages = i + 1;
        const expectedTotalMessages = (i + 1) * 2;
        
        const actualUserMessages = await page.locator('.chat-message.user').count();
        const actualAIMessages = await page.locator('.chat-message.assistant').count();
        const actualTotalMessages = await page.locator('.chat-message').count();
        
        expect(actualUserMessages).toBe(expectedUserMessages);
        expect(actualAIMessages).toBe(expectedAIMessages);
        expect(actualTotalMessages).toBe(expectedTotalMessages);
        
        console.log(`✅ Message ${i + 1}: ${actualUserMessages} user, ${actualAIMessages} AI, ${actualTotalMessages} total`);
      }
    });

    await test.step('Step 3: Final Validation - No Ghost Messages', async () => {
      // Final count validation
      const userMessages = await page.locator('.chat-message.user').count();
      const aiMessages = await page.locator('.chat-message.assistant').count();
      const totalMessages = await page.locator('.chat-message').count();
      
      expect(userMessages).toBe(3);
      expect(aiMessages).toBe(3);
      expect(totalMessages).toBe(6);
      
      // Verify no duplicate content
      const aiMessageTexts = await page.locator('.chat-message.assistant .chat-message-content').allTextContents();
      const uniqueAITexts = [...new Set(aiMessageTexts)];
      expect(uniqueAITexts.length).toBe(aiMessages);
      
      console.log(`✅ Final validation: ${userMessages} user, ${aiMessages} AI, ${totalMessages} total messages`);
      console.log(`✅ No duplicate AI messages found`);
    });
  });
});
