const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

class MarkHomeworkPage extends BasePage {
  constructor(page) {
    super(page);
    
    // Upload and file input locators
    this.fileInput = page.locator('#main-file-input').or(page.locator('#followup-file-input'));
    this.textInput = page.locator('.main-chat-input');
    this.sendButton = page.locator('button:has-text("Send")');
    
    // Message locators
    this.userMessages = page.locator('.message.user, .user-message, .chat-message.user');
    this.aiMessages = page.locator('.message.ai, .ai-message, .chat-message.assistant');
    this.chatMessages = page.locator('.chat-message');
    
    // Progress and thinking locators
    this.progressSteps = page.locator('.progress-step');
    this.thinkingIndicator = page.locator('.thinking-indicator');
    
    // Model selector
    this.modelSelector = page.locator('.model-selector-button');
  }

  async navigateToMarkHomework() {
    await this.page.goto('/mark-homework');
    await this.page.waitForLoadState('networkidle');
    console.log('📄 Navigated to mark-homework page');
  }

  async uploadImage(imagePath) {
    await this.fileInput.setInputFiles(imagePath);
    console.log('📸 Image uploaded');
  }

  async sendTextMessage(text) {
    await this.textInput.fill(text);
    await this.sendButton.click();
    console.log(`📝 Text sent: "${text}"`);
  }

  async waitForProgressStep(stepText, timeout = 10000) {
    await this.page.waitForFunction(
      (text) => {
        const thinkingText = document.querySelector('.thinking-text');
        return thinkingText && thinkingText.textContent.includes(text);
      },
      stepText,
      { timeout }
    );
    console.log(`✅ Progress step reached: "${stepText}"`);
  }

  async waitForThinkingComplete(timeout = 30000) {
    // Wait for "Show thinking" to appear
    await this.page.waitForFunction(
      () => {
        const thinkingText = document.querySelector('.thinking-text');
        return thinkingText && thinkingText.textContent.includes('Show thinking');
      },
      { timeout }
    );
    console.log('✅ Thinking completed - "Show thinking" appeared');
  }

  async getCurrentThinkingText() {
    return await this.thinkingText.textContent();
  }

  async clickProgressToggle() {
    await this.progressToggle.click();
    console.log('🔄 Progress toggle clicked');
  }

  async getProgressSteps() {
    return await this.progressSteps.allTextContents();
  }

  async verifyAnnotatedImage() {
    const image = this.page.locator('.chat-message img');
    await expect(image).toBeVisible();
    console.log('✅ Annotated image verified');
  }

  async verifyAIResponse() {
    const aiMessage = this.aiMessages.last();
    await expect(aiMessage).toBeVisible();
    console.log('✅ AI response verified');
  }
}

module.exports = { MarkHomeworkPage };
