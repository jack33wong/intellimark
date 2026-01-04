# Frontend Test Suite

This folder contains automated tests for the AI Marking frontend application.

> **Note**: This test suite has been cleaned up. For comprehensive E2E testing, see the `test/e2e-regression/` folder.

## Test Files

### Active Tests

#### `run-tests.js`
- **Purpose**: Test runner for frontend tests
- **Usage**: `node run-tests.js`

#### `setup.js`
- **Purpose**: Test setup and configuration
- **Usage**: Imported by test files

## Prerequisites

1. **Backend running**: `cd backend && npm run dev` (port 5001)
2. **Frontend running**: `cd frontend && npm start` (port 3000)
3. **Dependencies**: `npm install` in the project root

## E2E Testing

For comprehensive end-to-end testing, use the `test/e2e-regression/` folder which contains:
- Authenticated and unauthenticated flow tests
- Complete test coverage for all modes (marking, question, chat)
- Page object models for maintainable tests
- Detailed test specifications and documentation