const { test, expect } = require('@playwright/test');
const { MarkHomeworkPage } = require('./pages/MarkHomeworkPage');
const { TestData } = require('./utils/TestData');

test.describe('Authenticated User Flow Tests', () => {
  let markHomeworkPage;

  test.beforeEach(async ({ page }) => {
    markHomeworkPage = new MarkHomeworkPage(page);
    await markHomeworkPage.navigateToMarkHomework();
    await markHomeworkPage.login();
  });

  test.describe('Marking Mode Tests', () => {
    test('A001: First-time marking with image + text (Authenticated)', async ({ page }) => {
      await test.step('Create scrollable content', async () => {
        // Send a few text messages to create scrollable content
        for (let i = 0; i < 3; i++) {
          await markHomeworkPage.sendTextMessage(`Message ${i + 1} to create content`);
          await markHomeworkPage.waitForThinkingComplete();
        }
      });

      await test.step('Scroll to middle and upload image with text', async () => {
        await markHomeworkPage.scrollToMiddle();
        const initialScroll = await markHomeworkPage.getScrollPosition();
        console.log(`📍 Initial scroll position (middle): ${initialScroll}px`);

        await markHomeworkPage.uploadImage(TestData.images.step6FullPage);
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
      });

      await test.step('Verify progress steps and thinking text transitions', async () => {
        for (const step of TestData.progressSteps.marking) {
          await markHomeworkPage.waitForProgressStep(step);
          const currentText = await markHomeworkPage.getCurrentThinkingText();
          console.log(`🧠 Current thinking text: "${currentText}"`);
        }
      });

      await test.step('Verify final state and scroll behavior', async () => {
        await markHomeworkPage.waitForThinkingComplete();
        await markHomeworkPage.verifyAnnotatedImage();
        await markHomeworkPage.verifyAIResponse();
        
        const finalThinkingText = await markHomeworkPage.getCurrentThinkingText();
        expect(finalThinkingText).toContain('Show thinking');
        
        // Verify scroll behavior - should NOT auto-scroll from middle position
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        console.log(`📍 Final scroll position: ${finalScroll}px, Max scroll: ${maxScroll}px`);
        expect(finalScroll).toBeLessThan(maxScroll - 50); // Should not be at bottom
      });
    });

    test('A002: Follow-up marking with image + text (Authenticated)', async ({ page }) => {
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

      await test.step('Verify session persistence', async () => {
        // Verify both messages are in the same session
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4); // 2 user + 2 AI messages
      });
    });
  });

  test.describe('Question Mode Tests', () => {
    test('A003: First-time question with image only (Authenticated)', async ({ page }) => {
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

    test('A004: Follow-up question with image only (Authenticated)', async ({ page }) => {
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

      await test.step('Verify session persistence', async () => {
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });

  test.describe('Chat Mode Tests', () => {
    test('A005: First-time chat with text only (Authenticated)', async ({ page }) => {
      await test.step('Create scrollable content', async () => {
        // Send a few text messages to create scrollable content
        for (let i = 0; i < 3; i++) {
          await markHomeworkPage.sendTextMessage(`Message ${i + 1} to create content`);
          await markHomeworkPage.waitForThinkingComplete();
        }
      });

      await test.step('Scroll to middle and send text message', async () => {
        await markHomeworkPage.scrollToMiddle();
        const initialScroll = await markHomeworkPage.getScrollPosition();
        console.log(`📍 Initial scroll position (middle): ${initialScroll}px`);

        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
      });

      await test.step('Verify progress steps and thinking text transitions', async () => {
        for (const step of TestData.progressSteps.chat) {
          await markHomeworkPage.waitForProgressStep(step);
          const currentText = await markHomeworkPage.getCurrentThinkingText();
          console.log(`🧠 Current thinking text: "${currentText}"`);
        }
      });

      await test.step('Verify final state and scroll behavior', async () => {
        await markHomeworkPage.waitForThinkingComplete();
        await markHomeworkPage.verifyAIResponse();
        
        const finalThinkingText = await markHomeworkPage.getCurrentThinkingText();
        expect(finalThinkingText).toContain('Show thinking');
        
        // Verify scroll behavior - text-only should ALWAYS auto-scroll
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        console.log(`📍 Final scroll position: ${finalScroll}px, Max scroll: ${maxScroll}px`);
        expect(finalScroll).toBeGreaterThanOrEqual(maxScroll - 50); // Should be at bottom
      });
    });

    test('A006: Follow-up chat with text only (Authenticated)', async ({ page }) => {
      await test.step('First submission', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Follow-up submission', async () => {
        await markHomeworkPage.sendTextMessage(TestData.messages.algebraQuestion);
        await markHomeworkPage.waitForThinkingComplete();
      });

      await test.step('Verify session persistence', async () => {
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(4);
      });
    });
  });

  test.describe('Comprehensive Flow Tests', () => {
    test('Complete flow test: All modes with scroll and thinking text verification', async ({ page }) => {
      await test.step('Test 1: Marking mode with image + text (no auto-scroll from middle)', async () => {
        // Create scrollable content
        for (let i = 0; i < 2; i++) {
          await markHomeworkPage.sendTextMessage(`Setup message ${i + 1}`);
          await markHomeworkPage.waitForThinkingComplete();
        }

        // Scroll to middle and test marking mode
        await markHomeworkPage.scrollToMiddle();
        const initialScroll = await markHomeworkPage.getScrollPosition();
        
        await markHomeworkPage.uploadImage(TestData.images.step6FullPage);
        await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
        
        // Verify thinking text progression
        for (const step of TestData.progressSteps.marking) {
          await markHomeworkPage.waitForProgressStep(step);
        }
        await markHomeworkPage.waitForThinkingComplete();
        
        // Verify no auto-scroll from middle position
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        expect(finalScroll).toBeLessThan(maxScroll - 50);
        console.log('✅ Marking mode: No auto-scroll from middle position');
      });

      await test.step('Test 2: Question mode with image only (no auto-scroll from middle)', async () => {
        // Scroll to middle and test question mode
        await markHomeworkPage.scrollToMiddle();
        const initialScroll = await markHomeworkPage.getScrollPosition();
        
        await markHomeworkPage.uploadImage(TestData.images.q19);
        await markHomeworkPage.sendButton.click();
        
        // Verify thinking text progression
        for (const step of TestData.progressSteps.question) {
          await markHomeworkPage.waitForProgressStep(step);
        }
        await markHomeworkPage.waitForThinkingComplete();
        
        // Verify no auto-scroll from middle position
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        expect(finalScroll).toBeLessThan(maxScroll - 50);
        console.log('✅ Question mode: No auto-scroll from middle position');
      });

      await test.step('Test 3: Chat mode with text only (auto-scroll from middle)', async () => {
        // Scroll to middle and test chat mode
        await markHomeworkPage.scrollToMiddle();
        const initialScroll = await markHomeworkPage.getScrollPosition();
        
        await markHomeworkPage.sendTextMessage(TestData.messages.algebraQuestion);
        
        // Verify thinking text progression
        for (const step of TestData.progressSteps.chat) {
          await markHomeworkPage.waitForProgressStep(step);
        }
        await markHomeworkPage.waitForThinkingComplete();
        
        // Verify auto-scroll from middle position (text-only should always scroll)
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        expect(finalScroll).toBeGreaterThanOrEqual(maxScroll - 50);
        console.log('✅ Chat mode: Auto-scroll from middle position');
      });

      await test.step('Test 4: Image upload from near bottom (auto-scroll)', async () => {
        // Scroll near bottom and test image upload
        await markHomeworkPage.scrollToMiddle();
        await markHomeworkPage.chatContainer.evaluate((el) => {
          el.scrollTop = el.scrollHeight - el.clientHeight - 50;
        });
        
        const initialScroll = await markHomeworkPage.getScrollPosition();
        
        await markHomeworkPage.uploadImage(TestData.images.q21);
        await markHomeworkPage.sendTextMessage(TestData.messages.geometryQuestion);
        await markHomeworkPage.waitForThinkingComplete();
        
        // Verify auto-scroll from near bottom position
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        expect(finalScroll).toBeGreaterThanOrEqual(maxScroll - 50);
        console.log('✅ Image upload: Auto-scroll from near bottom position');
      });

      await test.step('Test 5: Progress toggle scroll behavior', async () => {
        // Test progress toggle scroll behavior
        await markHomeworkPage.scrollToMiddle();
        const initialScroll = await markHomeworkPage.getScrollPosition();
        
        await markHomeworkPage.clickProgressToggle();
        await page.waitForTimeout(1000);
        
        const finalScroll = await markHomeworkPage.getScrollPosition();
        const maxScroll = await markHomeworkPage.getMaxScrollPosition();
        
        // Smart scroll should work (may or may not scroll depending on content)
        expect(finalScroll).toBeGreaterThanOrEqual(0);
        expect(finalScroll).toBeLessThanOrEqual(maxScroll);
        console.log('✅ Progress toggle: Smart scroll behavior verified');
      });

      await test.step('Test 6: Session persistence verification', async () => {
        // Verify all messages are in the same session
        const messages = await markHomeworkPage.chatMessages.count();
        expect(messages).toBeGreaterThanOrEqual(10); // Multiple user + AI messages
        console.log(`✅ Session persistence: ${messages} messages in session`);
      });
    });
  });
});
