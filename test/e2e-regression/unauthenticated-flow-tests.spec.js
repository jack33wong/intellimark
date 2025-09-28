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
        await markHomeworkPage.uploadImage(TestData.images.step6FullPage);
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
      });

      await test.step('Verify progress steps', async () => {
        for (const step of TestData.progressSteps.marking) {
          await markHomeworkPage.waitForProgressStep(step);
        }
      });

      await test.step('Verify final state', async () => {
        await markHomeworkPage.waitForThinkingComplete();
        await markHomeworkPage.verifyAnnotatedImage();
        await markHomeworkPage.verifyAIResponse();
        
        const finalThinkingText = await markHomeworkPage.getCurrentThinkingText();
        expect(finalThinkingText).toContain('Show thinking');
      });
    });

    test('U002: Follow-up marking with image + text (Unauthenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.step6FullPage);
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q19);
        await markHomeworkPage.sendTextMessage(TestData.messages.algebraQuestion);
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Verify no session persistence', async () => {
        // For unauthenticated users, follow-up creates new temporary session
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });

  test.describe('Question Mode Tests', () => {
    test('U003: First-time question with image only (Unauthenticated)', async ({ page }) => {
      await test.step('Upload image only', async () => {
        await markHomeworkPage.uploadImage(TestData.images.step6FullPage);
        await markHomeworkPage.sendButton.click();
      });

      await test.step('Verify progress steps', async () => {
        for (const step of TestData.progressSteps.question) {
          await markHomeworkPage.waitForProgressStep(step);
        }
      });

      await test.step('Verify final state', async () => {
        await markHomeworkPage.waitForThinkingComplete();
        await markHomeworkPage.verifyAIResponse();
        
        const finalThinkingText = await markHomeworkPage.getCurrentThinkingText();
        expect(finalThinkingText).toContain('Show thinking');
      });
    });

    test('U004: Follow-up question with image only (Unauthenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.step6FullPage);
        await markHomeworkPage.sendButton.click();
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.uploadImage(TestData.images.q19);
        await markHomeworkPage.sendButton.click();
        await markHomeworkPage.waitForThinkingComplete();
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
        await markHomeworkPage.waitForThinkingComplete();
        await markHomeworkPage.verifyAIResponse();
        
        const finalThinkingText = await markHomeworkPage.getCurrentThinkingText();
        expect(finalThinkingText).toContain('Show thinking');
      });
    });

    test('U006: Follow-up chat with text only (Unauthenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.algebraQuestion);
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Verify no session persistence', async () => {
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });
});
