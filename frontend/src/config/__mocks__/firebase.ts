/**
 * Manual Mock for Firebase (TypeScript)
 * This file will be automatically used by Jest in place of the real firebase.ts,
 * preventing initialization errors in the test environment. It is the definitive
 * fix for the 'auth/invalid-api-key' error.
 */
import { Auth } from 'firebase/auth';

// Create a mock of the Firebase Auth object with just the functions our app needs.
export const auth: Partial<Auth> = {
  onAuthStateChanged: jest.fn((callback: (user: any) => void) => {
    // Simulate no user being logged in initially. This allows AuthProvider to finish loading.
    callback(null);
    // Return a mock unsubscribe function.
    return jest.fn();
  }),
  currentUser: null,
};

// We don't need to mock the providers for this test.
export const googleProvider = {};
export const facebookProvider = {};

