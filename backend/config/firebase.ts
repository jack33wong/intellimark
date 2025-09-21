/**
 * Centralized Firebase Admin Configuration
 * Handles Firebase Admin initialization and exports shared instances
 */

import admin from 'firebase-admin';
import { join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ADMIN_EMAILS } from './admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Firebase Admin instances
let firebaseAdmin: admin.app.App | null = null;
let firestoreDb: admin.firestore.Firestore | null = null;
let firebaseAuth: admin.auth.Auth | null = null;
let isInitialized = false;

/**
 * Initialize Firebase Admin SDK
 */
const initializeFirebase = (): boolean => {
  try {
    // Check if already initialized
    if (isInitialized && firebaseAdmin) {
      return true;
    }

    // Check if any Firebase app exists
    if (admin.apps.length > 0) {
      firebaseAdmin = admin.apps[0];
    } else {
      // Try multiple possible paths for the service account file
      const possiblePaths = [
        join(process.cwd(), 'backend', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
        join(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
        join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
        join(__dirname, 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json')
      ];
      
      // Find the first path that exists
      const serviceAccountPath = possiblePaths.find(path => existsSync(path));
      
      if (!serviceAccountPath) {
        throw new Error(`Service account file not found in any of these locations:\n${possiblePaths.join('\n')}`);
      }
      
      try {
        
        firebaseAdmin = admin.initializeApp({
          credential: admin.credential.cert(serviceAccountPath),
          storageBucket: 'intellimark-6649e.appspot.com'
        });
        isInitialized = true;
      } catch (error) {
        console.warn('⚠️ Firebase Admin initialization failed with service account');
        console.warn('   Error details:', error instanceof Error ? error.message : String(error));
        
        // Don't try to initialize with applicationDefault() as it will also fail
        console.warn('⚠️ Firebase not available - running in mock mode');
        firebaseAdmin = null;
        firestoreDb = null;
        firebaseAuth = null;
        isInitialized = false;
        return false;
      }
    }

    // Only initialize Firestore and Auth if Firebase Admin is available
    if (firebaseAdmin) {
      try {
        firestoreDb = admin.firestore(firebaseAdmin);
        // Configure Firestore to ignore undefined properties
        firestoreDb.settings({
          ignoreUndefinedProperties: true
        });
        firebaseAuth = admin.auth(firebaseAdmin);
        isInitialized = true;
      } catch (error) {
        console.error('❌ Firebase services initialization failed:', error);
        firebaseAdmin = null;
        firestoreDb = null;
        firebaseAuth = null;
        isInitialized = false;
        return false;
      }
    }
    
    return isInitialized;
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
    firebaseAdmin = null;
    firestoreDb = null;
    firebaseAuth = null;
    isInitialized = false;
    return false;
  }
};

/**
 * Get Firebase Admin app instance
 */
export const getFirebaseAdmin = (): admin.app.App | null => {
  if (!firebaseAdmin && !isInitialized) {
    initializeFirebase();
  }
  return firebaseAdmin;
};

/**
 * Get Firestore database instance
 */
export const getFirestore = (): admin.firestore.Firestore | null => {
  if (!firestoreDb && !isInitialized) {
    initializeFirebase();
  }
  return firestoreDb;
};

/**
 * Get Firebase Auth instance
 */
export const getFirebaseAuth = (): admin.auth.Auth | null => {
  if (!firebaseAuth && !isInitialized) {
    initializeFirebase();
  }
  return firebaseAuth;
};

/**
 * Check if Firebase is available
 */
export const isFirebaseAvailable = (): boolean => {
  return isInitialized && firebaseAdmin !== null && firestoreDb !== null && firebaseAuth !== null;
};

/**
 * Helper function to determine user role based on email
 */
export const getUserRole = (email: string): string => {
  return ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
};

// Initialize Firebase on module load
initializeFirebase();

// Export instances for backward compatibility (renamed to avoid conflicts)
export const firebaseApp = firebaseAdmin;
export const firestore = firestoreDb;
export const auth = firebaseAuth;
