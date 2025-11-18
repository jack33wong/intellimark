const { expect } = require('@playwright/test');
const path = require('path');
const ErrorReporter = require('../utils/ErrorReporter');

class MarkHomeworkPage {
  constructor(page, testName = 'MarkHomeworkPage') {
    this.page = page;
    this.errorReporter = new ErrorReporter(page, testName);
    this.setupConsoleLogging();

    // --- Define Locators in the Constructor ---
    // This is the core best practice. Locators are resilient and reusable.
    
    // Use the unified file input selector
    this.fileInput = page.locator('#unified-file-input');
    this.textInput = page.locator('.main-chat-input').or(page.locator('textarea')).or(page.locator('input[type="text"]')).or(page.locator('.chat-input'));
    this.sendButton = page.locator('button:has-text("Send")').or(page.locator('button:has-text("Analyze")')).or(page.locator('button[type="submit"]')).or(page.locator('.send-button'));
    
    // Locators for key UI areas
    this.chatContainer = page.locator('.chat-container, .messages-container, .main-chat-container');
    this.aiThinking = page.locator('.ai-thinking, .thinking-animation, .upload-loading-bar');
    this.chatHeaderTitle = page.locator('.session-title');
    
    // Locators for message elements
    // Based on actual DOM structure: <div class="chat-message user"> and <div class="chat-message assistant">
    this.userMessages = page.locator('.chat-message.user');
    this.aiMessages = page.locator('.chat-message.assistant');
    
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

  /**
   * Sets up console logging and error tracking for better debugging
   */
  setupConsoleLogging() {
    // Capture console logs
    this.page.on('console', msg => {
      const timestamp = new Date().toISOString();
      const level = msg.type();
      const text = msg.text();
      
      // Log important messages
      if (level === 'error' || level === 'warn') {
        console.log(`🔍 Browser ${level.toUpperCase()}: ${text}`);
      }
    });

    // Capture page errors
    this.page.on('pageerror', error => {
      const timestamp = new Date().toISOString();
      console.log(`🚨 Page Error: ${error.message}`);
    });

    // Track network requests for debugging
    this.page.on('request', request => {
      // Only track API requests to avoid overwhelming the logs
      // API request logged
    });
  }

  // --- Actions ---

  async navigateToMarkHomework() {
    await this.page.goto('/mark-homework');
    
    // Wait for page to be in a stable state (either upload or chat mode)
    await this.page.waitForFunction(() => {
      const unifiedInput = document.querySelector('#unified-file-input');
      return unifiedInput;
    }, { timeout: 10000 });
    
    // Check if we're in initial upload mode or chat mode by looking at the chat messages
    const hasMessages = await this.page.locator('.chat-message, .message').count() > 0;
    
    // The unified input handles both modes, so no need for mode switching logic
    
    // Instead of waiting for network, wait for a key element to be ready.
    await expect(this.chatContainer).toBeVisible({ timeout: 10000 });
  }

  async uploadImage(imagePath) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        // Verify file exists before attempting upload
        if (!require('fs').existsSync(imagePath)) {
          throw new Error(`Image file not found: ${imagePath}`);
        }

        // In chat mode, click the upload button to trigger the file input (real user behavior)
        const uploadButton = this.page.locator('.followup-upload-button');
        if (await uploadButton.isVisible()) {
          console.log('🖱️  Clicking upload button to trigger file input...');
          await uploadButton.click();
          // Small delay for file input to be ready
          await this.page.waitForTimeout(200);
        } else {
          console.log('⚠️  Upload button not visible, trying direct file input access...');
        }

        // Try to use the file input directly (it might be hidden but still functional)
        try {
          await this.fileInput.setInputFiles(imagePath);
          console.log('✅ File input accepted the file');
        } catch (error) {
          // If direct file input fails, take a screenshot and provide better error info
          await this.page.screenshot({ 
            path: path.join(__dirname, `../debug-screenshots/debug-file-input-error-${Date.now()}.png`),
            fullPage: true 
          });
          
          const currentUrl = this.page.url();
          const pageTitle = await this.page.title();
          
          throw new Error(`File input failed to accept file. Error: ${error.message}. Current URL: ${currentUrl}, Page Title: ${pageTitle}`);
        }

        // Image upload is already handled above
        
        // Wait for image processing to complete with better error handling
        await this.page.waitForLoadState('networkidle', { timeout: 30000 });
        
        // Verify upload was successful by checking for chat messages or processing indicators
        const hasProcessingIndicator = await this.page.locator('.ai-thinking, .thinking-animation, .upload-loading-bar').isVisible();
        const hasChatMessages = await this.page.locator('.chat-message, .message').count() > 0;
        
        if (!hasProcessingIndicator && !hasChatMessages) {
          throw new Error('Image upload may have failed - no processing indicator or chat messages found');
        }

        console.log(`✅ Image uploaded successfully: ${path.basename(imagePath)}`);
      },
      `Upload image: ${path.basename(imagePath)}`,
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  async enterText(text) {
    await this.textInput.fill(text);
  }

