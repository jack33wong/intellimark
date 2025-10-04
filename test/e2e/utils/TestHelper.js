const path = require('path');

/**
 * Test Helper Utilities for Enhanced Error Reporting
 * Provides common test utilities and error handling patterns
 */
class TestHelper {
  constructor(page, testName) {
    this.page = page;
    this.testName = testName;
  }

  /**
   * Wraps a test step with enhanced error reporting
   * @param {Function} testStep - The test step function
   * @param {string} stepName - Name of the test step
   * @param {Object} options - Options for retry and error handling
   * @returns {Promise} Result of the test step
   */
  async withErrorReporting(testStep, stepName, options = {}) {
    const { maxRetries = 0, retryDelay = 1000 } = options;
    let lastError;

    console.log(`🔄 Starting test step: ${stepName}`);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await testStep();
        console.log(`✅ Test step completed: ${stepName}`);
        return result;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.log(`⚠️  Step "${stepName}" failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${retryDelay}ms...`);
          console.log(`   Error: ${error.message}`);
          await this.page.waitForTimeout(retryDelay);
          continue;
        }

        // Final attempt failed, report the error with context
        console.error(`❌ Test step failed: ${stepName}`);
        console.error(`   Error: ${error.message}`);
        console.error(`   Attempts: ${attempt + 1}/${maxRetries + 1}`);
        
        // Take a debug screenshot
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(__dirname, `../debug-screenshots/${this.testName}-${stepName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}.png`);
        
        try {
          await this.page.screenshot({ 
            path: screenshotPath,
            fullPage: true 
          });
          console.log(`📸 Debug screenshot saved: ${screenshotPath}`);
        } catch (screenshotError) {
          console.error('❌ Failed to take debug screenshot:', screenshotError);
        }

        throw error;
      }
    }
  }

  /**
   * Waits for a condition with better error reporting
   * @param {Function} condition - Function that returns a boolean when condition is met
   * @param {string} description - Description of what we're waiting for
   * @param {Object} options - Wait options
   * @returns {Promise} Result of the condition
   */
  async waitForCondition(condition, description, options = {}) {
    const { timeout = 30000, interval = 1000 } = options;
    
    return await this.withErrorReporting(
      async () => {
        await this.page.waitForFunction(condition, { timeout, polling: interval });
        console.log(`✅ Condition met: ${description}`);
      },
      `Wait for: ${description}`,
      { maxRetries: 0 }
    );
  }

  /**
   * Performs a retryable action with exponential backoff
   * @param {Function} action - The action to retry
   * @param {string} actionName - Name of the action
   * @param {Object} options - Retry options
   * @returns {Promise} Result of the action
   */
  async retryAction(action, actionName, options = {}) {
    const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = options;
    
    return await this.withErrorReporting(
      async () => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            return await action();
          } catch (error) {
            if (attempt === maxRetries) {
              throw error;
            }
            
            const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
            console.log(`⚠️  ${actionName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
            await this.page.waitForTimeout(delay);
          }
        }
      },
      actionName,
      { maxRetries: 0 } // We handle retries internally
    );
  }

  /**
   * Logs test progress with timestamps
   * @param {string} message - Progress message
   * @param {string} level - Log level (info, warn, error)
   */
  logProgress(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const emoji = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`${emoji} [${timestamp}] ${this.testName}: ${message}`);
  }

  /**
   * Captures test state for debugging
   * @param {string} context - Context description
   * @returns {Promise<Object>} Test state information
   */
  async captureTestState(context) {
    try {
      const state = await this.page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          timestamp: new Date().toISOString(),
          elements: {
            chatMessages: document.querySelectorAll('.chat-message, .message').length,
            userMessages: document.querySelectorAll('.chat-message.user, .message.user').length,
            aiMessages: document.querySelectorAll('.chat-message.assistant, .message.ai').length,
            fileInput: !!document.querySelector('#unified-file-input'),
            textInput: !!document.querySelector('.main-chat-input, textarea, input[type="text"]'),
            sendButton: !!document.querySelector('button:has-text("Send"), button:has-text("Analyze")'),
            aiThinking: !!document.querySelector('.ai-thinking, .thinking-animation')
          }
        };
      });
      
      this.logProgress(`Test state captured: ${context}`, 'info');
      return state;
    } catch (error) {
      this.logProgress(`Failed to capture test state: ${error.message}`, 'error');
      return { error: error.message, context };
    }
  }
}

module.exports = TestHelper;
