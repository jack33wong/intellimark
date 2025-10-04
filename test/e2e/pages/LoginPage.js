const { expect } = require('@playwright/test');

class LoginPage {
  constructor(page) {
    this.page = page;

    // --- Define Locators in the Constructor ---
    // Main page locators (email entry)
    this.mainEmailInput = page.locator('input[type="email"]').first();
    this.continueButton = page.locator('button[type="submit"]:has-text("Continue")').or(page.locator('.auth-submit-button:has-text("Continue")'));
    
    // Sign-in page locators (after email check)
    this.signinEmailInput = page.locator('input[type="email"]').last();
    this.signinPasswordInput = page.locator('input[type="password"]');
    this.signinButton = page.locator('button:has-text("Sign In")').or(page.locator('button[type="submit"]'));
    
    // Sign-up page locators (for new users)
    this.signupEmailInput = page.locator('input[type="email"]').last();
    this.signupPasswordInput = page.locator('input[type="password"]');
    this.signupButton = page.locator('button:has-text("Sign Up")').or(page.locator('button[type="submit"]'));
    
    // Common elements
    this.errorMessage = page.locator('.error-message, .alert-error, .login-error, .firebase-error');
    this.backButton = page.locator('button:has-text("Back")');
    
    // Loading states
    this.loadingSpinner = page.locator('.loading, .spinner, .login-loading');
    
    // Social login buttons (if needed)
    this.googleLoginButton = page.locator('button:has-text("Google")');
    this.facebookLoginButton = page.locator('button:has-text("Facebook")');
  }

  // --- High-Level Actions ---

  /**
   * Navigates to the login page and performs a complete login action.
   * Handles the actual login flow: email → continue → password → continue
   * @param {string} email - The user's email.
   * @param {string} password - The user's password.
   */
  async login(email, password) {
    await this.navigateToLogin();
    await this.enterEmailAndContinue(email);
    await this.enterPasswordAndSubmit(password);
    await this.waitForLoginSuccess();
  }


  /**
   * Navigates to the login page.
   */
  async navigateToLogin() {
    await this.page.goto('/login');
    await this.waitForMainPageLoad();
  }

  /**
   * Enters email on the main page and clicks continue.
   * This shows both email and password fields on the same page.
   * @param {string} email - The user's email.
   */
  async enterEmailAndContinue(email) {
    // Wait for main page to load
    await expect(this.mainEmailInput, 'Main email input should be visible').toBeVisible();
    await this.mainEmailInput.fill(email);
    
    // Click continue button
    await expect(this.continueButton, 'Continue button should be visible').toBeVisible();
    await this.continueButton.click();
    
    // Wait for password field to appear
    await expect(this.signinPasswordInput, 'Password field should be visible after continue').toBeVisible({ timeout: 10000 });
  }

  /**
   * Enters password and submits the login form.
   * @param {string} password - The user's password.
   */
  async enterPasswordAndSubmit(password) {
    // Fill password field
    await expect(this.signinPasswordInput, 'Password input should be visible').toBeVisible();
    await this.signinPasswordInput.fill(password);
    
    // Click continue/submit button
    await expect(this.continueButton, 'Continue button should be visible').toBeVisible();
    await this.continueButton.click();
  }

  /**
   * Fills in the sign-in credentials.
   * @param {string} email - The user's email.
   * @param {string} password - The user's password.
   */
  async fillSignInCredentials(email, password) {
    await expect(this.signinEmailInput, 'Sign-in email input should be visible').toBeVisible();
    await this.signinEmailInput.fill(email);
    await this.signinPasswordInput.fill(password);
  }

  /**
   * Fills in the sign-up credentials.
   * @param {string} email - The user's email.
   * @param {string} password - The user's password.
   */
  async fillSignUpCredentials(email, password) {
    await expect(this.signupEmailInput, 'Sign-up email input should be visible').toBeVisible();
    await this.signupEmailInput.fill(email);
    await this.signupPasswordInput.fill(password);
  }

  /**
   * Submits the sign-in form.
   */
  async submitSignIn() {
    await this.signinButton.click();
  }

  /**
   * Submits the sign-up form.
   */
  async submitSignUp() {
    await this.signupButton.click();
  }


  /**
   * Waits for login to complete successfully.
   * This method verifies that the user is redirected away from the login page
   * and that the authentication token is properly stored and valid.
   */
  async waitForLoginSuccess() {
    // Wait for redirect away from login page
    await expect(this.page).not.toHaveURL(/.*login/);
    
    // Wait for any loading to complete
    await this.page.waitForLoadState('networkidle');
    
    // Wait for authentication token to be stored in localStorage
    await this.page.waitForFunction(() => {
      const token = localStorage.getItem('authToken');
      return token && token.length > 0;
    }, { timeout: 10000 });
    
    // Additional wait to ensure token refresh is complete
    await this.page.waitForTimeout(2000);
    
    console.log('✅ Login successful - authentication token stored');
    
    // Verify token is valid by making a test API call
    await this.verifyTokenValidity();
  }
  
