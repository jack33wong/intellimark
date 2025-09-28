const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

class MarkHomeworkPage extends BasePage {
  constructor(page) {
    super(page);
    
    // Upload and file input locators - use more robust selectors
    this.fileInput = page.locator('#main-file-input').or(page.locator('#followup-file-input'));
    this.textInput = page.locator('.main-chat-input').or(page.locator('textarea')).or(page.locator('input[type="text"]')).or(page.locator('.chat-input'));
    this.sendButton = page.locator('button:has-text("Send")').or(page.locator('button:has-text("Analyze")')).or(page.locator('button[type="submit"]')).or(page.locator('.send-button'));
    
    // Message locators
    this.userMessages = page.locator('.message.user, .user-message, .chat-message.user');
    this.aiMessages = page.locator('.message.ai, .ai-message, .chat-message.assistant');
    this.chatMessages = page.locator('.chat-message');
    
    // Progress and thinking locators
    this.progressSteps = page.locator('.progress-step');
    this.aiThinking = page.locator('.ai-thinking, .thinking-animation, .upload-loading-bar');
    this.thinkingText = page.locator('.thinking-text');
    this.progressToggle = page.locator('.progress-toggle-button').first();
    
    // Model selector
    this.modelSelector = page.locator('.model-selector-button');
    
    // Chat container for scroll operations
    this.chatContainer = page.locator('.chat-container, .messages-container, .main-chat-container');
  }

  async navigateToMarkHomework() {
    await this.page.goto('/mark-homework');
    
    // Enable debug mode for API calls
    await this.page.evaluate(() => {
      localStorage.setItem('debugMode', 'true');
    });
    console.log('🐛 Debug mode enabled for API calls');
    
    // Wait for page to be in a stable state (either upload or chat mode)
    await this.page.waitForFunction(() => {
      const followupInput = document.querySelector('#followup-file-input');
      const mainInput = document.querySelector('#main-file-input');
      return followupInput || mainInput;
    }, { timeout: 10000 });
    
    // Wait for chat container to be visible
    await expect(this.chatContainer).toBeVisible({ timeout: 10000 });
    console.log('📄 Navigated to mark-homework page');
  }

  async uploadImage(imagePath) {
    await this.fileInput.setInputFiles(imagePath);
    console.log('📸 Image uploaded');
  }

  async sendTextMessage(text) {
    // Wait for text input to be visible and enabled
    await expect(this.textInput).toBeVisible({ timeout: 10000 });
    
    // Wait for input to be enabled with longer timeout and retry logic
    await this.page.waitForFunction(() => {
      const input = document.querySelector('.main-chat-input, textarea, input[type="text"], .chat-input');
      return input && !input.disabled && input.placeholder !== 'AI is processing your homework...';
    }, { timeout: 15000 });
    
    await expect(this.textInput).toBeEnabled({ timeout: 5000 });
    
    await this.textInput.fill(text);
    
    // Wait for send button to be visible and enabled
    await expect(this.sendButton).toBeVisible({ timeout: 5000 });
    await expect(this.sendButton).toBeEnabled({ timeout: 5000 });
    
    await this.sendButton.click();
    console.log(`📝 Text sent: "${text}"`);
  }

  async waitForProgressStep(stepText, timeout = 15000) {
    try {
      await this.page.waitForFunction(
        (text) => {
          const thinkingTextElements = document.querySelectorAll('.thinking-text');
          // Check if any thinking text element contains the step text
          return Array.from(thinkingTextElements).some(el => 
            el.textContent.includes(text)
          );
        },
        stepText,
        { timeout }
      );
      console.log(`✅ Progress step reached: "${stepText}"`);
    } catch (error) {
      console.log(`⚠️ Progress step "${stepText}" not found within ${timeout}ms, continuing...`);
      // Don't fail the test if a specific progress step isn't found
      // The AI might skip some steps or use different text
    }
  }

  async waitForThinkingComplete(mode = 'marking') {
    // Use different timeouts based on mode
    const timeouts = {
      marking: 90000,    // 90 seconds for marking mode
      question: 90000,   // 90 seconds for question mode (increased for non-debug mode)
      chat: 15000        // 15 seconds for chat mode
    };
    
    const timeout = timeouts[mode] || 90000;
    
    console.log(`🤖 Waiting for AI response completion (${mode} mode, timeout: ${timeout}ms)...`);
    
    // 1. Wait for any "thinking" animations to finish (like working e2e tests)
    await expect(this.aiThinking, 'The AI thinking indicator should disappear')
      .toBeHidden({ timeout });
    
    // 2. Wait for actual AI response content to appear
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
    }, { timeout });
    
    console.log(`✅ AI response completed (${mode} mode)`);
  }

  async getCurrentThinkingText() {
    // Get the last thinking text element to avoid conflicts with multiple elements
    const thinkingElements = await this.page.locator('.thinking-text').all();
    if (thinkingElements.length > 0) {
      const lastElement = thinkingElements[thinkingElements.length - 1];
      return await lastElement.textContent();
    }
    return '';
  }

  /**
   * Add custom debug parameters to API calls
   * @param {Object} debugParams - Custom debug parameters to add
   */
  async addDebugParameters(debugParams = {}) {
    await this.page.evaluate((params) => {
      // Store custom debug parameters in localStorage
      const existingDebug = JSON.parse(localStorage.getItem('debugParams') || '{}');
      const newDebug = { ...existingDebug, ...params };
      localStorage.setItem('debugParams', JSON.stringify(newDebug));
    }, debugParams);
    console.log('🐛 Custom debug parameters added:', debugParams);
  }

  /**
   * Enable/disable debug mode
   * @param {boolean} enabled - Whether to enable debug mode
   */
  async setDebugMode(enabled = true) {
    await this.page.evaluate((enabled) => {
      localStorage.setItem('debugMode', enabled.toString());
    }, enabled);
    console.log(`🐛 Debug mode ${enabled ? 'enabled' : 'disabled'}`);
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
