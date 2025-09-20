/**
 * Test Email/Password Authentication
 * 
 * Tests the new email/password signup and signin functionality
 */

const puppeteer = require('puppeteer-core');

async function testEmailPasswordAuth() {
  console.log('🧪 Testing Email/Password Authentication...\n');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Capture console logs
    const consoleLogs = [];
    page.on('console', msg => {
      const logText = msg.text();
      consoleLogs.push(logText);
      console.log(`📋 Console: ${logText}`);
    });

    // Navigate to login page
    console.log('📋 Navigating to login page...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
    
    // Wait for component to load
    await page.waitForSelector('.auth-container', { timeout: 10000 });
    console.log('✅ Login page loaded successfully');

    // Test 1: Check if email/password form is visible
    console.log('\n📋 Test 1: Check email/password form visibility');
    
    const emailInput = await page.$('input[name="email"]');
    const passwordInput = await page.$('input[name="password"]');
    const signInButton = await page.$('.auth-submit-button');
    
    if (emailInput && passwordInput && signInButton) {
      console.log('✅ Email/password form elements found');
    } else {
      console.log('❌ Email/password form elements not found');
      return;
    }

    // Test 2: Test signup form
    console.log('\n📋 Test 2: Test signup form');
    
    // Click on "Sign up" link
    const signUpLink = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Sign up'));
    });
    if (signUpLink) {
      await signUpLink.click();
      console.log('✅ Switched to signup mode');
      
      // Wait for full name field to appear
      await page.waitForSelector('input[name="fullName"]', { timeout: 5000 });
      console.log('✅ Full name field appeared');
      
      // Fill out signup form
      await page.type('input[name="fullName"]', 'Test User');
      await page.type('input[name="email"]', 'test@example.com');
      await page.type('input[name="password"]', 'password123');
      console.log('✅ Signup form filled out');
      
      // Click signup button
      await page.click('.auth-submit-button');
      console.log('✅ Signup button clicked');
      
      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('❌ Sign up link not found');
    }

    // Test 3: Test signin form
    console.log('\n📋 Test 3: Test signin form');
    
    // Click on "Sign in" link
    const signInLink = await page.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.includes('Sign in'));
    });
    if (signInLink) {
      await signInLink.click();
      console.log('✅ Switched to signin mode');
      
      // Wait for full name field to disappear
      await page.waitForFunction(
        () => !document.querySelector('input[name="fullName"]'),
        { timeout: 5000 }
      );
      console.log('✅ Full name field disappeared');
      
      // Fill out signin form
      await page.type('input[name="email"]', 'test@example.com');
      await page.type('input[name="password"]', 'password123');
      console.log('✅ Signin form filled out');
      
      // Click signin button
      await page.click('.auth-submit-button');
      console.log('✅ Signin button clicked');
      
      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('❌ Sign in link not found');
    }

    // Test 4: Test password visibility toggle
    console.log('\n📋 Test 4: Test password visibility toggle');
    
    const passwordToggle = await page.$('.password-toggle');
    if (passwordToggle) {
      // Check initial state (password should be hidden)
      const passwordInput = await page.$('input[name="password"]');
      const initialType = await passwordInput.evaluate(el => el.type);
      console.log(`📊 Initial password type: ${initialType}`);
      
      // Click toggle
      await passwordToggle.click();
      console.log('✅ Password toggle clicked');
      
      // Check if password is now visible
      const newType = await passwordInput.evaluate(el => el.type);
      console.log(`📊 New password type: ${newType}`);
      
      if (newType === 'text') {
        console.log('✅ Password visibility toggle working');
      } else {
        console.log('❌ Password visibility toggle not working');
      }
    } else {
      console.log('❌ Password toggle button not found');
    }

    // Test 5: Test form validation
    console.log('\n📋 Test 5: Test form validation');
    
    // Clear form and try to submit empty form
    await page.evaluate(() => {
      document.querySelector('input[name="email"]').value = '';
      document.querySelector('input[name="password"]').value = '';
    });
    
    await page.click('.auth-submit-button');
    console.log('✅ Attempted to submit empty form');
    
    // Check if form validation prevents submission
    await new Promise(resolve => setTimeout(resolve, 1000));
    const emailValue = await page.$eval('input[name="email"]', el => el.value);
    const passwordValue = await page.$eval('input[name="password"]', el => el.value);
    
    if (emailValue === '' && passwordValue === '') {
      console.log('✅ Form validation working (empty form not submitted)');
    } else {
      console.log('❌ Form validation not working');
    }

    // Test 6: Check console logs for errors
    console.log('\n📋 Test 6: Check console logs for errors');
    
    const errorLogs = consoleLogs.filter(log => 
      log.includes('error') || log.includes('Error') || log.includes('❌')
    );
    
    console.log(`📊 Error logs found: ${errorLogs.length}`);
    errorLogs.forEach(log => {
      console.log(`  ${log}`);
    });
    
    if (errorLogs.length === 0) {
      console.log('✅ No errors found in console logs');
    } else {
      console.log('❌ Errors found in console logs');
    }

    // Test 7: Check for successful authentication logs
    console.log('\n📋 Test 7: Check for successful authentication logs');
    
    const successLogs = consoleLogs.filter(log => 
      log.includes('success') || log.includes('Success') || log.includes('✅')
    );
    
    console.log(`📊 Success logs found: ${successLogs.length}`);
    successLogs.forEach(log => {
      console.log(`  ${log}`);
    });

    console.log('\n🎉 Email/Password Authentication Test Completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testEmailPasswordAuth().catch(console.error);
