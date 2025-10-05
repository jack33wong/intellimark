#!/usr/bin/env node

/**
 * Test Environment Setup Script
 * 
 * This script checks if the test environment is ready:
 * - Backend is running on port 5001
 * - Frontend is running on port 3000
 * - Test image exists
 * - Dependencies are installed
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Check if a service is running on a port
function checkPort(port, serviceName) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: port,
      path: '/health',
      method: 'GET',
      timeout: 2000
    }, (res) => {
      log(`✅ ${serviceName} is running on port ${port}`, 'green');
      resolve(true);
    });

    req.on('error', () => {
      log(`❌ ${serviceName} is not running on port ${port}`, 'red');
      resolve(false);
    });

    req.on('timeout', () => {
      log(`⏰ ${serviceName} timeout on port ${port}`, 'yellow');
      resolve(false);
    });

    req.end();
  });
}

// Check if file exists
function checkFile(filePath, description) {
  if (fs.existsSync(filePath)) {
    log(`✅ ${description} exists: ${filePath}`, 'green');
    return true;
  } else {
    log(`❌ ${description} missing: ${filePath}`, 'red');
    return false;
  }
}

// Check if dependencies are installed
function checkDependencies() {
  try {
    require('puppeteer');
    log('✅ Puppeteer is installed', 'green');
    return true;
  } catch (error) {
    log('❌ Puppeteer is not installed', 'red');
    log('   Run: npm install puppeteer', 'yellow');
    return false;
  }
}

// Main setup check
async function checkSetup() {
  log('\n🔧 IntelliMark Test Environment Setup Check', 'bold');
  log('='.repeat(50));
  
  let allGood = true;
  
  // Check backend
  log('\n📋 Checking Backend...', 'blue');
  const backendRunning = await checkPort(5001, 'Backend');
  if (!backendRunning) {
    log('   Start backend: cd backend && npm run dev', 'yellow');
    allGood = false;
  }
  
  // Check frontend
  log('\n📋 Checking Frontend...', 'blue');
  const frontendRunning = await checkPort(3000, 'Frontend');
  if (!frontendRunning) {
    log('   Start frontend: cd frontend && npm start', 'yellow');
    allGood = false;
  }
  
  // Check test image
  log('\n📋 Checking Test Files...', 'blue');
  const projectRoot = path.join(__dirname, '..', '..');
  const testImageExists = checkFile(
    path.join(projectRoot, 'q19.png'),
    'Test image (q19.png)'
  );
  if (!testImageExists) {
    allGood = false;
  }
  
  // Check dependencies
  log('\n📋 Checking Dependencies...', 'blue');
  const depsInstalled = checkDependencies();
  if (!depsInstalled) {
    allGood = false;
  }
  
  // Summary
  log('\n📊 Setup Check Summary', 'bold');
  log('='.repeat(50));
  
  if (allGood) {
    log('🎉 All checks passed! Test environment is ready.', 'green');
    log('\n📋 Test Account: admin@intellimark.com / 123456', 'blue');
    log('📋 Run tests: node run-tests.js', 'blue');
  } else {
    log('❌ Some checks failed. Please fix the issues above.', 'red');
    log('\n📋 Quick setup commands:', 'yellow');
    log('   Backend:  cd backend && npm run dev', 'yellow');
    log('   Frontend: cd frontend && npm start', 'yellow');
    log('   Install:  npm install puppeteer', 'yellow');
  }
  
  return allGood;
}

// Run if called directly
if (require.main === module) {
  checkSetup().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { checkSetup };