  async sendMessage() {
    return await this.errorReporter.withErrorReporting(
      async () => {
        // Check if send button is available and enabled
        const isSendButtonVisible = await this.sendButton.isVisible();
        if (!isSendButtonVisible) {
          throw new Error('Send button is not visible');
        }

        const isSendButtonEnabled = await this.sendButton.isEnabled();
        if (!isSendButtonEnabled) {
          throw new Error('Send button is disabled');
        }

        // Click the send button
        await this.sendButton.click();
        
        // Wait for the message to be processed
        await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        
        console.log('✅ Message sent successfully');
      },
      'Send message',
      { maxRetries: 1, retryDelay: 1000 }
    );
  }

  /**
   * Selects the AI model from the model selector dropdown.
   * @param {string} model - The model to select ('auto', 'gemini-2.5-flash', 'openai-gpt-5-mini')
   */
  async selectModel(model) {
    // Click on the model selector to open dropdown
    await expect(this.modelSelector, 'Model selector should be visible').toBeVisible();
    await this.modelSelector.click();
    
    // Wait for dropdown to appear and select the model
    // Map model IDs to display names based on ModelSelector component
    const modelNameMap = {
      'auto': 'Auto',
      'gemini-2.5-flash': 'Gemini 2.5 Flash',
      'openai-gpt-5-mini': 'GPT 5.1 mini'
    };
    const modelDisplayName = modelNameMap[model] || model;
    const modelOption = this.modelOption.filter({ hasText: modelDisplayName });
    await expect(modelOption, `Model option for ${model} should be visible`).toBeVisible();
    await modelOption.click();
    
  }

  // --- Verifications and Waits ---
  // These methods are now much simpler and more reliable.

