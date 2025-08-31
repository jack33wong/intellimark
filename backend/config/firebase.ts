/**
 * Firebase Configuration for Mark Homework System
 * Database connection, authentication setup, and storage configuration
 */

/**
 * Firebase configuration interface
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string | undefined;
}

/**
 * Firebase service configuration
 */
export class FirebaseConfigService {
  private static config: FirebaseConfig | null = null;
  private static isInitialized = false;

  /**
   * Initialize Firebase configuration
   * @param config - Firebase configuration object
   */
  static initialize(config?: FirebaseConfig): void {
    try {
      if (config) {
        this.config = config;
      } else {
        // Load from environment variables
        this.config = {
          apiKey: process.env['FIREBASE_API_KEY'] || '',
          authDomain: process.env['FIREBASE_AUTH_DOMAIN'] || '',
          projectId: process.env['FIREBASE_PROJECT_ID'] || '',
          storageBucket: process.env['FIREBASE_STORAGE_BUCKET'] || '',
          messagingSenderId: process.env['FIREBASE_MESSAGING_SENDER_ID'] || '',
          appId: process.env['FIREBASE_APP_ID'] || '',
          measurementId: process.env['FIREBASE_MEASUREMENT_ID']
        };
      }

      // Validate configuration
      if (this.config && this.validateConfig(this.config)) {
        this.isInitialized = true;
        console.log('Firebase configuration initialized successfully');
      } else {
        console.warn('Firebase configuration incomplete, some features may not work');
      }
    } catch (error) {
      console.error('Failed to initialize Firebase configuration:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Validate Firebase configuration
   * @param config - Configuration to validate
   * @returns True if configuration is valid
   */
  private static validateConfig(config: FirebaseConfig): boolean {
    const requiredFields = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    
    return requiredFields.every(field => {
      const value = config[field as keyof FirebaseConfig];
      return value && typeof value === 'string' && value.trim().length > 0;
    });
  }

  /**
   * Check if Firebase is properly configured
   * @returns True if Firebase is ready
   */
  static isReady(): boolean {
    return this.isInitialized && this.config !== null;
  }

  /**
   * Get Firebase configuration
   * @returns Firebase configuration object
   */
  static getConfig(): FirebaseConfig | null {
    return this.config;
  }

  /**
   * Get specific configuration value
   * @param key - Configuration key
   * @returns Configuration value or null if not found
   */
  static getConfigValue(key: keyof FirebaseConfig): string | null {
    return this.config?.[key] || null;
  }

  /**
   * Get project ID
   * @returns Firebase project ID
   */
  static getProjectId(): string | null {
    return this.getConfigValue('projectId');
  }

  /**
   * Get storage bucket
   * @returns Firebase storage bucket
   */
  static getStorageBucket(): string | null {
    return this.getConfigValue('storageBucket');
  }

  /**
   * Get API key
   * @returns Firebase API key
   */
  static getApiKey(): string | null {
    return this.getConfigValue('apiKey');
  }

  /**
   * Get authentication domain
   * @returns Firebase authentication domain
   */
  static getAuthDomain(): string | null {
    return this.getConfigValue('authDomain');
  }

  /**
   * Check if specific Firebase service is available
   * @param service - Service name to check
   * @returns True if service is available
   */
  static isServiceAvailable(service: 'auth' | 'firestore' | 'storage'): boolean {
    if (!this.isReady()) {
      return false;
    }

    switch (service) {
      case 'auth':
        return !!this.getConfigValue('apiKey') && !!this.getConfigValue('authDomain');
      case 'firestore':
        return !!this.getConfigValue('projectId');
      case 'storage':
        return !!this.getConfigValue('storageBucket');
      default:
        return false;
    }
  }

  /**
   * Get service status information
   * @returns Service status object
   */
  static getServiceStatus(): {
    configured: boolean;
    initialized: boolean;
    auth: boolean;
    firestore: boolean;
    storage: boolean;
  } {
    return {
      configured: this.config !== null,
      initialized: this.isInitialized,
      auth: this.isServiceAvailable('auth'),
      firestore: this.isServiceAvailable('firestore'),
      storage: this.isServiceAvailable('storage')
    };
  }

  /**
   * Reset configuration (useful for testing)
   */
  static reset(): void {
    this.config = null;
    this.isInitialized = false;
    console.log('Firebase configuration reset');
  }

  /**
   * Get environment-specific configuration
   * @param environment - Environment name
   * @returns Environment-specific configuration
   */
  static getEnvironmentConfig(environment: 'development' | 'staging' | 'production'): FirebaseConfig | null {
    if (!this.isReady()) {
      return null;
    }

    // In a real implementation, this would load different configs for different environments
    const baseConfig = this.config!;
    
    switch (environment) {
      case 'development':
        return {
          ...baseConfig,
          projectId: `${baseConfig.projectId}-dev`
        };
      case 'staging':
        return {
          ...baseConfig,
          projectId: `${baseConfig.projectId}-staging`
        };
      case 'production':
        return baseConfig;
      default:
        return baseConfig;
    }
  }

  /**
   * Validate API key format
   * @param apiKey - API key to validate
   * @returns True if API key format is valid
   */
  static validateApiKey(apiKey: string): boolean {
    // Firebase API keys are typically 39 characters long and contain alphanumeric characters
    const apiKeyPattern = /^AIza[0-9A-Za-z-_]{35}$/;
    return apiKeyPattern.test(apiKey);
  }

  /**
   * Validate project ID format
   * @param projectId - Project ID to validate
   * @returns True if project ID format is valid
   */
  static validateProjectId(projectId: string): boolean {
    // Firebase project IDs are 6-30 characters long and contain lowercase letters, numbers, and hyphens
    const projectIdPattern = /^[a-z0-9-]{6,30}$/;
    return projectIdPattern.test(projectId);
  }

  /**
   * Get configuration summary for logging
   * @returns Configuration summary object
   */
  static getConfigSummary(): {
    configured: boolean;
    projectId: string | null;
    hasApiKey: boolean;
    hasAuthDomain: boolean;
    hasStorage: boolean;
  } {
    return {
      configured: this.isReady(),
      projectId: this.getProjectId(),
      hasApiKey: !!this.getApiKey(),
      hasAuthDomain: !!this.getAuthDomain(),
      hasStorage: !!this.getStorageBucket()
    };
  }
}

// Initialize configuration on module load
FirebaseConfigService.initialize();
