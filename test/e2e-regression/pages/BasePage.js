const { expect } = require('@playwright/test');

class BasePage {
  constructor(page) {
    this.page = page;
    
    // Common locators
    this.loginButton = page.locator('button:has-text("Login")');
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.chatContainer = page.locator('.chat-messages');
    this.thinkingText = page.locator('.thinking-text');
    this.progressToggle = page.locator('.progress-toggle-button');
  }

  async login(email = 'test@intellimark.com', password = '123456') {
    if (await this.loginButton.isVisible()) {
      await this.loginButton.click();
      await this.page.waitForSelector('input[type="email"]');
      await this.emailInput.fill(email);
      await this.passwordInput.fill(password);
      await this.submitButton.click();
      await this.page.waitForLoadState('networkidle');
      console.log('✅ Login successful');
      return true;
    }
    console.log('ℹ️ Already logged in');
    return false;
  }

  async logout() {
    // Implementation for logout if needed
  }

  async getScrollPosition() {
    return await this.chatContainer.evaluate((el) => el.scrollTop);
  }

  async getMaxScrollPosition() {
    return await this.chatContainer.evaluate((el) => el.scrollHeight - el.clientHeight);
  }

  async scrollToMiddle() {
    await this.chatContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight / 2;
    });
  }

  async scrollToTop() {
    await this.chatContainer.evaluate((el) => {
      el.scrollTop = 0;
    });
  }

  async isNearBottom(threshold = 100) {
    const scrollTop = await this.getScrollPosition();
    const maxScroll = await this.getMaxScrollPosition();
    return (maxScroll - scrollTop) <= threshold;
  }

  async waitForThinkingText(expectedText, timeout = 10000) {
    await this.thinkingText.waitFor({ state: 'visible', timeout });
    const currentText = await this.thinkingText.textContent();
    if (expectedText && !currentText.includes(expectedText)) {
      throw new Error(`Expected thinking text to contain "${expectedText}", but got "${currentText}"`);
    }
    return currentText;
  }

  async waitForAIResponse(timeout = 30000) {
    // Wait for AI response to complete
    await this.page.waitForSelector('.chat-message .assistant-header', { timeout });
    await this.page.waitForTimeout(1000); // Small delay to ensure completion
  }
}

module.exports = { BasePage };
