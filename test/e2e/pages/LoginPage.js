const { expect } = require('@playwright/test');

class LoginPage {
  constructor(page) {
    this.page = page;

    // --- Define Locators in the Constructor ---
    // Locators are the modern, robust way to reference elements.
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');
    this.loginButton = page.locator('button[type="submit"]').or(page.locator('button:has-text("Login")')).or(page.locator('button:has-text("Sign In")'));
    this.errorMessage = page.locator('.error-message, .alert-error, .login-error');
    
    // Additional form elements that might be useful
    this.loginForm = page.locator('form[action*="login"], .login-form, #login-form');
    this.forgotPasswordLink = page.locator('a:has-text("Forgot"), a:has-text("Reset")');
    this.signUpLink = page.locator('a:has-text("Sign Up"), a:has-text("Register")');
    
    // Loading states
    this.loadingSpinner = page.locator('.loading, .spinner, .login-loading');
  }

  // --- High-Level Actions ---

  /**
   * Navigates to the login page and performs a complete login action.
   * @param {string} email - The user's email.
   * @param {string} password - The user's password.
   */
  async login(email, password) {
    await this.navigateToLogin();
    await this.fillCredentials(email, password);
    await this.submitLogin();
    await this.waitForLoginSuccess();
  }

  /**
   * Navigates to the login page.
   */
  async navigateToLogin() {
    await this.page.goto('/login');
    await this.waitForLoginPageLoad();
  }

  /**
   * Fills in the login credentials.
   * @param {string} email - The user's email.
   * @param {string} password - The user's password.
   */
  async fillCredentials(email, password) {
    await expect(this.emailInput, 'Email input should be visible').toBeVisible();
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  /**
   * Submits the login form.
   */
  async submitLogin() {
    await this.loginButton.click();
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
   * Waits for the login page to be fully loaded.
   * This is more reliable than waiting for network idle.
   */
  async waitForLoginPageLoad() {
    await expect(this.emailInput, 'Email input should be visible').toBeVisible();
    await expect(this.passwordInput, 'Password input should be visible').toBeVisible();
    await expect(this.loginButton, 'Login button should be visible').toBeVisible();
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
   * Returns a locator for the email input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the email input.
   */
  getEmailInputLocator() {
    return this.emailInput;
  }

  /**
   * Returns a locator for the password input field.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the password input.
   */
  getPasswordInputLocator() {
    return this.passwordInput;
  }

  /**
   * Returns a locator for the login button.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the login button.
   */
  getLoginButtonLocator() {
    return this.loginButton;
  }

  /**
   * Returns a locator for error messages.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for error messages.
   */
  getErrorMessageLocator() {
    return this.errorMessage;
  }

  /**
   * Returns a locator for the forgot password link.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the forgot password link.
   */
  getForgotPasswordLinkLocator() {
    return this.forgotPasswordLink;
  }

  /**
   * Returns a locator for the sign up link.
   * @returns {import('@playwright/test').Locator} A Playwright Locator for the sign up link.
   */
  getSignUpLinkLocator() {
    return this.signUpLink;
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
   * Checks if the login form is visible.
   * @returns {Promise<boolean>} True if login form is visible.
   */
  async isLoginFormVisible() {
    return await this.loginForm.isVisible();
  }

  // --- Legacy methods for backward compatibility ---
  // These are kept for any existing code that might depend on them

  /**
   * @deprecated Use waitForLoginPageLoad() instead
   */
  async waitForLoginPageLoad() {
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = LoginPage;