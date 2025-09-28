# E2E Regression Tests

Comprehensive end-to-end regression tests for the marking homework functionality covering all modes, flows, and authentication states.

## Test Structure

### Files
- `authenticated-flow-tests.spec.js` - Tests for authenticated users with integrated scroll and thinking text verification
- `unauthenticated-flow-tests.spec.js` - Tests for unauthenticated users (UI behavior only)
- `pages/` - Page object models for test organization
- `utils/TestData.js` - Test data and expected values

## Detailed Test Cases

### Authenticated Users (A001-A006)

#### A001: First-time marking with image + text (Authenticated)
**Input:**
- Image: `step6-full-page.jpg`
- Text: `"What is 2 + 2?"`
- Initial scroll position: Middle of screen
- Auth status: Logged in

**Expected Results:**
- **Progress Steps**: 
  1. "Analyzing image..."
  2. "Detecting question type..."
  3. "Extracting text and math..."
  4. "Generating feedback..."
  5. "Creating annotations..."
  6. "Finalizing response..."
  7. "Almost done..."
- **Thinking Text**: Shows current step during processing → "Show thinking" when complete
- **Scroll Behavior**: NO auto-scroll (user is in middle position)
- **Final State**: Annotated image + AI response + "Show thinking" toggle
- **Data Persistence**: Saved to database, session maintained

#### A002: Follow-up marking with image + text (Authenticated)
**Input:**
- First submission: `step6-full-page.jpg` + `"What is 2 + 2?"`
- Follow-up: `q19.png` + `"Can you help me solve this algebra problem?"`
- Auth status: Logged in

**Expected Results:**
- **Progress Steps**: Same as A001
- **Thinking Text**: Same as A001
- **Scroll Behavior**: Same as A001
- **Final State**: Same as A001
- **Data Persistence**: Both messages in same session, persisted to database

#### A003: First-time question with image only (Authenticated)
**Input:**
- Image: `step6-full-page.jpg`
- Text: None (image only)
- Initial scroll position: Middle of screen
- Auth status: Logged in

**Expected Results:**
- **Progress Steps**: 
  1. "Analyzing image..."
  2. "Detecting question type..."
  3. "Generating response..."
- **Thinking Text**: Shows current step during processing → "Show thinking" when complete
- **Scroll Behavior**: NO auto-scroll (user is in middle position)
- **Final State**: AI response + "Show thinking" toggle (no annotated image)
- **Data Persistence**: Saved to database, session maintained

#### A004: Follow-up question with image only (Authenticated)
**Input:**
- First submission: `step6-full-page.jpg` (image only)
- Follow-up: `q19.png` (image only)
- Auth status: Logged in

**Expected Results:**
- **Progress Steps**: Same as A003
- **Thinking Text**: Same as A003
- **Scroll Behavior**: Same as A003
- **Final State**: Same as A003
- **Data Persistence**: Both messages in same session, persisted to database

#### A005: First-time chat with text only (Authenticated)
**Input:**
- Text: `"What is 2 + 2?"`
- Initial scroll position: Middle of screen
- Auth status: Logged in

**Expected Results:**
- **Progress Steps**: 
  1. "Processing your question..."
  2. "Generating response..."
- **Thinking Text**: Shows current step during processing → "Show thinking" when complete
- **Scroll Behavior**: AUTO-SCROLL to bottom (text-only always scrolls)
- **Final State**: AI response + "Show thinking" toggle
- **Data Persistence**: Saved to database, session maintained

#### A006: Follow-up chat with text only (Authenticated)
**Input:**
- First submission: `"What is 2 + 2?"`
- Follow-up: `"Can you help me solve this algebra problem?"`
- Auth status: Logged in

**Expected Results:**
- **Progress Steps**: Same as A005
- **Thinking Text**: Same as A005
- **Scroll Behavior**: Same as A005 (auto-scroll)
- **Final State**: Same as A005
- **Data Persistence**: Both messages in same session, persisted to database

### Unauthenticated Users (U001-U006)

#### U001: First-time marking with image + text (Unauthenticated)
**Input:**
- Image: `step6-full-page.jpg`
- Text: `"What is 2 + 2?"`
- Initial scroll position: Middle of screen
- Auth status: Not logged in

**Expected Results:**
- **Progress Steps**: Same as A001
- **Thinking Text**: Same as A001
- **Scroll Behavior**: Same as A001 (no auto-scroll)
- **Final State**: Same as A001
- **Data Persistence**: NOT saved to database, session lost on refresh

#### U002-U006: Follow-up and other modes (Unauthenticated)
**Expected Results:**
- **UI Behavior**: Identical to authenticated users
- **Data Persistence**: NOT saved to database, session lost on refresh
- **Session Management**: Each follow-up creates new temporary session

## Scroll Behavior Test Cases

