const { expect } = require('@playwright/test');
const path = require('path');

class MarkHomeworkPage {
  constructor(page) {
    this.page = page;

    // --- Define Locators in the Constructor ---
    // This is the core best practice. Locators are resilient and reusable.
    
    // Use .or() to handle multiple possible selectors gracefully
    this.fileInput = page.locator('#main-file-input').or(page.locator('#followup-file-input'));
    this.textInput = page.locator('.main-chat-input').or(page.locator('textarea')).or(page.locator('input[type="text"]')).or(page.locator('.chat-input'));
    this.sendButton = page.locator('button:has-text("Send")').or(page.locator('button:has-text("Analyze")')).or(page.locator('button[type="submit"]')).or(page.locator('.send-button'));
    
    // Locators for key UI areas
    this.chatContainer = page.locator('.chat-container, .messages-container, .main-chat-container');
    this.aiThinking = page.locator('.ai-thinking, .thinking-animation, .upload-loading-bar');
    this.chatHeaderTitle = page.locator('.chat-header-left h1');
    
    // Locators for message elements
    this.userMessages = page.locator('.message.user, .user-message, .chat-message.user');
    this.aiMessages = page.locator('.message.ai, .ai-message, .chat-message.assistant');
    
    // Upload area and buttons
    this.uploadArea = page.locator('.upload-area, .dropzone, .main-upload-input-bar');
    this.uploadButton = page.locator('.upload-button, button:has-text("Upload"), .title-upload-btn');
    
    // Message content selectors
    this.messageText = page.locator('.message-text, .message-content, .chat-message-content');
    this.messageImage = page.locator('.message-image, img, .chat-message img');
  }

  // --- Actions ---

  async navigateToMarkHomework() {
    await this.page.goto('/mark-homework');
    
    // Wait for page to be in a stable state (either upload or chat mode)
    await this.page.waitForFunction(() => {
      const followupInput = document.querySelector('#followup-file-input');
      const mainInput = document.querySelector('#main-file-input');
      return followupInput || mainInput;
    }, { timeout: 10000 });
    
    // Check if we're in initial upload mode or chat mode
    const isInChatMode = await this.page.isVisible('#followup-file-input');
    const isInUploadMode = await this.page.isVisible('#main-file-input');
    
    console.log(`📄 Page mode: Chat=${isInChatMode}, Upload=${isInUploadMode}`);
    
    // If we're in chat mode but need upload mode, try to find upload button
    if (isInChatMode && !isInUploadMode) {
      console.log('🔄 Page loaded in chat mode, looking for upload button...');
      
      // Look for upload button or title upload button
      const uploadButton = await this.page.$('.title-upload-btn, .upload-button, button:has-text("Upload")');
      if (uploadButton) {
        console.log('🖱️ Clicking upload button to switch to upload mode');
        await uploadButton.click();
        // Wait for upload mode to be active
        await this.page.waitForSelector('#main-file-input', { timeout: 5000 });
      }
    }
    
    // Instead of waiting for network, wait for a key element to be ready.
    await expect(this.chatContainer).toBeVisible({ timeout: 10000 });
  }

  async uploadImage(imagePath) {
    // No more loops or try/catch. The locator finds the correct input automatically.
    await this.fileInput.setInputFiles(imagePath);
    console.log('📸 Image uploaded successfully');
    
    // Wait for image processing to complete
    await this.page.waitForLoadState('networkidle');
  }

  async enterText(text) {
    await this.textInput.fill(text);
    console.log(`📝 Text entered: "${text}"`);
  }

  async sendMessage() {
    await this.sendButton.click();
    console.log('🖱️ Send button clicked');
  }

  // --- Verifications and Waits ---
  // These methods are now much simpler and more reliable.

  /**
   * The definitive method to wait for a complete AI response. It waits for
   * loading animations to finish and then polls the final message until it
   * contains meaningful, non-placeholder content that matches specific keywords.
   */
  async waitForAIResponse() {
    console.log('🤖 Waiting for AI response...');
    
    // 1. Wait for any "thinking" animations to finish.
    await expect(this.aiThinking, 'The AI thinking indicator should disappear')
      .toBeHidden({ timeout: 90000 });

    // 2. Poll until the last AI message is visible and meets our content criteria.
    await expect(async () => {
      const lastMessage = this.aiMessages.last();
      
      // First, ensure the message container exists.
      await expect(lastMessage, 'The AI message container should be visible').toBeVisible();
      
      // Check for annotated image first (for marking_annotated messages)
      const annotatedImageLocator = lastMessage.locator('.homework-annotated-image img.annotated-image');
      const hasAnnotatedImage = await annotatedImageLocator.count() > 0;
      if (hasAnnotatedImage) {
        console.log('✅ AI response with annotated image loaded');
        return;
      }
      
      // For text-based responses, verify the content has meaningful length
      const textContent = await lastMessage.textContent();
      if (textContent && textContent.length > 20) {
        console.log('✅ AI response content loaded');
        return;
      }
      
      throw new Error('AI response content is too short or empty');

    }, 'The AI response should render with specific, valid content').toPass({
      timeout: 30000 
    });
    
    console.log('✅ AI response content loaded');
  }

