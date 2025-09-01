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

// Initialize Firebase with custom settings to avoid hosting check
const app = initializeApp(firebaseConfig, {
  automaticDataCollectionEnabled: false,
  measurementId: undefined
});

export const auth = getAuth(app);

// Initialize providers with popup-only configuration
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export const facebookProvider = new FacebookAuthProvider();

// Add error handling for Firebase initialization
if (process.env.NODE_ENV === 'development') {
  console.log('Firebase initialized in development mode');
  console.log('Config:', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain
  });
}

export default app;
