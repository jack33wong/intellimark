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
  expectedMessageCount: 4,
  expectedChatTitle: 'AQA GCSE Mathematics 8300/2H - Q19'
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
      }
    });
    
    page.on('response', response => {
      if (response.url().includes('/api/')) {
        console.log(`📡 API Response: ${response.status()} ${response.url()}`);
      }
    });
  });

  test('Complete marking homework flow with database verification', { timeout: 120000 }, async ({ page }) => {

    await test.step('Step 1: Login and Navigate', async () => {
      await loginPage.login(TEST_CONFIG.email, TEST_CONFIG.password);
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
    });

    await test.step('Step 3: Verify First AI Response and UI Updates', async () => {
      // This complex check is now a clean, single call to a Page Object method
      await markHomeworkPage.verifyAIResponseHasAnnotatedImage();

      await expect(markHomeworkPage.getChatHeaderTitleLocator()).toContainText('AQA GCSE Mathematics');
      
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
    });

    await test.step('Step 5: Verify Database and Final UI State', async () => {
      // Verify the second AI response also has an annotated image
      await markHomeworkPage.verifyAIResponseHasAnnotatedImage({ responseIndex: 1 });

      const session = await databaseHelper.waitForSessionCreation(TEST_CONFIG.userId);
      await expect(async () => {
        const messageCount = await databaseHelper.getMessageCount(session.id);
        expect(messageCount).toBe(TEST_CONFIG.expectedMessageCount);
      }).toPass({ timeout: 15000 }); // Poll the DB until the condition is met
    });
  });
});
