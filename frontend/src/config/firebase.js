import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, FacebookAuthProvider } from 'firebase/auth';

console.log('🚀 Firebase config module loading...');
console.log('🔧 Environment check:', {
  NODE_ENV: process.env.NODE_ENV,
  hasApiKey: !!process.env.REACT_APP_FIREBASE_API_KEY,
  hasAuthDomain: !!process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  hasProjectId: !!process.env.REACT_APP_FIREBASE_PROJECT_ID
});

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};

// Log configuration for debugging
console.log('🔧 Firebase Config Check:', {
  apiKey: !!firebaseConfig.apiKey,
  authDomain: !!firebaseConfig.authDomain,
  projectId: !!firebaseConfig.projectId,
  storageBucket: !!firebaseConfig.storageBucket,
  messagingSenderId: !!firebaseConfig.messagingSenderId,
  appId: !!firebaseConfig.appId
});

console.log('🔧 Firebase Config Values:', {
  apiKey: firebaseConfig.apiKey ? `${firebaseConfig.apiKey.substring(0, 10)}...` : 'undefined',
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId
});

// Initialize Firebase variables
let app = null;
let auth = null;
let googleProvider = null;
let facebookProvider = null;

try {
  // Initialize Firebase with custom settings to avoid hosting check
  console.log('🔄 Initializing Firebase app...');
  app = initializeApp(firebaseConfig, {
    automaticDataCollectionEnabled: false,
    measurementId: undefined
  });
  console.log('✅ Firebase app initialized successfully');

  auth = getAuth(app);

  console.log('🔄 Initializing Google provider...');
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  });
  console.log('✅ Google provider initialized successfully');

  console.log('🔄 Initializing Facebook provider...');
  facebookProvider = new FacebookAuthProvider();
  console.log('✅ Facebook provider initialized successfully');

  // Add error handling for Firebase initialization
  if (process.env.NODE_ENV === 'development') {
    console.log('✅ Firebase initialized in development mode');
    console.log('Config:', {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain
    });
  }

} catch (error) {
  console.error('❌ Firebase initialization failed:', error);
  console.error('Error details:', {
    message: error.message,
    code: error.code,
    stack: error.stack
  });
  
  // Set null values if initialization fails
  app = null;
  auth = null;
  googleProvider = null;
  facebookProvider = null;
}

// Export all Firebase instances
export { auth, googleProvider, facebookProvider };
export default app;