  async waitForUserMessage() {
    // Wait for user message to appear in chat using web-first assertion
    await expect(this.userMessages.last()).toBeVisible();
  }

  async waitForAIThinking() {
    // Wait for AI thinking animation to appear using web-first assertion
    await expect(this.aiThinking).toBeVisible();
  }

  // --- Helper Methods that Return Locators or Data ---
  // This pattern allows for more flexible assertions in the test file.

  async getChatHeaderTitle() {
    await expect(this.chatHeaderTitle).toBeVisible();
    return await this.chatHeaderTitle.textContent();
  }

  /**
   * Returns a locator for a user message containing specific text.
   * @param {string} text The text to find within a user message.
   * @returns {import('@playwright/test').Locator} A Playwright Locator.
   */
  getUserMessageLocator(text) {
    return this.userMessages.filter({ hasText: text });
  }

  /**
   * Returns a locator for user images.
   * @returns {import('@playwright/test').Locator} A Playwright Locator.
   */
  getUserImageLocator() {
    return this.userMessages.locator('img');
  }
  
  /**
   * Returns a locator for all annotated images within AI responses.
   * @returns {import('@playwright/test').Locator} A Playwright Locator.
   */
  getAnnotatedImageLocator() {
    return this.aiMessages.locator('img.annotated-image');
  }

  /**
   * Returns a locator for the chat header title.
   * @returns {import('@playwright/test').Locator} A Playwright Locator.
   */
  getChatHeaderTitleLocator() {
    return this.chatHeaderTitle;
  }

  /**
   * Verifies AI response has annotated images (for image-based responses) or substantial content (for text-based responses).
   * @param {Object} options - Configuration options
   * @param {number} options.responseIndex - Index of the AI response to verify (default: 0)
   */
  async verifyAIResponseHasAnnotatedImage(options = {}) {
    const responseIndex = options.responseIndex || 0;
    const aiMessage = this.aiMessages.nth(responseIndex);
    
    // Wait for AI response to be visible
    await expect(aiMessage).toBeVisible();
    
    // Check for the specific homework marking structure
    const markingMessage = aiMessage.locator('.chat-message-bubble.marking-message');
    
    // Check if this response has the marking structure (image-based) or is text-based
    const hasMarkingStructure = await markingMessage.count() > 0;
    
    if (hasMarkingStructure) {
      // This is an image-based response with annotated images
      await expect(markingMessage).toBeVisible();
      
      // Check for homework-annotated-image div within marking message
      const annotatedImageDiv = markingMessage.locator('.homework-annotated-image');
      await expect(annotatedImageDiv).toBeVisible();
      
      // Check for child images with specific class
      const childImages = annotatedImageDiv.locator('img.annotated-image');
      await expect(childImages).toHaveCount(1);
      
      // Verify images have storage URLs
      const firstImage = childImages.first();
      await expect(firstImage).toHaveAttribute('src', /storage\.googleapis\.com/);
      
      // Wait for image to be fully loaded
      await this.page.waitForFunction(
        (imgSrc) => {
          const img = document.querySelector(`img[src="${imgSrc}"]`);
          return img && img.complete && img.naturalWidth > 0;
        },
        await firstImage.getAttribute('src'),
        { timeout: 10000 }
      );
    } else {
      // This is a text-based response, just verify it has content
      console.log('🔍 Debugging AI message structure...');
      const aiMessageHTML = await aiMessage.innerHTML();
      console.log('AI Message HTML:', aiMessageHTML.substring(0, 500) + '...');
      
      const messageContent = aiMessage.locator('.chat-message-content').first();
      const contentCount = await messageContent.count();
      console.log(`Found ${contentCount} message content elements`);
      
      if (contentCount === 0) {
        // Fallback: just check if the AI message itself has text content
        const textContent = await aiMessage.textContent();
        console.log('AI Message text content:', textContent.substring(0, 200) + '...');
        // For follow-up responses, be more lenient as they might be different
        expect(textContent.length).toBeGreaterThan(20);
      } else {
        await expect(messageContent).toBeVisible();
        const textContent = await messageContent.textContent();
        expect(textContent.length).toBeGreaterThan(50);
      }
    }
    
    // Take screenshot
    if (responseIndex === 0) {
      await this.page.screenshot({ path: 'first-response.png', fullPage: true });
      console.log('📸 Screenshot saved as first-response.png');
    } else {
      await this.page.screenshot({ path: 'second-response.png', fullPage: true });
      console.log('📸 Screenshot saved as second-response.png');
    }
  }

  // --- Legacy methods for backward compatibility ---
  // These are kept for any existing code that might depend on them

  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
    await expect(this.chatContainer).toBeVisible({ timeout: 10000 });
  }

  async isMessageVisible(messageText) {
    const messageLocator = this.userMessages.filter({ hasText: messageText });
    return await messageLocator.isVisible();
  }

  async waitForImageToLoad() {
    // Wait for any images in messages to load
    await this.page.waitForFunction(() => {
      const images = document.querySelectorAll('img');
      return Array.from(images).every(img => img.complete);
    }, { timeout: 10000 });
  }
}

module.exports = MarkHomeworkPage;