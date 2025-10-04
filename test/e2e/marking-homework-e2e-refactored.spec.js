const { test, expect } = require('@playwright/test');
const path = require('path');
const LoginPage = require('./pages/LoginPage');
const MarkHomeworkPage = require('./pages/MarkHomeworkPage');
const SidebarPage = require('./pages/SidebarPage');
const DatabaseHelper = require('./utils/DatabaseHelper');

// Test configuration - Happy Path E2E Tests
const TEST_CONFIG = {
  email: 'happye2e@intellimark.com',
  password: '123456',
  userId: 'happye2e-user-id', // Will be updated after login
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

test.describe('Happy Path E2E Tests - Marking Homework', () => {
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
    
    // Clean up any leftover sessions before each test
    await databaseHelper.cleanupUnifiedSessions(TEST_CONFIG.userId);
    
    loginPage = new LoginPage(page);
    markHomeworkPage = new MarkHomeworkPage(page);
    sidebarPage = new SidebarPage(page);
    
    // Monitor network requests for debugging
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`🌐 API Request: ${request.method()} ${request.url()}`);
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
      
      // Get the actual user ID after login
      const actualUserId = await loginPage.getUserId();
      if (actualUserId) {
        TEST_CONFIG.userId = actualUserId;
        console.log(`✅ Using user ID: ${actualUserId}`);
      } else {
        console.warn('⚠️ Could not get user ID, using fallback');
      }
      
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
      
      // Wait for the sidebar to have exactly 1 item, with retries
      await expect(async () => {
        const count = await sidebarPage.getChatHistoryItemLocator().count();
        if (count !== 1) {
          throw new Error(`Expected 1 chat history item, but found ${count}. This might be due to leftover test data.`);
        }
        return true;
      }).toPass({ timeout: 15000 });
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
      
      // Wait for 6 messages total (3 user + 3 AI responses)
      await expect(async () => {
        const allMessages = await page.locator('.chat-message').count();
        if (allMessages < 6) {
          throw new Error(`Expected 6 messages, got ${allMessages}`);
        }
        return true;
      }).toPass({ timeout: 120000 });
      
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
      
      // Wait for the AI message to finish processing and have actual content
      let processingComplete = false;
      let attempts = 0;
      const maxAttempts = 60; // 2 minutes with 2-second intervals
      
      while (!processingComplete && attempts < maxAttempts) {
        attempts++;
        const aiMessages = markHomeworkPage.aiMessages;
        const lastAIMessage = aiMessages.last();
        
        // Find the last visible AI message instead of just the last one
        let lastVisibleAIMessage = null;
        const aiMessageCount = await aiMessages.count();
        if (aiMessageCount > 0) {
          for (let i = aiMessageCount - 1; i >= 0; i--) {
            const msg = aiMessages.nth(i);
            const msgId = await msg.getAttribute('data-message-id');
            const isVisible = await msg.isVisible();
            
            if (isVisible && msgId && !lastVisibleAIMessage) {
              lastVisibleAIMessage = msg;
            }
          }
        }
        
        // Use the last visible message, or fall back to the last message
        const messageToCheck = lastVisibleAIMessage || lastAIMessage;
        const html = await messageToCheck.innerHTML();
        
        // Check that processing is complete AND we have actual content
        const isProcessingComplete = !html.includes('Processing...') && !html.includes('thinking-dots');
        const hasContent = html.includes('markdown-math-renderer') || 
                          html.includes('Step') || 
                          html.includes('answer') ||
                          html.includes('katex') ||
                          html.includes('The answer is');
        
        
        if (isProcessingComplete && hasContent) {
          processingComplete = true;
        } else {
          // Wait 2 seconds before next check
          await page.waitForTimeout(2000);
        }
      }
      
      if (!processingComplete) {
        throw new Error('AI response processing did not complete within expected time');
      }
      
      // Verify the AI response contains "4" and is about the math question
      const aiMessages = markHomeworkPage.aiMessages;
      const lastAIMessage = aiMessages.last();
      
      // Find the last visible AI message
      let lastVisibleAIMessage = null;
      const aiMessageCount = await aiMessages.count();
      if (aiMessageCount > 0) {
        for (let i = aiMessageCount - 1; i >= 0; i--) {
          const msg = aiMessages.nth(i);
          const isVisible = await msg.isVisible();
          if (isVisible && !lastVisibleAIMessage) {
            lastVisibleAIMessage = msg;
            break;
          }
        }
      }
      
      const messageToCheck = lastVisibleAIMessage || lastAIMessage;
      await expect(messageToCheck).toBeVisible();
      
      // Wait for the markdown renderer to appear after processing is complete
      const markdownRenderer = messageToCheck.locator('.markdown-math-renderer.chat-message-renderer');
      await expect(markdownRenderer).toBeVisible({ timeout: 30000 });
      
      // Wait for the content to be fully rendered (not just empty)
      await expect(async () => {
        const renderedText = await markdownRenderer.textContent();
        return renderedText && renderedText.trim().length > 0;
      }).toPass({ timeout: 15000 });
      
      const renderedText = await markdownRenderer.textContent();
      
      // Real verification: AI response must contain "4" and be about math, not sequences
      expect(renderedText).toContain('4');
      expect(renderedText).not.toContain('sequence');
      expect(renderedText).not.toContain('follow-up');
      expect(renderedText).not.toContain('linear');
      
      // Verify no image in the AI response (text-only mode)
      const aiResponseImages = lastAIMessage.locator('img');
      await expect(aiResponseImages).toHaveCount(0);
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
        expect(messageCount).toBe(6);
      }).toPass({ timeout: 60000 });
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
    });
  });
});
