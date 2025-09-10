import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, FacebookAuthProvider } from 'firebase/auth';


const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID
};


// Initialize Firebase variables
let app = null;
let auth = null;
let googleProvider = null;
let facebookProvider = null;

try {
  // Initialize Firebase with custom settings to avoid hosting check
  app = initializeApp(firebaseConfig, {
    automaticDataCollectionEnabled: false,
    measurementId: undefined
  });

  auth = getAuth(app);

  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  });

  facebookProvider = new FacebookAuthProvider();

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
