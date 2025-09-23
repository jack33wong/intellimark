const { expect } = require('@playwright/test');

class SidebarPage {
  constructor(page) {
    this.page = page;

    // --- Define Locators in the Constructor ---
    // This makes the code self-documenting and resilient.
    
    /** The main container for the entire sidebar. */
    this.sidebar = page.locator('.sidebar, .app-sidebar');
    
    /** A locator for ALL chat history items in the list. */
    this.chatHistoryItems = page.locator('.mark-history-item');
    
    /** A specific locator for the first (newest) chat history item. */
    this.newestChatItem = this.chatHistoryItems.first();

    /** A locator for any loading indicators within the sidebar. */
    this.loadingSpinner = page.locator('.sidebar .loading, .sidebar .spinner');
    
    /** Locators for chat history item details */
    this.chatTitle = page.locator('.mark-history-item-title');
    this.chatTimestamp = page.locator('.mark-history-item-time');
    this.chatPreview = page.locator('.mark-history-item-preview');
    
    /** Message count in sidebar */
    this.messageCount = page.locator('.message-count, .item-count');
    
    /** Tab selectors */
    this.tabs = page.locator('.mark-history-tabs');
    this.tab = page.locator('.mark-history-tab');
  }

  // --- High-Level Actions ---

  /**
   * Clicks a chat history item that contains a specific title.
   * @param {string} title - The visible text of the chat item title to click.
   */
  async clickChatItemByTitle(title) {
    // This single line finds the correct item and clicks it, waiting automatically.
    await this.getChatItemByTitle(title).click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Clicks the first (newest) item in the chat history list. */
  async clickNewestChatItem() {
    await this.newestChatItem.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clicks a chat history item by index.
   * @param {number} index - The index of the chat item to click (0-based).
   */
  async clickChatHistoryItem(index) {
    await this.chatHistoryItems.nth(index).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clicks a specific tab in the sidebar.
   * @param {string} tabName - The name of the tab to click.
   */
  async clickTab(tabName) {
    await this.tab.filter({ hasText: tabName }).click();
    await this.page.waitForLoadState('networkidle');
  }

  // --- High-Level Verifications ---

  /**
   * Waits for the sidebar to finish loading and appear stable.
   * This is more reliable than waiting for network idle.
   */
  async waitForLoad() {
    // First, wait for the sidebar container itself to be visible.
    await expect(this.sidebar, 'The sidebar container should be visible').toBeVisible({ timeout: 10000 });
    // Then, wait for any loading spinners inside it to disappear.
    await expect(this.loadingSpinner, 'The loading spinner in the sidebar should disappear').toBeHidden({ timeout: 15000 });
  }

  /**
   * Waits for a new chat history item to appear.
   * @param {number} expectedCount - The expected number of items after the new one appears.
   */
  async waitForNewChatHistoryItem(expectedCount = 1) {
    await expect(this.chatHistoryItems, `Should have ${expectedCount} chat history items`).toHaveCount(expectedCount);
  }

  /**
   * Waits for the sidebar to update with new data.
   */
  async waitForSidebarUpdate() {
    await this.page.waitForLoadState('networkidle');
    await expect(this.sidebar).toBeVisible({ timeout: 5000 });
  }

  // --- Helper Methods that Return Locators ---
  // This is a powerful pattern that allows for flexible assertions in the test file.

  /**
   * Returns a locator for a specific chat history item filtered by its title.
   * @param {string} title - The text within the title of the chat item.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for that specific item.
   */
  getChatItemByTitle(title) {
    // .filter() is a powerful way to chain locators to find specific elements.
    return this.chatHistoryItems.filter({ hasText: title });
  }

  /**
   * Returns a locator for the title element within a specific chat item.
   * @param {import('@playwright/test').Locator} chatItemLocator - The locator for the parent chat item.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the title.
   */
  getChatItemTitle(chatItemLocator) {
    return chatItemLocator.locator('.mark-history-item-title');
  }

  /**
   * Returns a locator for all chat history items.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for all chat history items.
   */
  getChatHistoryItemLocator() {
    return this.chatHistoryItems;
  }

  /**
   * Returns a locator for the newest chat history item.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the newest chat item.
   */
  getNewestChatItemLocator() {
    return this.newestChatItem;
  }

  // --- Data Retrieval Methods ---
  // These methods return actual data rather than locators, for when you need the values.

  /**
   * Gets the count of chat history items.
   * @returns {Promise<number>} The number of chat history items.
   */
  async getChatHistoryCount() {
    await this.waitForLoad();
    return await this.chatHistoryItems.count();
  }

  /**
   * Gets the title of the newest chat history item.
   * @returns {Promise<string|null>} The title text or null if not found.
   */
  async getNewestChatHistoryItemTitle() {
    await expect(this.newestChatItem).toBeVisible({ timeout: 5000 });
    return await this.newestChatItem.locator(this.chatTitle).textContent();
  }

  /**
   * Gets the message count from the sidebar.
   * @returns {Promise<number>} The message count or 0 if not found.
   */
  async getSidebarMessageCount() {
    const countElement = this.messageCount;
    if (await countElement.isVisible()) {
      const text = await countElement.textContent();
      return parseInt(text.trim(), 10) || 0;
    }
    return 0;
  }

  /**
   * Checks if the sidebar is visible.
   * @returns {Promise<boolean>} True if the sidebar is visible.
   */
  async isSidebarVisible() {
    return await this.sidebar.isVisible();
  }

  // --- Legacy methods for backward compatibility ---
  // These are kept for any existing code that might depend on them

  async waitForSidebarLoad() {
    await this.waitForLoad();
  }

  async getNewestChatHistoryItem() {
    await this.waitForLoad();
    const newestItem = this.newestChatItem;
    if (await newestItem.isVisible()) {
      return {
        title: await newestItem.locator(this.chatTitle).textContent(),
        timestamp: await newestItem.locator(this.chatTimestamp).textContent(),
        preview: await newestItem.locator(this.chatPreview).textContent()
      };
    }
    return null;
  }

  async waitForChatLoad() {
    // Wait for chat to load after clicking history item
    await this.page.waitForLoadState('networkidle');
    // Wait for chat messages to be visible
    await this.page.waitForSelector('.chat-messages, .message-list', { timeout: 5000 });
  }

  async waitForLoadingToComplete() {
    await this.page.waitForFunction(() => {
      const spinners = document.querySelectorAll('.loading, .spinner');
      return Array.from(spinners).every(spinner => 
        spinner.style.display === 'none' || !spinner.offsetParent
      );
    }, { timeout: 10000 });
  }

  async refreshSidebar() {
    // Force refresh of sidebar data
    await this.page.reload();
    await this.waitForLoad();
  }
}

module.exports = SidebarPage;