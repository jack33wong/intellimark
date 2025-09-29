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
    q21: path.join(__dirname, 'test-data/q21.png')
  },
  testTexts: {
    initial: 'Can you help e2e with this math problem',
    followUp: 'Can you help e2e with this follow up?',
    textOnly: 'what is 2 + 2?'
  },
  expectedMessageCount: 6
};

test.describe('Authenticated User Marking Homework E2E', () => {
  let loginPage, markHomeworkPage, sidebarPage, databaseHelper;

  // Use test.beforeAll for one-time setup
  test.beforeAll(async () => {
    databaseHelper = new DatabaseHelper();
    await databaseHelper.connectToFirestore();
    // Clean up any stray sessions before the suite begins
    await databaseHelper.cleanupUnifiedSessions(TEST_CONFIG.userId);
  });

  test.afterAll(async () => {
    await databaseHelper.close();
  });
  
  // Use beforeEach to initialize pages for each test
  test.beforeEach(async ({ page }) => {
    // Set larger viewport for better screenshots (test-only change)
    await page.setViewportSize({ width: 5120, height: 2880 });
    
    loginPage = new LoginPage(page);
    markHomeworkPage = new MarkHomeworkPage(page);
    sidebarPage = new SidebarPage(page);
    
    // Monitor network requests for debugging
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`🌐 API Request: ${request.method()} ${request.url()}`);
        if (request.url().includes('/api/mark-homework/') || request.url().includes('/api/messages/')) {
          console.log(`🔍 Request Body: ${request.postData()}`);
        }
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        console.log(`📡 API Response: ${response.status()} ${response.url()}`);
      }
    });
  });

  test('Complete marking homework flow with database verification', { timeout: 300000 }, async ({ page }) => {

    await test.step('Step 1: Login and Navigate', async () => {
      await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
      
      await markHomeworkPage.navigateToMarkHomework();
      await expect(page).toHaveURL(/.*mark-homework/);
      
      // Select Auto model for testing (maps to gemini-2.0-flash-lite)
      await markHomeworkPage.selectModel('auto');
      console.log('🤖 Using Auto (Gemini 2.0 Flash-Lite) for e2e testing');
    });

    await test.step('Step 2: Submit Initial Homework', async () => {
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText(TEST_CONFIG.testTexts.initial);
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response to complete first
      await markHomeworkPage.waitForAIResponse();
      
      // Assert that the user's content appeared correctly
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.initial)).toBeVisible();
      
      // Verify 1st user uploaded image has base64 source (from chat session memory)
      await markHomeworkPage.verifyUserImagesHaveBase64Sources(1);
    });

    await test.step('Step 3: Verify First AI Response and UI Updates', async () => {
      // Wait for the actual AI response to complete (not just "thinking" placeholder)
      await markHomeworkPage.waitForAIResponse();
      
      // This complex check is now a clean, single call to a Page Object method
      await markHomeworkPage.verifyAIResponseHasAnnotatedImage();

      // Check that chat header title is meaningful (length > 10) and not "Processing"
      // Give more time for the AI response to complete and title to be generated
      await expect(async () => {
        const titleText = await markHomeworkPage.getChatHeaderTitleLocator().textContent();
        expect(titleText.length).toBeGreaterThan(10);
        expect(titleText).not.toContain('Processing');
      }).toPass({ timeout: 120000 }); // Increased to 2 minutes
      
      // Wait for sidebar to load and update with the new chat history item
      await sidebarPage.waitForLoad();
      await expect(sidebarPage.getChatHistoryItemLocator()).toHaveCount(1, { timeout: 10000 });
    });

    await test.step('Step 4: Submit Follow-up Question', async () => {
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q21);
      await markHomeworkPage.enterText(TEST_CONFIG.testTexts.followUp);
      await markHomeworkPage.sendMessage();
      
      // Wait for AI response to complete first
      await markHomeworkPage.waitForAIResponse();
      
      // Verify follow-up user message
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.followUp)).toBeVisible();
      
      // Verify 2nd user uploaded image has base64 source (from chat session memory)
      await markHomeworkPage.verifyUserImagesHaveBase64Sources(2);
    });

    await test.step('Step 5: Text-Only Follow-up Mode', async () => {
      // Clear any file input that might be selected from previous steps
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
      
      // Verify text-only user message
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.textOnly)).toBeVisible();
      
      // Wait for AI response to contain "4" specifically in the rendered HTML
      await expect(async () => {
        const aiMessages = markHomeworkPage.aiMessages;
        const lastAIMessage = aiMessages.last();
        await expect(lastAIMessage).toBeVisible();
        
        // Check for the markdown renderer structure
        const markdownRenderer = lastAIMessage.locator('.markdown-math-renderer.chat-message-renderer');
        const hasMarkdownRenderer = await markdownRenderer.count() > 0;
        
        if (!hasMarkdownRenderer) {
          console.log('⏳ Waiting for markdown renderer to appear...');
          throw new Error('Markdown renderer not found - verification failed');
        }
        
        // Get the text content from the markdown renderer ONLY
        const renderedText = await markdownRenderer.textContent();
        console.log(`🔍 Rendered AI Response: "${renderedText}"`);
        
        // Check if it contains "4" in the rendered content
        if (!renderedText.includes('4')) {
          throw new Error(`AI response does not contain "4" - got: "${renderedText}"`);
        }
        
        console.log('✅ AI response contains "4" - verification passed');
        return true;
      }).toPass({ timeout: 120000 }); // 2 minutes to wait for AI to respond with "4"
      
      // Verify no image in the AI response (text-only mode)
      const aiMessages = markHomeworkPage.aiMessages;
      const lastAIMessage = aiMessages.last();
      const aiResponseImages = lastAIMessage.locator('img');
      await expect(aiResponseImages).toHaveCount(0);
      
      console.log('✅ Text-only mode verified - AI response contains "4" and has no image');
    });

    await test.step('Step 6: Verify Third AI Response and Database', async () => {
      // Wait for the third AI response to complete first
      await markHomeworkPage.waitForAIResponse();
      
      // Wait for network to be idle to ensure all API calls are complete
      await page.waitForLoadState('networkidle');
      
      // Additional delay to ensure database writes are complete
      await page.waitForTimeout(3000);
      
      const session = await databaseHelper.waitForSessionCreation(TEST_CONFIG.userId);
      
      // Add a longer delay to ensure all messages are written to database
      // The third API call needs time to complete and save to database
      await page.waitForTimeout(5000);
      
      await expect(async () => {
        const messageCount = await databaseHelper.getMessageCount(session.id);
        // Expect 6 messages: 3 user messages + 3 AI responses (initial, follow-up, and text-only)
        expect(messageCount).toBe(6);
      }).toPass({ timeout: 60000 }); // Increased timeout to 60 seconds
      
      console.log('✅ Database verification complete - 6 messages saved');
    });

    await test.step('Step 7: Test Chat History Navigation and Image Sources', async () => {
      // Click on the chat history item to load the conversation from database
      await sidebarPage.clickChatHistoryItem(0);
      
      // Wait for the chat to load from database and messages to be visible
      await markHomeworkPage.waitForPageLoad();
      
      // Wait for user messages to be visible (they should load first)
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.initial)).toBeVisible({ timeout: 10000 });
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.followUp)).toBeVisible({ timeout: 10000 });
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.textOnly)).toBeVisible({ timeout: 10000 });
      
      // Wait for AI messages to be visible
      await expect(markHomeworkPage.aiMessages).toHaveCount(3, { timeout: 10000 });
      
      // Verify message order: User → AI → User → AI → User → AI
      await markHomeworkPage.verifyMessageOrder([
        { type: 'user', text: TEST_CONFIG.testTexts.initial },
        { type: 'ai' },
        { type: 'user', text: TEST_CONFIG.testTexts.followUp },
        { type: 'ai' },
        { type: 'user', text: TEST_CONFIG.testTexts.textOnly },
        { type: 'ai' }
      ]);
      
      // Wait for all images to load
      await markHomeworkPage.waitForImageToLoad();
      
      // Verify that images load from appropriate sources (AI from storage, user may be base64)
      await markHomeworkPage.verifyAllImagesFromDatabaseStorage();
      
      // Capture full page screenshot
      await markHomeworkPage.captureFullPageScreenshot('step7-full-page.jpg');
      
      console.log('✅ Chat history navigation verified - 6 messages in correct order with appropriate image sources');
    });
  });
});
