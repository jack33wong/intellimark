# Frontend Test Suite

This folder contains automated tests for the IntelliMark frontend application using Puppeteer.

## Test Account

All tests use the following test account:
- **Email**: `admin@intellimark.com`
- **Password**: `123456`
- **UID**: `GdH3EGZ4mLQrBO5w20seIzbqVKv1`

## Prerequisites

1. **Backend running**: `cd backend && npm run dev` (port 5001)
2. **Frontend running**: `cd frontend && npm start` (port 3000)
3. **Test image**: `q19.png` in the project root
4. **Dependencies**: `npm install puppeteer` in the project root

## Test Files

### Core Functionality Tests

#### `test-auth-flow.js`
- **Purpose**: Tests authentication flow for both authenticated and unauthenticated users
- **What it tests**: 
  - Login with email/password
  - Immediate image display
  - AI thinking animation
  - Message count and types
- **Expected**: Both flows should behave identically

#### `test-authenticated-user-comprehensive.js`
- **Purpose**: Comprehensive test for authenticated users
- **What it tests**:
  - Email/password authentication
  - Image upload and processing
  - Database persistence
  - Session management
- **Expected**: All test cases pass same as unauthenticated users, plus database persistence

### State Management Tests

#### `test-debug-simple.js`
- **Purpose**: Basic component loading test
- **What it tests**: MarkHomeworkPageConsolidated component loads correctly
- **Expected**: Component loads without errors

#### `test-hook-debug.js`
- **Purpose**: Tests useMarkHomework hook functionality
- **What it tests**: Hook state management and transitions
- **Expected**: Hook works correctly

### Database Persistence Tests

#### `test-duplicate-fix-simple.js`
- **Purpose**: Tests that initial uploads don't create duplicate records
- **What it tests**: Single record creation for initial uploads
- **Expected**: Only one record in database

#### `test-follow-up-duplicate-fix.js`
- **Purpose**: Tests that follow-up uploads don't create duplicate records
- **What it tests**: Follow-up upload reuses existing session
- **Expected**: No duplicate records for follow-up uploads

#### `test-authenticated-duplicate-fix.js`
- **Purpose**: Tests authenticated user duplicate prevention
- **What it tests**: Authenticated user follow-up uploads
- **Expected**: No duplicate records for authenticated users

### Session Management Tests

#### `test-session-cache.js`
- **Purpose**: Tests session caching behavior
- **What it tests**: Session persistence across page reloads
- **Expected**: Sessions persist correctly

#### `test-session-id-consistency.js`
- **Purpose**: Tests session ID consistency
- **What it tests**: Same session ID used for initial and follow-up uploads
- **Expected**: Consistent session ID across uploads

#### `test-session-id-fix.js`
- **Purpose**: Tests session ID passing fix
- **What it tests**: Session ID correctly passed to backend
- **Expected**: Backend receives correct session ID

### Authentication Tests

#### `test-email-password-auth.js`
- **Purpose**: Tests email/password authentication
- **What it tests**: Signup and signin functionality
- **Expected**: Authentication works correctly

#### `test-admin-profile-issue.js`
- **Purpose**: Tests admin profile loading
- **What it tests**: Correct profile loaded for admin user
- **Expected**: Admin profile loads correctly

#### `test-user-id-mismatch.js`
- **Purpose**: Tests user ID mismatch issues
- **What it tests**: User ID consistency in API calls
- **Expected**: No user ID mismatches

### Page Loading Tests

#### `test-page-load.js`
- **Purpose**: Tests basic page loading
- **What it tests**: Pages load without errors
- **Expected**: All pages load successfully

#### `test-simple-load.js`
- **Purpose**: Simple page load test
- **What it tests**: Basic page functionality
- **Expected**: Page loads and functions correctly

#### `test-debug-page.js`
- **Purpose**: Debug page loading issues
- **What it tests**: Page loading with debug information
- **Expected**: Debug information available

### State Flow Tests

#### `test-frontend-state-flow.js`
- **Purpose**: Tests frontend state flow
- **What it tests**: State transitions and UI updates
- **Expected**: State flows correctly

#### `test-unified-session.js`
- **Purpose**: Tests unified session functionality
- **What it tests**: Session creation and management
- **Expected**: Sessions work correctly

### Question Classification Tests

#### `test-question-only-upload.js`
- **Purpose**: Tests uploading a question-only image (q21.png)
- **What it tests**: 
  - Image upload and processing
  - AI classification as question-only
  - Message type determination
  - Session creation with correct messageType
- **Expected**: Image is classified as "Question" not "Marking"

#### `test-question-only-simple.js`
- **Purpose**: Simple browser console test for question-only classification
- **What it tests**: API call with test image and classification verification
- **Expected**: Returns messageType: "Question" for question-only images

## Running Tests

### Run All Tests
```bash
cd frontend/test
for file in test-*.js; do echo "Running $file..."; node $file; done
```

### Run Specific Test
```bash
cd frontend/test
node test-auth-flow.js
```

### Run by Category
```bash
# Authentication tests
node test-email-password-auth.js
node test-admin-profile-issue.js
node test-user-id-mismatch.js

# Core functionality tests
node test-auth-flow.js
node test-authenticated-user-comprehensive.js

# Database persistence tests
node test-duplicate-fix-simple.js
node test-follow-up-duplicate-fix.js
node test-authenticated-duplicate-fix.js

# Question classification tests
node test-question-only-upload.js
node test-question-only-simple.js
```

## Test Environment Setup

1. **Start Backend**:
   ```bash
   cd backend
   npm run dev
   ```

2. **Start Frontend**:
   ```bash
   cd frontend
   npm start
   ```

3. **Run Tests**:
   ```bash
   cd frontend/test
   node test-auth-flow.js
   ```

## Expected Results

- ✅ All tests should pass
- ✅ No console errors
- ✅ Database persistence works for authenticated users
- ✅ UI transitions smoothly
- ✅ No duplicate records created
- ✅ Session management works correctly

## Troubleshooting

### Common Issues

1. **Port 3000/5001 in use**: Kill processes and restart
   ```bash
   lsof -ti:3000 | xargs kill -9
   lsof -ti:5001 | xargs kill -9
   ```

2. **Authentication fails**: Ensure Firebase email/password auth is enabled

3. **Database persistence fails**: Check Firestore service configuration

4. **Image processing fails**: Ensure test image `q19.png` exists in project root

### Debug Mode

Add `headless: false` to Puppeteer launch options to see browser:
```javascript
const browser = await puppeteer.launch({ headless: false });
```

## Test Data

- **Test Image**: `q19.png` (should be in project root)
- **Test Account**: `admin@intellimark.com` / `123456`
- **Expected Session ID Format**: `session-{timestamp}-{random}`
- **Expected Message Count**: 2 (user + AI)

