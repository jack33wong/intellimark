/**
 * Example: How to use debug parameters in e2e tests
 * 
 * This file shows how to add debug parameters to API calls during testing.
 * The debug parameters will be sent to the backend API endpoints.
 */

const { test, expect } = require('@playwright/test');
const { MarkHomeworkPage } = require('./pages/MarkHomeworkPage');
const { TestData } = require('./utils/TestData');

test.describe('Debug Parameter Examples', () => {
  let markHomeworkPage;

  test.beforeEach(async ({ page }) => {
    markHomeworkPage = new MarkHomeworkPage(page);
    await markHomeworkPage.navigateToMarkHomework();
    // Debug mode is automatically enabled in navigateToMarkHomework()
  });

  test('Example 1: Basic debug mode (already enabled)', async ({ page }) => {
    // Debug mode is automatically enabled
    // All API calls will include: debug: true
    
    await markHomeworkPage.uploadImage(TestData.images.q21);
    await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
    await markHomeworkPage.waitForThinkingComplete('marking');
  });

  test('Example 2: Add custom debug parameters', async ({ page }) => {
    // Add custom debug parameters
    await markHomeworkPage.addDebugParameters({
      testId: 'debug-test-001',
      verbose: true,
      logLevel: 'debug',
      traceId: 'trace-' + Date.now()
    });
    
    await markHomeworkPage.uploadImage(TestData.images.q21);
    await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
    await markHomeworkPage.waitForThinkingComplete('marking');
  });

  test('Example 3: Disable debug mode for specific test', async ({ page }) => {
    // Disable debug mode for this test
    await markHomeworkPage.setDebugMode(false);
    
    await markHomeworkPage.uploadImage(TestData.images.q21);
    await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
    await markHomeworkPage.waitForThinkingComplete('marking');
  });

  test('Example 4: Enable debug mode with specific parameters', async ({ page }) => {
    // Enable debug mode with specific parameters
    await markHomeworkPage.setDebugMode(true);
    await markHomeworkPage.addDebugParameters({
      testScenario: 'marking-mode-debug',
      enableDetailedLogs: true,
      saveIntermediateResults: true
    });
    
    await markHomeworkPage.uploadImage(TestData.images.q21);
    await markHomeworkPage.sendTextMessage(TestData.messages.mathQuestion);
    await markHomeworkPage.waitForThinkingComplete('marking');
  });
});

/**
 * How debug parameters work:
 * 
 * 1. Debug mode is enabled by setting localStorage.setItem('debugMode', 'true')
 * 2. The frontend checks this value and sends debug: true in API requests
 * 3. Custom debug parameters can be added via localStorage.setItem('debugParams', JSON.stringify({...}))
 * 4. The backend receives these parameters and can use them for debugging
 * 
 * API Request Example:
 * {
 *   "imageData": "...",
 *   "userId": "...",
 *   "debug": true,
 *   "sessionId": "...",
 *   "model": "auto",
 *   "mode": "marking"
 * }
 * 
 * Backend can access these parameters to:
 * - Enable verbose logging
 * - Save intermediate processing steps
 * - Add detailed error information
 * - Track test execution
 */
