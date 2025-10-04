const path = require('path');
const fs = require('fs');

/**
 * Enhanced Error Reporting Utility for E2E Tests
 * Provides better debugging information with screenshots, logs, and context
 */
class ErrorReporter {
  constructor(page, testName = 'unknown') {
    this.page = page;
    this.testName = testName;
    this.debugDir = path.join(__dirname, '../debug-screenshots');
    this.ensureDebugDir();
  }

  ensureDebugDir() {
    if (!fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }

  /**
   * Takes a debug screenshot with timestamp and context
   * @param {string} context - Description of what was happening when error occurred
   * @param {string} filename - Optional custom filename
   * @returns {Promise<string>} Path to the screenshot file
   */
  async takeDebugScreenshot(context, filename = null) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeContext = context.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 50);
    const screenshotName = filename || `${this.testName}-${safeContext}-${timestamp}.png`;
    const screenshotPath = path.join(this.debugDir, screenshotName);
    
    try {
      await this.page.screenshot({ 
        path: screenshotPath,
        fullPage: true 
      });
      console.log(`📸 Debug screenshot saved: ${screenshotPath}`);
      return screenshotPath;
    } catch (error) {
      console.error('❌ Failed to take debug screenshot:', error);
      return null;
    }
  }

  /**
   * Captures browser console logs for debugging
   * @returns {Promise<Array>} Array of console log entries
   */
  async captureConsoleLogs() {
    try {
      const logs = await this.page.evaluate(() => {
        return window.consoleLogs || [];
      });
      return logs;
    } catch (error) {
      console.error('❌ Failed to capture console logs:', error);
      return [];
    }
  }

  /**
   * Gets current page state information for debugging
   * @returns {Promise<Object>} Page state information
   */
  async getPageState() {
    try {
      const state = await this.page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          visibleElements: {
            fileInput: !!document.querySelector('#unified-file-input'),
            textInput: !!document.querySelector('.main-chat-input, textarea, input[type="text"], .chat-input'),
            sendButton: !!document.querySelector('button:has-text("Send"), button:has-text("Analyze"), button[type="submit"], .send-button'),
            chatMessages: document.querySelectorAll('.chat-message, .message').length,
            aiThinking: !!document.querySelector('.ai-thinking, .thinking-animation, .upload-loading-bar')
          },
          networkRequests: window.networkRequests || [],
          errors: window.pageErrors || []
        };
      });
      return state;
    } catch (error) {
      console.error('❌ Failed to get page state:', error);
      return { error: error.message };
    }
  }

  /**
   * Enhanced error reporting with full context
   * @param {Error} error - The original error
   * @param {string} context - What was happening when error occurred
   * @param {Object} additionalInfo - Any additional debugging information
   * @returns {Promise<Object>} Enhanced error information
   */
  async reportError(error, context, additionalInfo = {}) {
    const timestamp = new Date().toISOString();
    const screenshotPath = await this.takeDebugScreenshot(context);
    const consoleLogs = await this.captureConsoleLogs();
    const pageState = await this.getPageState();

    const enhancedError = {
      timestamp,
      testName: this.testName,
      context,
      originalError: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      screenshot: screenshotPath,
      consoleLogs,
      pageState,
      additionalInfo
    };

    // Log the enhanced error
    console.error('🚨 Enhanced Error Report:');
    console.error(`   Test: ${this.testName}`);
    console.error(`   Context: ${context}`);
    console.error(`   Error: ${error.message}`);
    console.error(`   Screenshot: ${screenshotPath}`);
    console.error(`   URL: ${pageState.url}`);
    console.error(`   Ready State: ${pageState.readyState}`);

    return enhancedError;
  }

  /**
   * Wraps a function with enhanced error reporting
   * @param {Function} fn - Function to wrap
   * @param {string} context - Context description
   * @param {Object} options - Options for retry and error handling
   * @returns {Promise} Result of the function or enhanced error
   */
  async withErrorReporting(fn, context, options = {}) {
    const { maxRetries = 0, retryDelay = 1000 } = options;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.log(`⚠️  Attempt ${attempt + 1} failed, retrying in ${retryDelay}ms...`);
          await this.page.waitForTimeout(retryDelay);
          continue;
        }

        // Final attempt failed, report the error
        return await this.reportError(error, context, { 
          attempt: attempt + 1, 
          maxRetries: maxRetries + 1 
        });
      }
    }
  }
}

module.exports = ErrorReporter;