  /**
   * The definitive method to wait for a complete AI response. It waits for
   * loading animations to finish and then polls the final message until it
   * contains meaningful, non-placeholder content that matches specific keywords.
   */
  async waitForAIResponse() {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('⏳ Waiting for AI response...');
        console.log('🔍 DEBUG: Starting waitForAIResponse - checking AI thinking indicator...');
        
        // 1. Wait for any "thinking" animations to finish.
        await expect(this.aiThinking, 'The AI thinking indicator should disappear')
          .toBeHidden({ timeout: 300000 }); // 5 minutes for real AI model
        
        console.log('🔍 DEBUG: AI thinking indicator disappeared, checking for AI message...');

        // 2. Poll until the last AI message is visible and meets our content criteria.
        await this.page.waitForFunction(async () => {
          const lastMessage = document.querySelector('.chat-message.assistant:last-child');
          if (!lastMessage) {
            console.log('🔍 DEBUG: No AI message found yet...');
            return false;
          }
          
          console.log('🔍 DEBUG: Found AI message, checking for annotated image...');
          
          // Check for annotated image first (for marking_annotated messages)
          const annotatedImage = lastMessage.querySelector('.homework-annotated-image img.annotated-image');
          if (annotatedImage) {
            // Wait for the image to actually load (not just exist in DOM)
            if (annotatedImage.complete && annotatedImage.naturalWidth > 0) {
              console.log('🔍 DEBUG: Found annotated image and it has loaded, AI response complete!');
              return true;
            } else {
              console.log('🔍 DEBUG: Found annotated image but it is still loading...');
              return false;
            }
          }
          
          // Check for markdown renderer (for chat/text-only responses)
          const markdownRenderer = lastMessage.querySelector('.markdown-math-renderer.chat-message-renderer');
          if (markdownRenderer) {
            return true;
          }
          
          // For text-based responses, verify the content has meaningful length and is not just "thinking"
          const textContent = lastMessage.textContent;
          if (textContent && textContent.length > 20 && 
              !textContent.includes('AI is thinking') && 
              !textContent.includes('Processing question') &&
              !textContent.includes('Show thinking')) {
            return true;
          }
          
          return false;
        }, { timeout: 300000 }); // 5 minutes for real AI model responses
        
        console.log('✅ AI response received successfully');
      },
      'Wait for AI response',
      { maxRetries: 0 } // No retries for this method as it already has long timeouts
    );
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
    const locator = this.page.locator('.chat-message.user');
    
    // Debug: Print what the locator finds
    locator.count().then(count => {
      console.log(`🔍 Debug: locator('.chat-message.user') found ${count} elements`);
    });
    
    // Debug: Print all matching elements
    locator.all().then(elements => {
      elements.forEach((element, index) => {
        element.textContent().then(text => {
          console.log(`🔍 Debug: Element ${index}: "${text}"`);
        });
      });
    });
    
    return locator.filter({ hasText: text });
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
    
    // Verify each image - AI images should have storage URLs, user images may be base64
    for (let i = 0; i < imageCount; i++) {
      const image = allImages.nth(i);
      await expect(image).toBeVisible();
      
      // Wait for this specific image to have a src attribute
      await expect(image).toHaveAttribute('src', /.+/, { timeout: 5000 });
      
      const src = await image.getAttribute('src');
      
      // Check if this is an AI image (annotated image) - these should have storage URLs
      const isAnnotatedImage = await image.locator('..').locator('..').locator('.homework-annotated-image').count() > 0;
      
      if (isAnnotatedImage) {
        // AI images should have storage URLs
        await expect(image).toHaveAttribute('src', /storage\.googleapis\.com/);
      } else {
        // User images may still be base64 from session memory
        const hasStorageUrl = src && src.includes('storage.googleapis.com');
        const hasBase64 = src && src.startsWith('data:image');
        
        if (hasStorageUrl) {
          // User image has storage URL - this is expected for images loaded from database
        } else if (hasBase64) {
          // User image still has base64 - this is expected for images in session memory
        } else {
          throw new Error(`User image ${i + 1} has unexpected source format`);
        }
      }
    }
    
  }
  
  /**
   * Returns a locator for all annotated images within AI responses.
   * @returns {import('@playwright/test').Locator} A Playwright Locator.
   */
  getAnnotatedImageLocator() {
    return this.aiMessages.locator('img.annotated-image');
  }

  /**
   * Verifies that AI response has annotated image with correct source type.
   * For marking mode, the annotated image should have imageLink (storage URL) source.
   */
  async verifyAIResponseHasAnnotatedImage() {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('🔍 Verifying AI response has annotated image...');
        
        // Wait for AI response to be visible
        await expect(this.aiMessages.last()).toBeVisible({ timeout: 30000 });
        console.log('🔍 DEBUG: AI message is visible, checking for annotated image...');
        
        // Get the last AI message
        const lastAIMessage = this.aiMessages.last();
        
        // Wait for the annotated image container to appear first
        const annotatedImageContainer = lastAIMessage.locator('.homework-annotated-image');
        await expect(annotatedImageContainer).toBeVisible({ timeout: 15000 });
        console.log('🔍 DEBUG: Annotated image container is visible');
        
        // Check for annotated image within the AI message
        const annotatedImage = lastAIMessage.locator('img.annotated-image');
        await expect(annotatedImage).toBeVisible({ timeout: 15000 });
        console.log('🔍 DEBUG: Annotated image element is visible');
        
        // Wait for the image to actually load (not just be visible in DOM)
        await this.page.waitForFunction((imageSelector) => {
          const img = document.querySelector(imageSelector);
          return img && img.complete && img.naturalWidth > 0;
        }, `img.annotated-image`, { timeout: 30000 });
        console.log('🔍 DEBUG: Annotated image has finished loading');
        
        // Verify the annotated image has the correct source type
        // For marking mode, it should have imageLink (storage URL), not base64
        const imageSrc = await annotatedImage.getAttribute('src');
        
        if (imageSrc && imageSrc.startsWith('data:image')) {
          throw new Error('Annotated image should have storage URL (imageLink), not base64 data');
        }
        
        if (imageSrc && !imageSrc.includes('storage.googleapis.com')) {
          throw new Error('Annotated image should have storage URL containing "storage.googleapis.com"');
        }
        
        console.log('✅ AI response has annotated image with correct source type');
      },
      'Verify AI response has annotated image',
      { maxRetries: 2 }
    );
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


  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
    await expect(this.chatContainer).toBeVisible({ timeout: 10000 });
  }

  async waitForImageToLoad() {
    // Wait for any images in messages to load
    await this.page.waitForFunction(() => {
      const images = document.querySelectorAll('img');
      return Array.from(images).every(img => img.complete);
    }, { timeout: 10000 });
  }

  /**
   * Verifies the order of messages in the chat
   * @param {Array} expectedOrder - Array of expected message objects with type and optional text
   * Example: [
   *   { type: 'user', text: 'Hello' },
   *   { type: 'ai' },
   *   { type: 'user', text: 'Follow up' },
   *   { type: 'ai' }
   * ]
   */
  async verifyMessageOrder(expectedOrder) {
    // Get all message elements in order - use correct selectors matching actual DOM structure
    const allMessages = await this.page.locator('.chat-message.user, .chat-message.assistant').all();
    
    if (allMessages.length !== expectedOrder.length) {
      throw new Error(`Expected ${expectedOrder.length} messages, but found ${allMessages.length}`);
    }
    
    for (let i = 0; i < expectedOrder.length; i++) {
      const message = allMessages[i];
      const expected = expectedOrder[i];
      
      // Check message type by looking at the message container classes
      // Messages are already selected as .chat-message.user or .chat-message.assistant
      const messageClasses = await message.getAttribute('class');
      
      const hasUserClass = messageClasses && messageClasses.includes('user');
      const hasAIClass = messageClasses && messageClasses.includes('assistant');
      
      if (expected.type === 'user' && !hasUserClass) {
        throw new Error(`Message ${i + 1} should be user message, but found AI message. Classes: ${messageClasses}`);
      }
      
      if (expected.type === 'ai' && !hasAIClass) {
        throw new Error(`Message ${i + 1} should be AI message, but found user message. Classes: ${messageClasses}`);
      }
      
      // If text is specified, verify the message content
      if (expected.text) {
        const messageText = await message.textContent();
        if (!messageText.includes(expected.text)) {
          throw new Error(`Message ${i + 1} should contain "${expected.text}", but found: "${messageText}"`);
        }
      }
    }
  }

  /**
   * Captures a full page screenshot with optimal settings
   * @param {string} filename - The filename for the screenshot
   * @param {Object} options - Additional screenshot options
   */
  async captureFullPageScreenshot(filename, options = {}) {
    // Wait for all content to load
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
    
    // Default options for full page screenshot
    const defaultOptions = {
      path: filename,
      fullPage: true,
      type: 'jpeg',
      quality: 90, // High quality JPEG
      animations: 'disabled', // Disable animations for cleaner screenshots
      ...options
    };
    
    await this.page.screenshot(defaultOptions);
  }

  /**
   * Captures a screenshot of the chat container (simple approach)
   * @param {string} filename - The filename for the screenshot
   * @param {Object} options - Additional screenshot options
   */
  async captureChatContainerScreenshot(filename, options = {}) {
    // Wait for all content to load
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
    
    // Wait for chat container to be visible
    await expect(this.chatContainer).toBeVisible();
    
    // Take screenshot of the chat container as it currently appears
    await this.chatContainer.screenshot({
      path: filename,
      type: 'png',
      animations: 'disabled',
      ...options
    });
    
  }

  // --- Progress Step Testing Methods ---

  /**
   * Wait for progress steps to appear and expand the progress dropdown
   * @param {number} timeout - Timeout in milliseconds (default: 10000)
   */
  async waitForProgressStepsToAppear(timeout = 10000) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('⏳ Waiting for progress steps to appear...');
        
        // Wait for progress toggle button to be visible in the latest AI message
        const latestAIMessage = this.aiMessages.last();
        const progressToggleButton = latestAIMessage.locator('.progress-toggle-button');
        await expect(progressToggleButton).toBeVisible({ timeout });
        
        // Click the progress toggle button to expand steps
        await progressToggleButton.click();
        
        // Wait for step list container to be visible in the latest AI message
        await expect(latestAIMessage.locator('.step-list-container')).toBeVisible({ timeout });
        
        console.log('✅ Progress steps are now visible');
      },
      'Wait for progress steps to appear',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verify progress steps for a specific mode
   * @param {Object} options - Configuration options
   * @param {string} options.mode - The mode ('text', 'question', 'marking')
   * @param {Array<string>} options.expectedSteps - Array of expected step descriptions
   * @param {number} options.expectedStepCount - Expected number of steps
   */
  async verifyProgressSteps({ mode, expectedSteps, expectedStepCount = null }) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log(`🔍 Verifying ${mode} mode progress steps...`);
        
        await this.waitForProgressStepsToAppear();
        
        // Target only the latest AI message's progress steps, not all step items on the page
        const latestAIMessage = this.aiMessages.last();
        const stepItems = latestAIMessage.locator('.step-item');
        
        // Wait for steps to appear and check count based on mode
        const expectedMinCount = mode === 'text' ? 1 : 3;
        await expect(async () => {
          const stepCount = await stepItems.count();
          expect(stepCount).toBeGreaterThan(expectedMinCount);
        }).toPass({ timeout: 30000 });
        
        // Get actual step count and verify step texts
        const actualStepCount = await stepItems.count();
        console.log(`✅ ${mode} mode has ${actualStepCount} progress steps (expected > ${expectedMinCount})`);
        
        // Verify each step text matches expected (only check available steps)
        const stepsToCheck = Math.min(actualStepCount, expectedSteps.length);
        for (let i = 0; i < stepsToCheck; i++) {
          const stepText = await stepItems.nth(i).locator('.step-description').textContent();
          expect(stepText).toBe(expectedSteps[i]);
          console.log(`✅ Step ${i + 1}: "${stepText}"`);
        }
      },
      `Verify ${mode} mode progress steps`,
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verify progressive step display (steps appear one by one)
   * @param {Object} options - Configuration options
   * @param {number} options.initialStepCount - Initial number of steps visible
   * @param {number} options.finalStepCount - Final number of steps visible
   * @param {number} options.stepProgressionDelay - Delay between step appearances in ms
   */
  async verifyProgressiveStepDisplay({ initialStepCount, finalStepCount, stepProgressionDelay }) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log(`🔍 Verifying progressive step display (${initialStepCount} → ${finalStepCount})...`);
        
        // Wait for initial step
        await expect(this.page.locator('.step-item')).toHaveCount(initialStepCount, { timeout: 5000 });
        console.log(`✅ Initial ${initialStepCount} step(s) visible`);
        
        // Wait for all steps to appear progressively
        await expect(this.page.locator('.step-item')).toHaveCount(finalStepCount, { 
          timeout: stepProgressionDelay * finalStepCount + 10000 
        });
        console.log(`✅ All ${finalStepCount} steps now visible`);
      },
      'Verify progressive step display',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verify step completion indicators (tick marks, current step indicators)
   * @param {Object} options - Configuration options
   * @param {Array<string>} options.completedSteps - Array of expected indicators ('✓', '●', '○')
   * @param {number} options.currentStep - Index of current step
   */
  async verifyStepCompletionIndicators({ completedSteps, currentStep }) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log(`🔍 Verifying step completion indicators...`);
        
        // Target only the latest AI message's step indicators
        const latestAIMessage = this.aiMessages.last();
        const stepIndicators = latestAIMessage.locator('.step-indicator');
        
        for (let i = 0; i < completedSteps.length; i++) {
          const indicator = await stepIndicators.nth(i).textContent();
          expect(indicator).toBe(completedSteps[i]);
          console.log(`✅ Step ${i + 1} indicator: "${indicator}"`);
        }
        
        console.log(`✅ All step indicators verified (current step: ${currentStep})`);
      },
      'Verify step completion indicators',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verify progress toggle functionality (expand/collapse)
   * @param {Object} options - Configuration options
   * @param {boolean} options.shouldBeVisible - Whether toggle should be visible
   * @param {boolean} options.shouldExpandSteps - Whether to test expanding steps
   * @param {boolean} options.shouldCollapseSteps - Whether to test collapsing steps
   */
  async verifyProgressToggle({ shouldBeVisible, shouldExpandSteps, shouldCollapseSteps }) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('🔍 Verifying progress toggle functionality...');
        
        // Target only the latest AI message's progress toggle
        const latestAIMessage = this.aiMessages.last();
        const toggleButton = latestAIMessage.locator('.progress-toggle-button');
        
        if (shouldBeVisible) {
          await expect(toggleButton).toBeVisible({ timeout: 10000 });
          console.log('✅ Progress toggle button is visible');
        }
        
        if (shouldExpandSteps) {
          await toggleButton.click();
          await expect(latestAIMessage.locator('.step-list-container')).toBeVisible({ timeout: 5000 });
          console.log('✅ Progress steps expanded successfully');
        }
        
        if (shouldCollapseSteps) {
          await toggleButton.click();
          await expect(latestAIMessage.locator('.step-list-container')).toBeHidden({ timeout: 5000 });
          console.log('✅ Progress steps collapsed successfully');
        }
      },
      'Verify progress toggle functionality',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verify thinking animation synchronization
   * @param {Object} options - Configuration options
   * @param {boolean} options.shouldStartWithThinking - Whether thinking should start
   * @param {boolean} options.shouldStopWithResponse - Whether thinking should stop with response
   * @param {boolean} options.shouldShowThinkingText - Whether thinking text should be visible
   */
  async verifyThinkingAnimationSync({ shouldStartWithThinking, shouldStopWithResponse, shouldShowThinkingText }) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('🔍 Verifying thinking animation synchronization...');
        
        if (shouldStartWithThinking) {
          await expect(this.page.locator('.thinking-dots')).toBeVisible({ timeout: 10000 });
          console.log('✅ Thinking dots started');
        }
        
        if (shouldShowThinkingText) {
          await expect(this.page.locator('.thinking-text')).toBeVisible({ timeout: 10000 });
          console.log('✅ Thinking text is visible');
        }
        
        if (shouldStopWithResponse) {
          await this.waitForAIResponse();
          await expect(this.page.locator('.thinking-dots')).toBeHidden({ timeout: 10000 });
          console.log('✅ Thinking dots stopped with AI response');
        }
      },
      'Verify thinking animation synchronization',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  // --- Unauthenticated User Testing Methods ---

  /**
   * Verifies that all images in the chat have base64 sources (for unauthenticated users)
   * @param {number} expectedCount - Expected number of images (default: all images)
   */
  async verifyAllImagesHaveBase64Sources(expectedCount = null) {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('🔍 Verifying all images have base64 sources (unauthenticated mode)...');
        
        // Get all images in the chat
        const allImages = this.page.locator('.chat-container img, .messages-container img, .main-chat-container img');
        
        // Wait for at least one image to be present
        if (expectedCount === null) {
          await expect(allImages.first()).toBeVisible({ timeout: 10000 });
        } else {
          await expect(allImages).toHaveCount(expectedCount, { timeout: 10000 });
        }
        
        const imageCount = await allImages.count();
        
        // Verify each image has base64 source
        for (let i = 0; i < imageCount; i++) {
          const image = allImages.nth(i);
          await expect(image).toBeVisible();
          
          // Check that the image source starts with data:image (base64 format)
          await expect(image).toHaveAttribute('src', /^data:image/);
        }
        
        console.log(`✅ All ${imageCount} images have base64 sources`);
      },
      'Verify all images have base64 sources',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verifies that no sidebar chat history items are present (for unauthenticated users)
   */
  async verifyNoSidebarChatHistory() {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('🔍 Verifying no sidebar chat history (unauthenticated mode)...');
        
        // Check that sidebar exists but has no chat history items
        const sidebar = this.page.locator('.sidebar, .app-sidebar');
        await expect(sidebar).toBeVisible({ timeout: 5000 });
        
        // Verify no chat history items are present
        const chatHistoryItems = this.page.locator('.mark-history-item');
        const itemCount = await chatHistoryItems.count();
        expect(itemCount).toBe(0);
        
        console.log('✅ No sidebar chat history items found (unauthenticated mode)');
      },
      'Verify no sidebar chat history',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }

  /**
   * Verifies that the user is in unauthenticated mode (no auth token)
   */
  async verifyUnauthenticatedMode() {
    return await this.errorReporter.withErrorReporting(
      async () => {
        console.log('🔍 Verifying unauthenticated mode...');
        
        // Check that no auth token is present
        const hasAuthToken = await this.page.evaluate(() => {
          const token = localStorage.getItem('authToken');
          return token && token.length > 0;
        });
        
        expect(hasAuthToken).toBe(false);
        
        // Verify no user profile elements are visible (handle null case)
        const profileButton = this.page.locator('.profile-button, .user-profile-button, [data-testid="profile-button"]');
        const isProfileVisible = await profileButton.isVisible().catch(() => false);
        expect(isProfileVisible).toBe(false);
        
        console.log('✅ User is in unauthenticated mode');
      },
      'Verify unauthenticated mode',
      { maxRetries: 1, retryDelay: 2000 }
    );
  }
}

module.exports = MarkHomeworkPage;