  /**
   * Verifies that the authentication token is valid by making a test API call
   */
  async verifyTokenValidity() {
    try {
      const response = await this.page.evaluate(async () => {
        const token = localStorage.getItem('authToken');
        if (!token) return { success: false, error: 'No token found' };
        
        const response = await fetch('/api/auth/profile', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        return {
          success: response.ok,
          status: response.status,
          statusText: response.statusText
        };
      });
      
      if (response.success) {
        console.log('✅ Authentication token is valid');
      } else {
        console.log(`❌ Authentication token validation failed: ${response.status} ${response.statusText}`);
        throw new Error(`Token validation failed: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.log('❌ Token validation error:', error.message);
      throw error;
    }
  }

  // --- High-Level Verifications ---

  /**
   * Waits for the main login page to be fully loaded.
   * This is more reliable than waiting for network idle.
   */
  async waitForMainPageLoad() {
    await expect(this.mainEmailInput, 'Main email input should be visible').toBeVisible();
    await expect(this.continueButton, 'Continue button should be visible').toBeVisible();
  }

  /**
   * Waits for the sign-in page to be fully loaded.
   */
  async waitForSignInPageLoad() {
    await expect(this.signinEmailInput, 'Sign-in email input should be visible').toBeVisible();
    await expect(this.signinPasswordInput, 'Sign-in password input should be visible').toBeVisible();
    await expect(this.signinButton, 'Sign-in button should be visible').toBeVisible();
  }

  /**
   * Waits for the sign-up page to be fully loaded.
   */
  async waitForSignUpPageLoad() {
    await expect(this.signupEmailInput, 'Sign-up email input should be visible').toBeVisible();
    await expect(this.signupPasswordInput, 'Sign-up password input should be visible').toBeVisible();
    await expect(this.signupButton, 'Sign-up button should be visible').toBeVisible();
  }


  /**
   * Waits for login error to appear.
   */
  async waitForLoginError() {
    await expect(this.errorMessage, 'Error message should be visible').toBeVisible();
  }

  /**
   * Waits for loading spinner to disappear.
   */
  async waitForLoadingToComplete() {
    await expect(this.loadingSpinner, 'Loading spinner should disappear').toBeHidden({ timeout: 10000 });
  }

  // --- Helper Methods that Return Locators ---
  // This pattern allows for flexible assertions in the test file.

  /**
   * Returns a locator for the main email input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the main email input.
   */
  getMainEmailInputLocator() {
    return this.mainEmailInput;
  }

  /**
   * Returns a locator for the continue button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the continue button.
   */
  getContinueButtonLocator() {
    return this.continueButton;
  }

  /**
   * Returns a locator for the sign-in email input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign-in email input.
   */
  getSignInEmailInputLocator() {
    return this.signinEmailInput;
  }

  /**
   * Returns a locator for the sign-in password input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign-in password input.
   */
  getSignInPasswordInputLocator() {
    return this.signinPasswordInput;
  }

  /**
   * Returns a locator for the sign-in button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign-in button.
   */
  getSignInButtonLocator() {
    return this.signinButton;
  }

  /**
   * Returns a locator for the sign-up email input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign-up email input.
   */
  getSignUpEmailInputLocator() {
    return this.signupEmailInput;
  }

  /**
   * Returns a locator for the sign-up password input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign-up password input.
   */
  getSignUpPasswordInputLocator() {
    return this.signupPasswordInput;
  }

  /**
   * Returns a locator for the sign-up button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign-up button.
   */
  getSignUpButtonLocator() {
    return this.signupButton;
  }


  /**
   * Returns a locator for error messages.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for error messages.
   */
  getErrorMessageLocator() {
    return this.errorMessage;
  }

  /**
   * Returns a locator for the back button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the back button.
   */
  getBackButtonLocator() {
    return this.backButton;
  }

  /**
   * Returns a locator for the Google login button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the Google login button.
   */
  getGoogleLoginButtonLocator() {
    return this.googleLoginButton;
  }

  /**
   * Returns a locator for the Facebook login button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the Facebook login button.
   */
  getFacebookLoginButtonLocator() {
    return this.facebookLoginButton;
  }

  // --- Data Retrieval Methods ---
  // These methods return actual data rather than locators, for when you need the values.

  /**
   * Returns the visible error message text.
   * This method assumes the test will first assert the error is visible.
   * e.g., await expect(loginPage.errorMessage).toBeVisible();
   * @returns {Promise<string>} The error message text.
   */
  async getErrorMessage() {
    return await this.errorMessage.textContent();
  }

  /**
   * Gets the current URL to verify navigation.
   * @returns {Promise<string>} The current page URL.
   */
  async getCurrentUrl() {
    return this.page.url();
  }

  /**
   * Checks if the user is currently on the login page.
   * @returns {Promise<boolean>} True if on login page.
   */
  async isOnLoginPage() {
    return this.page.url().includes('/login');
  }

  /**
   * Checks if the main login page is visible.
   * @returns {Promise<boolean>} True if main login page is visible.
   */
  async isMainPageVisible() {
    return await this.mainEmailInput.isVisible() && await this.continueButton.isVisible();
  }

  /**
   * Checks if the sign-in page is visible.
   * @returns {Promise<boolean>} True if sign-in page is visible.
   */
  async isSignInPageVisible() {
    return await this.signinButton.isVisible();
  }

  /**
   * Checks if the sign-up page is visible.
   * @returns {Promise<boolean>} True if sign-up page is visible.
   */
  async isSignUpPageVisible() {
    return await this.signupButton.isVisible();
  }

}

module.exports = LoginPage;