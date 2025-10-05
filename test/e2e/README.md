# End-to-End Test Suite

This directory contains comprehensive end-to-end tests for the IntelliMark application using Playwright.

## Overview

The e2e test suite validates the complete user journey for authenticated users marking homework, ensuring all core functionality works correctly from UI interactions to database persistence.

## Test Structure

```
test/e2e/
├── pages/                    # Page Object Model classes
│   ├── LoginPage.js         # Login page interactions
│   ├── MarkHomeworkPage.js  # Main marking homework page
│   └── SidebarPage.js       # Sidebar navigation and chat history
├── utils/
│   └── DatabaseHelper.js    # Database verification utilities
├── test-data/
│   ├── q19.png             # Initial test image (past exam paper)
│   └── q21.png             # Follow-up test image
├── playwright.config.js     # Playwright configuration
└── marking-homework-e2e.spec.js  # Main comprehensive test
```

## Test Account

- **Email**: `admin@intellimark.com`
- **Password**: `123456`
- **UID**: `GdH3EGZ4mLQrBO5w20seIzbqVKv1`

## Prerequisites

1. **Backend running**: `cd backend && npm run dev` (port 5001)
2. **Frontend running**: `cd frontend && npm start` (port 3000)
3. **Dependencies installed**: `npm install playwright`
4. **Test images**: `q19.png` and `q21.png` in `test-data/` folder

## Test Scenarios

### Main Test: Authenticated User Marking Homework

**File**: `marking-homework-e2e.spec.js`

**Test Flow**:
1. **Pre-test Cleanup**: Clean up UnifiedSessions with userId "GdH3EGZ4mLQrBO5w20seIzbqVKv1"
2. **Login**: Authenticate with admin account
3. **Navigate**: Go to `http://localhost:3000/mark-homework`
4. **Initial Upload**: Upload `q19.png` image
5. **Text Input**: Send text "Can you help e2e with this math problem"
6. **UI Verification**: 
   - Immediate display of user input (text + image)
   - AI thinking animation appears
   - AI response appended to chat
7. **Header Verification**:
   - Chat header title updated (length > 10, not "Processing")
   - Task details stats updated
8. **Sidebar Verification**:
   - New chat message history added
   - Exactly 1 new chat history item
9. **Follow-up Test**:
   - Send follow-up text: "Can you help e2e with this follow up?"
   - Upload follow-up image: `q21.png`
   - Verify immediate UI updates
   - Verify AI thinking animation
   - Verify AI response sequence
10. **Database Verification**:
    - Verify 4 UnifiedMessages in UnifiedSession
    - Verify message persistence
11. **Sidebar Navigation**:
    - Click on new chat history item
    - Verify exactly 4 messages in correct order
12. **Post-test Cleanup**: Clean up UnifiedSessions with userId "GdH3EGZ4mLQrBO5w20seIzbqVKv1"

## Page Object Model

### LoginPage.js
- `navigateToLogin()`
- `enterEmail(email)`
- `enterPassword(password)`
- `clickLogin()`
- `waitForLoginSuccess()`

### MarkHomeworkPage.js
- `navigateToMarkHomework()`
- `uploadImage(imagePath)`
- `enterText(text)`
- `sendMessage()`
- `waitForUserMessage()`
- `waitForAIThinking()`
- `waitForAIResponse()`
- `getChatHeaderTitle()`
- `getTaskDetailsStats()`
- `getMessageCount()`
- `getMessageSequence()`

### SidebarPage.js
- `getChatHistoryCount()`
- `getNewestChatHistoryItem()`
- `clickChatHistoryItem(index)`
- `waitForChatLoad()`

### DatabaseHelper.js
- `connectToFirestore()`
- `getUnifiedSession(sessionId)`
- `getUnifiedMessages(sessionId)`
- `verifyMessageCount(sessionId, expectedCount)`
- `verifyMessageSequence(sessionId, expectedSequence)`
- `cleanupUnifiedSessions(userId)` - Clean up all UnifiedSessions for a specific user
- `getUnifiedSessionsByUserId(userId)` - Get all UnifiedSessions for a user
- `deleteUnifiedSession(sessionId)` - Delete a specific UnifiedSession

## Configuration

### playwright.config.js
```javascript
module.exports = {
  testDir: './',
  timeout: 60000, // 60 seconds max
  retries: 2,
  use: {
    headless: false, // Set to true for CI
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
};
```

## Running Tests

### Install Dependencies
```bash
cd test/e2e
npm install playwright
npx playwright install
```

### Run All Tests
```bash
npx playwright test
```

### Run Specific Test
```bash
npx playwright test marking-homework-e2e.spec.js
```

### Run with UI Mode
```bash
npx playwright test --ui
```

### Run in Headed Mode
```bash
npx playwright test --headed
```

## Test Data

### Images
- **q19.png**: Past exam paper image for initial upload
- **q21.png**: Follow-up image for testing message sequences

### Text Inputs
- **Initial**: "Can you help e2e with this math problem"
- **Follow-up**: "Can you help e2e with this follow up?"

## Expected Results

### Pre-test Cleanup
- ✅ All existing UnifiedSessions for userId "GdH3EGZ4mLQrBO5w20seIzbqVKv1" are removed
- ✅ Clean database state before test execution

### UI Verification
- ✅ User inputs display immediately
- ✅ AI thinking animation appears
- ✅ AI responses append correctly
- ✅ Chat header title: meaningful content (length > 10, not "Processing")
- ✅ Task details stats updated
- ✅ Sidebar shows 1 new chat history item

### Database Verification
- ✅ 4 UnifiedMessages in UnifiedSession
- ✅ Messages persist correctly
- ✅ Message sequence is correct

### Navigation Verification
- ✅ Sidebar chat history clickable
- ✅ 4 messages display in correct order
- ✅ Message content matches database

### Post-test Cleanup
- ✅ All test UnifiedSessions for userId "GdH3EGZ4mLQrBO5w20seIzbqVKv1" are removed
- ✅ Database returned to clean state
- ✅ No test data left in production database

## Error Handling

- **Continue on Failure**: Tests continue running even if individual steps fail
- **Comprehensive Reporting**: All failures are reported at the end
- **Retry Logic**: Built-in retry for flaky operations
- **Timeout Handling**: 60-second maximum wait for AI responses

## Debugging

### Debug Mode
```bash
npx playwright test --debug
```

### Backend API Debug Mode
The e2e tests automatically enable debug mode for the `/api/mark-homework/process-single-stream` endpoint by setting `localStorage.setItem('debugMode', 'true')`. This enables additional debugging information in the backend API processing.

**Debug Mode Features:**
- Enhanced logging in backend API processing
- Additional debugging information for AI processing
- Better error reporting and diagnostics
- Detailed request/response logging

### Screenshots
Screenshots are automatically captured on failure in `test-results/`

### Videos
Videos are recorded for failed tests in `test-results/`

### Console Logs
Browser console logs are captured and displayed for debugging

## Maintenance

### Adding New Tests
1. Create new page object in `pages/` if needed
2. Add test scenarios to existing spec files
3. Update this README with new test descriptions

### Updating Test Data
1. Add new test images to `test-data/`
2. Update text inputs as needed
3. Update expected results in this README

### Database Changes
1. Update `DatabaseHelper.js` for schema changes
2. Update verification methods
3. Update expected message counts and sequences