### S001: Image upload from middle position
**Input:**
- Mode: Marking/Question
- Initial position: Middle of screen (scrollTop = scrollHeight/2)
- Action: Upload image + text or image only

**Expected Result:**
- NO auto-scroll occurs
- Final scroll position remains in middle
- User stays at current scroll position

### S002: Image upload from near bottom
**Input:**
- Mode: Marking/Question
- Initial position: Near bottom (scrollTop > scrollHeight - clientHeight - 100px)
- Action: Upload image + text or image only

**Expected Result:**
- AUTO-SCROLL to bottom occurs
- Final scroll position at bottom (within 50px tolerance)
- User sees the new content

### S003: Text-only from middle position
**Input:**
- Mode: Chat
- Initial position: Middle of screen
- Action: Send text message

**Expected Result:**
- AUTO-SCROLL to bottom occurs (text-only always scrolls)
- Final scroll position at bottom (within 50px tolerance)
- User sees the new content

### S004: Text-only from near bottom
**Input:**
- Mode: Chat
- Initial position: Near bottom
- Action: Send text message

**Expected Result:**
- AUTO-SCROLL to bottom occurs
- Final scroll position at bottom (within 50px tolerance)
- User sees the new content

### S005: Progress toggle scroll behavior
**Input:**
- Action: Click progress toggle on last message
- Initial position: Any position

**Expected Result:**
- Smart scroll behavior
- Scrolls only if content extends below viewport
- May or may not scroll depending on content height

## Thinking Text Transition Test Cases

### T001: Marking mode thinking text progression
**Input:**
- Mode: Marking (image + text)
- Action: Upload image with text

**Expected Progression:**
1. "Analyzing image..." (immediate)
2. "Detecting question type..." (after step 1)
3. "Extracting text and math..." (after step 2)
4. "Generating feedback..." (after step 3)
5. "Creating annotations..." (after step 4)
6. "Finalizing response..." (after step 5)
7. "Almost done..." (after step 6)
8. "Show thinking" (final state with toggle)

### T002: Question mode thinking text progression
**Input:**
- Mode: Question (image only)
- Action: Upload image only

**Expected Progression:**
1. "Analyzing image..." (immediate)
2. "Detecting question type..." (after step 1)
3. "Generating response..." (after step 2)
4. "Show thinking" (final state with toggle)

### T003: Chat mode thinking text progression
**Input:**
- Mode: Chat (text only)
- Action: Send text message

**Expected Progression:**
1. "Processing your question..." (immediate)
2. "Generating response..." (after step 1)
3. "Show thinking" (final state with toggle)

## Progress Data Structure Test Cases

### P001: During processing
**Input:**
- Any mode during real-time processing

**Expected Structure:**
```javascript
{
  allSteps: ["step1", "step2", "step3"],
  isComplete: false,
  currentStepDescription: "current step text"
}
```

### P002: After completion
**Input:**
- Any mode after AI response completes

**Expected Structure:**
```javascript
{
  allSteps: ["step1", "step2", "step3"],
  isComplete: true
}
```

## Comprehensive Flow Test

### CF001: Complete flow test with all modes
**Input:**
- Multiple submissions in sequence:
  1. Marking mode (image + text) from middle
  2. Question mode (image only) from middle
  3. Chat mode (text only) from middle
  4. Image upload from near bottom
  5. Progress toggle click

**Expected Results:**
- **Test 1**: Marking mode - no auto-scroll from middle
- **Test 2**: Question mode - no auto-scroll from middle
- **Test 3**: Chat mode - auto-scroll from middle
- **Test 4**: Image upload - auto-scroll from near bottom
- **Test 5**: Progress toggle - smart scroll behavior
- **Test 6**: Session persistence - all messages in same session

## Expected Behaviors Summary

### Scroll Behavior
- **Text-only submissions**: Always auto-scroll to bottom
- **Image submissions**: Only auto-scroll when user is near bottom (<100px)
- **Progress toggle**: Smart scroll only if content extends below viewport

### Thinking Text
- **During processing**: Shows current step description
- **After completion**: Shows "Show thinking" with toggle
- **Progress steps**: Appear progressively during real-time processing

### Progress Data Structure
- **During processing**: `{allSteps: [...], isComplete: false, currentStepDescription: "..."}`
- **After completion**: `{allSteps: [...], isComplete: true}`

### Authentication Differences
- **Authenticated**: Data persisted, session maintained across refreshes
- **Unauthenticated**: No persistence, session lost on refresh
- **UI Behavior**: Identical for both auth states

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx playwright test authenticated-flow-tests.spec.js

# Run with UI
npm run test:headed

# Debug mode
npm run test:debug
```

## Test Data

Test images and messages are defined in `utils/TestData.js`:
- Images: step6-full-page.jpg, q19.png, q21.png
- Messages: Math, algebra, geometry questions
- Expected progress steps for each mode
- Scroll test scenarios
