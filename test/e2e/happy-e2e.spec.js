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
  userId: 'AaNZbPkBPzRqZN2tnHEmZhj1YI13',
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

test.describe('Happy Path E2E Tests', () => {
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
    markHomeworkPage = new MarkHomeworkPage(page, 'HappyPathE2E');
    sidebarPage = new SidebarPage(page);
    
    // Monitor network requests for debugging
    page.on('request', request => {
      // API request logged
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
      
      // Assert that the user's content appeared correctly
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.initial)).toBeVisible();
      
      // Verify 1st user uploaded image has base64 source (from chat session memory)
      await markHomeworkPage.verifyUserImagesHaveBase64Sources(1);
    });

    await test.step('Step 3: Verify First AI Response and UI Updates', async () => {
      // This step will be completed after progress step verification in Step 3.1
      // The AI response verification is now handled in Step 3.1 after progress steps
      
      // Wait for sidebar to load
      await sidebarPage.waitForLoad();
    });

    await test.step('Step 3.1: Verify Marking Mode Progress Steps (First Image)', async () => {
      // Verify progress steps DURING processing (not after completion)
      // Wait for progress toggle to appear first
      await expect(markHomeworkPage.page.locator('.progress-toggle-button').first()).toBeVisible({ timeout: 15000 });
      
      // Verify the first image upload (q19.png) shows marking mode progress steps
      await markHomeworkPage.verifyProgressSteps({
        mode: 'marking',
        expectedSteps: [
          'Analyzing image...',
          'Classifying image...',
          'Detecting question type...',
          'Extracting text and math...',
          'Generating feedback...',
          'Creating annotations...',
          'Generating response...'
        ],
        expectedStepCount: 7
      });

      // Verify progress toggle functionality
      await markHomeworkPage.verifyProgressToggle({
        shouldBeVisible: true,
        shouldExpandSteps: true,
        shouldCollapseSteps: true
      });
      
      // Now wait for AI response to complete
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
      
      // Verify follow-up user message
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.followUp)).toBeVisible();
      
      // Verify 2nd user uploaded image has base64 source (from chat session memory)
      await markHomeworkPage.verifyUserImagesHaveBase64Sources(2);
    });

    await test.step('Step 4.1: Verify Question Mode Progress Steps (Second Image)', async () => {
      // Verify progress steps DURING processing (not after completion)
      // Wait for progress toggle to appear first
      await expect(markHomeworkPage.page.locator('.progress-toggle-button').first()).toBeVisible({ timeout: 15000 });
      
      // Verify the second image upload (q21.png) shows question mode progress steps
      await markHomeworkPage.verifyProgressSteps({
        mode: 'question',
        expectedSteps: [
          'Analyzing image...',
          'Classifying image...',
          'Generating response...'
        ],
        expectedStepCount: 3
      });

      // Verify progress toggle functionality
      await markHomeworkPage.verifyProgressToggle({
        shouldBeVisible: true,
        shouldExpandSteps: true,
        shouldCollapseSteps: true
      });
      
      // Now wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
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
      
      // Wait for AI response to complete using improved wait logic
      await markHomeworkPage.waitForAIResponse();
      
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
      
      // Real verification: AI response must contain "4" and be about math addition
      expect(renderedText).toContain('4');
      expect(renderedText).toContain('2 + 2 = 4'); // More specific check for the math problem
      expect(renderedText).not.toContain('sequence');
      expect(renderedText).not.toContain('follow-up');
      expect(renderedText).not.toContain('linear');
      
      // Verify no image in the AI response (text-only mode)
      const aiResponseImages = lastAIMessage.locator('img');
      await expect(aiResponseImages).toHaveCount(0);
    });

    await test.step('Step 5.1: Verify Text Mode Progress Steps', async () => {
      // Verify progress steps DURING processing (not after completion)
      // Wait for progress toggle to appear first
      await expect(markHomeworkPage.page.locator('.progress-toggle-button').first()).toBeVisible({ timeout: 15000 });
      
      // Verify the text-only message shows text mode progress steps
      await markHomeworkPage.verifyProgressSteps({
        mode: 'text',
        expectedSteps: [
          'AI is thinking...',
          'Generating response...'
        ],
        expectedStepCount: 2
      });

      // Verify step completion indicators (all steps should be completed for text mode)
      await markHomeworkPage.verifyStepCompletionIndicators({
        completedSteps: ['✓', '✓'], // Both steps completed
        currentStep: 1
      });
      
      // Now wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Step 6: Verify Third AI Response and Database', async () => {
      // Wait for network to be idle to ensure all API calls are complete
      await page.waitForLoadState('networkidle');
      
      // Wait for session creation and database writes to complete
      const session = await databaseHelper.waitForSessionCreation(TEST_CONFIG.userId);
      
      // Use auto-retrying expect instead of hardcoded timeouts
      await expect(async () => {
        const messageCount = await databaseHelper.getMessageCount(session.id);
        expect(messageCount).toBe(6);
      }).toPass({ timeout: 60000 });
    });

    await test.step('Step 6.1: Verify All Progress Steps in Chat History', async () => {
      // Click on the chat history item to load the conversation from database
      await sidebarPage.clickChatHistoryItem(0);
      
      // Wait for the chat to load from database and messages to be visible
      await markHomeworkPage.waitForPageLoad();
      
      // Wait for all messages to be visible
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.initial)).toBeVisible({ timeout: 10000 });
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.followUp)).toBeVisible({ timeout: 10000 });
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.textOnly)).toBeVisible({ timeout: 10000 });
      await expect(markHomeworkPage.aiMessages).toHaveCount(3, { timeout: 10000 });
      
      // Verify progress steps are preserved in chat history for all three AI messages
      const aiMessages = markHomeworkPage.aiMessages;
      
      // Check first AI message (marking mode) - should have progress steps
      const firstAIMessage = aiMessages.nth(0);
      await expect(firstAIMessage.locator('.progress-toggle-button')).toBeVisible({ timeout: 5000 });
      
      // Check second AI message (question mode) - should have progress steps  
      const secondAIMessage = aiMessages.nth(1);
      await expect(secondAIMessage.locator('.progress-toggle-button')).toBeVisible({ timeout: 5000 });
      
      // Check third AI message (text mode) - should have progress steps
      const thirdAIMessage = aiMessages.nth(2);
      await expect(thirdAIMessage.locator('.progress-toggle-button')).toBeVisible({ timeout: 5000 });
      
      console.log('✅ All AI messages have progress steps preserved in chat history');
    });

    await test.step('Step 7: Test Chat History Navigation and Image Sources', async () => {
      // Note: Chat history is already loaded from previous step
      
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

    await test.step('Step 8: Logout and Test Unauthenticated Mode', async () => {
      // Navigate back to upload mode to show the main header with profile button
      await page.goto('http://localhost:3000/mark-homework');
      await expect(page).toHaveURL(/.*mark-homework/);
      
      // Wait for React app to load and render
      await page.waitForLoadState('networkidle');
      await page.waitForSelector('#root', { timeout: 10000 });
      await expect(page.locator('.profile-button')).toBeVisible({ timeout: 10000 });
      
      // Now logout from authenticated session
      await loginPage.logout();
      
      // Verify logout was successful
      await markHomeworkPage.verifyUnauthenticatedMode();
      
      // Navigate back to mark-homework page
      await markHomeworkPage.navigateToMarkHomework();
      await expect(page).toHaveURL(/.*mark-homework/);
      
      // Select Auto model for testing
      await markHomeworkPage.selectModel('auto');
      console.log('🤖 Using Auto (Gemini 2.0 Flash-Lite) for unauthenticated e2e testing');
    });

    await test.step('Step 9: Submit Initial Homework (Marking Mode - Unauthenticated)', async () => {
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q19);
      await markHomeworkPage.enterText(TEST_CONFIG.testTexts.initial);
      await markHomeworkPage.sendMessage();
      
      // Assert that the user's content appeared correctly
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.initial)).toBeVisible();
      
      // Note: We'll verify user images are base64 in Step 12
    });

    await test.step('Step 9.1: Wait for AI Response (First Image - Unauthenticated)', async () => {
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Step 10: Submit Follow-up Question (Question Mode - Unauthenticated)', async () => {
      await markHomeworkPage.uploadImage(TEST_CONFIG.testImages.q21);
      await markHomeworkPage.enterText(TEST_CONFIG.testTexts.followUp);
      await markHomeworkPage.sendMessage();
      
      // Verify follow-up user message
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.followUp)).toBeVisible();
      
      // Note: AI annotated images may still use storage URLs in unauthenticated mode
      // We'll verify user images specifically in Step 12
    });

    await test.step('Step 10.1: Wait for AI Response (Second Image - Unauthenticated)', async () => {
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Step 11: Text-Only Follow-up Mode (Unauthenticated)', async () => {
      // Clear any file input that might be selected from previous steps
      await page.evaluate(() => {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach(input => {
          input.value = '';
        });
      });
      
      await markHomeworkPage.enterText(TEST_CONFIG.testTexts.textOnly);
      await markHomeworkPage.sendMessage();
      
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
      
      // Wait for AI response to complete using improved wait logic
      await markHomeworkPage.waitForAIResponse();
      
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
      
      // Real verification: AI response must contain "4" and be about math addition
      expect(renderedText).toContain('4');
      expect(renderedText).toContain('2 + 2 = 4'); // More specific check for the math problem
      expect(renderedText).not.toContain('sequence');
      expect(renderedText).not.toContain('follow-up');
      expect(renderedText).not.toContain('linear');
      
      // Verify no image in the AI response (text-only mode)
      const aiResponseImages = lastAIMessage.locator('img');
      await expect(aiResponseImages).toHaveCount(0);
    });

    await test.step('Step 11.1: Wait for AI Response (Text Mode - Unauthenticated)', async () => {
      // Wait for AI response to complete
      await markHomeworkPage.waitForAIResponse();
    });

    await test.step('Step 12: Verify Unauthenticated Mode Characteristics', async () => {
      // Quick verification of total message count is 6
      const totalMessages = await page.locator('.chat-message').count();
      expect(totalMessages).toBe(6);
      
      // Note: In unauthenticated mode, the sidebar might still show previous chat history
      // This is expected behavior as the sidebar doesn't automatically clear on logout
      const chatHistoryItems = await page.locator('.mark-history-item').count();
      console.log(`ℹ️  Chat history items found: ${chatHistoryItems} (may include previous authenticated session)`);
      
      // Quick verification that user images have base64 sources
      const userImages = page.locator('.chat-message.user img');
      const userImageCount = await userImages.count();
      expect(userImageCount).toBe(2); // 2 user uploaded images
      
      // Verify user images have base64 sources
      for (let i = 0; i < userImageCount; i++) {
        const userImage = userImages.nth(i);
        if (await userImage.isVisible()) {
          const src = await userImage.getAttribute('src');
          expect(src).toMatch(/^data:image/);
        }
      }
      
      console.log('✅ Unauthenticated mode verified: 6 messages, user images are base64');
    });

    await test.step('Step 13: Verify No Database Persistence', async () => {
      // Quick verification that refreshing the page loses all messages (no persistence)
      await page.reload();
      await markHomeworkPage.waitForPageLoad();
      
      // After refresh, there should be no messages in the chat
      const messagesAfterRefresh = await page.locator('.chat-message').count();
      expect(messagesAfterRefresh).toBe(0);
      
      console.log('✅ No database persistence verified: messages lost on refresh');
    });
  });
});
