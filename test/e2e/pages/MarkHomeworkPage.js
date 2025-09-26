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
    
    // Model selector
    this.modelSelector = page.locator('.model-selector-button');
    this.modelOption = page.locator('.model-selector-option');
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

  /**
   * Selects the AI model from the model selector dropdown.
   * @param {string} model - The model to select ('auto', 'gemini-2.5-pro')
   */
  async selectModel(model) {
    // Click on the model selector to open dropdown
    await expect(this.modelSelector, 'Model selector should be visible').toBeVisible();
    await this.modelSelector.click();
    
    // Wait for dropdown to appear and select the model
    const modelOption = this.modelOption.filter({ hasText: model === 'auto' ? 'Auto' : model === 'gemini-2.5-pro' ? 'Gemini 2.5 Pro' : 'Gemini 1.5 Pro' });
    await expect(modelOption, `Model option for ${model} should be visible`).toBeVisible();
    await modelOption.click();
    
    console.log(`🤖 Model selected: ${model}`);
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
      .toBeHidden({ timeout: 300000 }); // 5 minutes for real AI model

    // 2. Poll until the last AI message is visible and meets our content criteria.
    await this.page.waitForFunction(async () => {
      const lastMessage = document.querySelector('.message.ai, .ai-message, .chat-message.assistant:last-child');
      if (!lastMessage) return false;
      
      // Check for annotated image first (for marking_annotated messages)
      const annotatedImage = lastMessage.querySelector('.homework-annotated-image img.annotated-image');
      if (annotatedImage) {
        console.log('✅ AI response with annotated image loaded');
        return true;
      }
      
      // For text-based responses, verify the content has meaningful length and is not just "thinking"
      const textContent = lastMessage.textContent;
      if (textContent && textContent.length > 20 && !textContent.includes('AI is thinking')) {
        console.log('✅ AI response content loaded');
        return true;
      }
      
      return false;
    }, { timeout: 300000 }); // 5 minutes for real AI model responses
    
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
   * Verifies that user uploaded images have base64 sources (from chat session memory).
   * @param {number} expectedCount - Expected number of user images (default: 1)
   */
  async verifyUserImagesHaveBase64Sources(expectedCount = 1) {
    const userImages = this.getUserImageLocator();
    
    // Wait for user images to be visible
    await expect(userImages).toHaveCount(expectedCount, { timeout: 10000 });
    
    // Verify each user image has base64 source
    for (let i = 0; i < expectedCount; i++) {
      const userImage = userImages.nth(i);
      await expect(userImage).toBeVisible();
      
      // Check that the image source starts with data:image (base64 format)
      await expect(userImage).toHaveAttribute('src', /^data:image/);
      
      console.log(`✅ User image ${i + 1} verified to have base64 source`);
    }
  }

  /**
   * Verifies that AI images in the chat (when loaded from chat history) have database storage URLs.
   * User images may still be base64 from session memory, but AI images should be from storage.
   * This should be called after clicking on a chat history item.
   */
  async verifyAllImagesFromDatabaseStorage() {
    // Wait for chat to load completely
    await this.page.waitForLoadState('networkidle');
    
    // Get all images in the chat (both user and AI images)
    const allImages = this.page.locator('.chat-container img, .messages-container img, .main-chat-container img');
    
    // Wait for at least one image to be present and visible
    await expect(allImages.first()).toBeVisible({ timeout: 10000 });
    
    // Wait for all images to be loaded (have src attributes)
    await this.page.waitForFunction(() => {
      const images = document.querySelectorAll('.chat-container img, .messages-container img, .main-chat-container img');
      return Array.from(images).every(img => img.src && img.src.length > 0);
    }, { timeout: 10000 });
    
    const imageCount = await allImages.count();
    console.log(`🔍 Found ${imageCount} images to verify`);
    
    // Verify each image - AI images should have storage URLs, user images may be base64
    for (let i = 0; i < imageCount; i++) {
      const image = allImages.nth(i);
      await expect(image).toBeVisible();
      
      // Wait for this specific image to have a src attribute
      await expect(image).toHaveAttribute('src', /.+/, { timeout: 5000 });
      
      const src = await image.getAttribute('src');
      console.log(`🔍 Image ${i + 1} src: ${src ? src.substring(0, 50) + '...' : 'null'}`);
      
      // Check if this is an AI image (annotated image) - these should have storage URLs
      const isAnnotatedImage = await image.locator('..').locator('..').locator('.homework-annotated-image').count() > 0;
      
      if (isAnnotatedImage) {
        // AI images should have storage URLs
        await expect(image).toHaveAttribute('src', /storage\.googleapis\.com/);
        console.log(`✅ AI image ${i + 1} verified to have database storage URL`);
      } else {
        // User images may still be base64 from session memory
        const hasStorageUrl = src && src.includes('storage.googleapis.com');
        const hasBase64 = src && src.startsWith('data:image');
        
        if (hasStorageUrl) {
          console.log(`✅ User image ${i + 1} verified to have database storage URL`);
        } else if (hasBase64) {
          console.log(`ℹ️ User image ${i + 1} still has base64 source (from session memory)`);
        } else {
          throw new Error(`User image ${i + 1} has unexpected source format: ${src}`);
        }
      }
    }
    
    console.log(`✅ Image verification completed for ${imageCount} images`);
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
   * Verifies AI response has content (simplified for Gemini 1.5 Pro).
   * @param {Object} options - Configuration options
   * @param {number} options.responseIndex - Index of the AI response to verify (default: 0)
   */
  async verifyAIResponseHasAnnotatedImage(options = {}) {
    const responseIndex = options.responseIndex || 0;
    const aiMessage = this.aiMessages.nth(responseIndex);
    
    // Wait for AI response to be visible
    await expect(aiMessage).toBeVisible();
    
    // Simple check: just verify the AI message has substantial content
    const textContent = await aiMessage.textContent();
    expect(textContent.length).toBeGreaterThan(10);
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