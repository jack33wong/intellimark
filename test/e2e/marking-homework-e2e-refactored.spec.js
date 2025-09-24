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
    followUp: 'Can you help e2e with this follow up?'
  },
  expectedMessageCount: 4
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
    loginPage = new LoginPage(page);
    markHomeworkPage = new MarkHomeworkPage(page);
    sidebarPage = new SidebarPage(page);
    
    // Monitor network requests for debugging
    page.on('request', request => {
      if (request.url().includes('/api/')) {
        console.log(`🌐 API Request: ${request.method()} ${request.url()}`);
        
        // Log request body for debug mode verification
        if (request.url().includes('/api/mark-homework/process-single')) {
          const data = request.postData();
          if (data) {
            try {
              const body = JSON.parse(data);
              if (body.debug) {
                console.log('🔧 Debug mode detected in API request');
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        }
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        console.log(`📡 API Response: ${response.status()} ${response.url()}`);
        
        // Log response body for debug mode verification
        if (response.url().includes('/api/mark-homework/process-single')) {
          response.text().then(text => {
            try {
              const body = JSON.parse(text);
              console.log('🔧 API Response body:', JSON.stringify(body, null, 2));
            } catch (e) {
              console.log('🔧 API Response text:', text.substring(0, 500));
            }
          });
        }
      }
    });
  });

  test('Complete marking homework flow with database verification', { timeout: 120000 }, async ({ page }) => {

    await test.step('Step 1: Login and Navigate', async () => {
      await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
      
      // Enable debug mode for API testing
      await page.evaluate(() => {
        localStorage.setItem('debugMode', 'true');
      });
      console.log('🔧 Debug mode enabled for API testing');
      
      await markHomeworkPage.navigateToMarkHomework();
      await expect(page).toHaveURL(/.*mark-homework/);
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
      // This complex check is now a clean, single call to a Page Object method
      await markHomeworkPage.verifyAIResponseHasAnnotatedImage();

      // Check that chat header title is meaningful (length > 10) and not "Processing"
      await expect(async () => {
        const titleText = await markHomeworkPage.getChatHeaderTitleLocator().textContent();
        expect(titleText.length).toBeGreaterThan(10);
        expect(titleText).not.toContain('Processing');
      }).toPass({ timeout: 10000 });
      
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

    await test.step('Step 5: Verify Database and Final UI State', async () => {
      // Both initial and follow-up API calls are working perfectly with debug mode!
      // The follow-up flow is functioning as expected
      
      const session = await databaseHelper.waitForSessionCreation(TEST_CONFIG.userId);
      await expect(async () => {
        const messageCount = await databaseHelper.getMessageCount(session.id);
        // Expect 4 messages: 2 user messages + 2 AI responses (both initial and follow-up working!)
        expect(messageCount).toBe(4);
      }).toPass({ timeout: 15000 }); // Poll the DB until the condition is met
    });

    await test.step('Step 6: Test Chat History Navigation and Image Sources', async () => {
      // Click on the chat history item to load the conversation from database
      await sidebarPage.clickChatHistoryItem(0);
      
      // Wait for the chat to load from database and messages to be visible
      await markHomeworkPage.waitForPageLoad();
      
      // Wait for user messages to be visible (they should load first)
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.initial)).toBeVisible({ timeout: 10000 });
      await expect(markHomeworkPage.getUserMessageLocator(TEST_CONFIG.testTexts.followUp)).toBeVisible({ timeout: 10000 });
      
      // Wait for AI messages to be visible
      await expect(markHomeworkPage.aiMessages).toHaveCount(2, { timeout: 10000 });
      
      // Wait for all images to load
      await markHomeworkPage.waitForImageToLoad();
      
      // Verify that images load from appropriate sources (AI from storage, user may be base64)
      await markHomeworkPage.verifyAllImagesFromDatabaseStorage();
      
      console.log('✅ Chat history navigation verified - images load from appropriate sources');
    });
  });
});
