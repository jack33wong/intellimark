#!/usr/bin/env node

/**
 * Test Runner for IntelliMark Frontend Tests
 * 
 * Usage:
 *   node run-tests.js                    # Run all tests
 *   node run-tests.js auth               # Run authentication tests
 *   node run-tests.js core               # Run core functionality tests
 *   node run-tests.js database           # Run database persistence tests
 *   node run-tests.js session            # Run session management tests
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Test categories
const testCategories = {
  auth: [
    'test-email-password-auth.js',
    'test-admin-profile-issue.js',
    'test-user-id-mismatch.js'
  ],
  core: [
    'test-auth-flow.js',
    'test-authenticated-user-comprehensive.js'
  ],
  database: [
    'test-duplicate-fix-simple.js',
    'test-follow-up-duplicate-fix.js',
    'test-authenticated-duplicate-fix.js'
  ],
  session: [
    'test-session-cache.js',
    'test-session-id-consistency.js',
    'test-session-id-fix.js',
    'test-favorite-persistence.js'
  ],
  debug: [
    'test-debug-simple.js',
    'test-hook-debug.js',
    'test-debug-page.js'
  ],
  page: [
    'test-page-load.js',
    'test-simple-load.js'
  ],
  state: [
    'test-frontend-state-flow.js',
    'test-unified-session.js'
  ],
  classification: [
    'test-question-only-upload.js',
    'test-question-only-simple.js',
    'test-question-only-node.js'
  ]
};

// Get all test files
function getAllTestFiles() {
  return fs.readdirSync(__dirname)
    .filter(file => file.startsWith('test-') && file.endsWith('.js'))
    .filter(file => file !== 'run-tests.js');
}

// Run a single test
function runTest(testFile) {
  console.log(`\n🧪 Running ${testFile}...`);
  console.log('='.repeat(50));

  try {
    const result = execSync(`node ${testFile}`, {
      cwd: __dirname,
      stdio: 'inherit',
      timeout: 60000 // 60 second timeout
    });
    console.log(`✅ ${testFile} passed`);
    return true;
  } catch (error) {
    console.log(`❌ ${testFile} failed`);
    if (error.status !== 0) {
      console.log(`Exit code: ${error.status}`);
    }
    return false;
  }
}

// Run tests by category
function runCategory(category) {
  const tests = testCategories[category];
  if (!tests) {
    console.log(`❌ Unknown category: ${category}`);
    console.log(`Available categories: ${Object.keys(testCategories).join(', ')}`);
    return;
  }

  console.log(`\n🚀 Running ${category} tests...`);
  console.log(`Tests: ${tests.join(', ')}`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    if (fs.existsSync(path.join(__dirname, test))) {
      if (runTest(test)) {
        passed++;
      } else {
        failed++;
      }
    } else {
      console.log(`⚠️  Test file not found: ${test}`);
    }
  }

  console.log(`\n📊 ${category} tests completed: ${passed} passed, ${failed} failed`);
}

// Run all tests
function runAllTests() {
  const allTests = getAllTestFiles();
  console.log(`\n🚀 Running all tests (${allTests.length} files)...`);

  let passed = 0;
  let failed = 0;

  for (const test of allTests) {
    if (runTest(test)) {
      passed++;
    } else {
      failed++;
    }
  }

  console.log(`\n📊 All tests completed: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log('❌ Some tests failed. Check the output above for details.');
  }
}

// Main function
function main() {
  const args = process.argv.slice(2);
  const category = args[0];

  console.log('🧪 AI Marking Frontend Test Runner');
  console.log('📋 Test Account: admin@intellimark.com / 123456');
  console.log('📋 Make sure backend (port 5001) and frontend (port 3000) are running');

  if (!category) {
    runAllTests();
  } else {
    runCategory(category);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { runAllTests, runCategory, runTest };

