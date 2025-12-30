/**
 * Firebase Configuration (TypeScript)
 * Initializes Firebase and exports the typed auth and provider services.
 */
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, GoogleAuthProvider, FacebookAuthProvider } from 'firebase/auth';

// Your web app's Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Initialize Firebase variables with their corresponding types
let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let facebookProvider: FacebookAuthProvider | null = null;

try {
  // Initialize Firebase
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  // Initialize Google Auth Provider
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  });

  // Initialize Facebook Auth Provider
  facebookProvider = new FacebookAuthProvider();

  // Initialize Analytics
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
    // Only initialize analytics on client side
    import('firebase/analytics').then(({ getAnalytics }) => {
      // Check if measurementId is available before initializing
      // Note: getAnalytics automaticlly uses the measurementId from config if provided
      if ((firebaseConfig as any).measurementId || process.env.REACT_APP_FIREBASE_MEASUREMENT_ID) {
        // Merge explicit measurementId if it wasn't in the initial config object
        if (!(firebaseConfig as any).measurementId && process.env.REACT_APP_FIREBASE_MEASUREMENT_ID) {
          (firebaseConfig as any).measurementId = process.env.REACT_APP_FIREBASE_MEASUREMENT_ID;
        }

        try {
          const analytics = getAnalytics(app!);
          console.log('📊 Firebase Analytics initialized');
        } catch (e) {
          console.warn('⚠️ Firebase Analytics initialization skipped:', e);
        }
      }
    });
  }

} catch (error: any) {
  console.error('❌ Firebase initialization failed:', error);
  console.error('Error details:', {
    message: error.message,
    code: error.code,
    stack: error.stack
  });

  // Ensure all values are null if initialization fails
  app = null;
  auth = null;
  googleProvider = null;
  facebookProvider = null;
}

// Export all Firebase instances
export { auth, googleProvider, facebookProvider };
export default app;

