const { test, expect } = require('@playwright/test');
const { MarkHomeworkPage } = require('./pages/MarkHomeworkPage');
const { TestData } = require('./utils/TestData');

test.describe('Unauthenticated User Flow Tests', () => {
  let markHomeworkPage;

  test.beforeEach(async ({ page }) => {
    markHomeworkPage = new MarkHomeworkPage(page);
    await markHomeworkPage.navigateToMarkHomework();
    // No login for unauthenticated tests
  });

  test.describe('Marking Mode Tests', () => {
    test('U001: First-time marking with image + text (Unauthenticated)', async ({ page }) => {
      await test.step('Upload image with text', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q21);
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
      });

      await test.step('Verify progress steps', async () => {
        for (const step of TestData.progressSteps.marking) {
          await markHomeworkPage.waitForProgressStep(step);
        }
      });

      await test.step('Verify final state', async () => {
        await markHomeworkPage.waitForThinkingComplete('marking');
        await markHomeworkPage.verifyAnnotatedImage();
        await markHomeworkPage.verifyAIResponse();
        
      });
    });

    test('U002: Follow-up marking with image + text (Unauthenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q21);
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
        await markHomeworkPage.waitForThinkingComplete('marking');
        
        // Add a small delay to ensure step 1 is fully complete
        await page.waitForTimeout(2000);
        console.log('✅ Step 1 fully completed, proceeding to step 2');
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q19);
        
        // Capture screenshot before trying to send text (to see input state)
        await page.screenshot({ path: 'test-results/U002-input-state-before.png', fullPage: true });
        console.log('📸 Screenshot saved: U002-input-state-before.png');
        
        await markHomeworkPage.sendTextMessage(TestData.messages.algebraQuestion);
        await markHomeworkPage.waitForThinkingComplete('marking');
      });

      await test.step('Verify no session persistence', async () => {
        // For unauthenticated users, follow-up creates new temporary session
        const messages = await markHomeworkPage.chatMessages.count();
        
        // Capture screenshot to see actual message count
        await page.screenshot({ path: 'test-results/U004-message-count-debug.png', fullPage: true });
        console.log('📸 Screenshot saved: U004-message-count-debug.png');
        console.log(`📊 Actual message count: ${messages}`);
        
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });

  test.describe('Question Mode Tests', () => {
    test('U003: First-time question with image only (Unauthenticated)', async ({ page }) => {
      await test.step('Upload image only', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q21);
        await markHomeworkPage.sendButton.click();
      });

      await test.step('Verify progress steps', async () => {
        for (const step of TestData.progressSteps.question) {
          await markHomeworkPage.waitForProgressStep(step);
        }
      });

      await test.step('Verify final state', async () => {
        await markHomeworkPage.waitForThinkingComplete('question');
        await markHomeworkPage.verifyAIResponse();
        
      });
    });

    test('U004: Follow-up question with image only (Unauthenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q21);
        await markHomeworkPage.sendButton.click();
        await markHomeworkPage.waitForThinkingComplete('question');
        
        // Add a small delay to ensure step 1 is fully complete
        await page.waitForTimeout(2000);
        console.log('✅ Step 1 fully completed, proceeding to step 2');
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q19);
        await markHomeworkPage.sendButton.click();
        await markHomeworkPage.waitForThinkingComplete('question');
      });

      await test.step('Verify no session persistence', async () => {
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });

  test.describe('Chat Mode Tests', () => {
    test('U005: First-time chat with text only (Unauthenticated)', async ({ page }) => {
      await test.step('Send text message', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
      });

      await test.step('Verify progress steps', async () => {
        for (const step of TestData.progressSteps.chat) {
          await markHomeworkPage.waitForProgressStep(step);
        }
      });

      await test.step('Verify final state', async () => {
        await markHomeworkPage.waitForThinkingComplete('chat');
        await markHomeworkPage.verifyAIResponse();
        
      });
    });

    test('U006: Follow-up chat with text only (Unauthenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
        await markHomeworkPage.waitForThinkingComplete('chat');
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.algebraQuestion);
        await markHomeworkPage.waitForThinkingComplete('chat');
      });

      await test.step('Verify no session persistence', async () => {
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });
});
