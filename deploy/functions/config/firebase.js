import admin from 'firebase-admin';
import { join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { ADMIN_EMAILS } from './admin';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let firebaseAdmin = null;
let firestoreDb = null;
let firebaseAuth = null;
let isInitialized = false;
const initializeFirebase = () => {
    try {
        if (isInitialized && firebaseAdmin) {
            console.log('✅ Firebase Admin already initialized');
            return true;
        }
        if (admin.apps.length > 0) {
            firebaseAdmin = admin.apps[0];
            console.log('✅ Using existing Firebase Admin app');
        }
        else {
            const possiblePaths = [
                join(process.cwd(), 'backend', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
                join(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
                join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
                join(__dirname, 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json')
            ];
            console.log('🔍 Current working directory:', process.cwd());
            console.log('🔍 __dirname:', __dirname);
            console.log('🔍 Possible service account paths:');
            possiblePaths.forEach((path, index) => {
                console.log(`   ${index + 1}. ${path} - ${existsSync(path) ? '✅ EXISTS' : '❌ NOT FOUND'}`);
            });
            const serviceAccountPath = possiblePaths.find(path => existsSync(path));
            if (!serviceAccountPath) {
                throw new Error(`Service account file not found in any of these locations:\n${possiblePaths.join('\n')}`);
            }
            console.log('✅ Using service account at:', serviceAccountPath);
            try {
                console.log('✅ Service account file found, initializing Firebase...');
                firebaseAdmin = admin.initializeApp({
                    credential: admin.credential.cert(serviceAccountPath)
                });
                console.log('✅ Firebase Admin initialized successfully with service account');
                isInitialized = true;
            }
            catch (error) {
                console.warn('⚠️ Firebase Admin initialization failed with service account');
                console.warn('   Error details:', error instanceof Error ? error.message : String(error));
                console.warn('⚠️ Firebase not available - running in mock mode');
                firebaseAdmin = null;
                firestoreDb = null;
                firebaseAuth = null;
                isInitialized = false;
                return false;
            }
        }
        if (firebaseAdmin) {
            try {
                firestoreDb = admin.firestore(firebaseAdmin);
                firebaseAuth = admin.auth(firebaseAdmin);
                isInitialized = true;
                console.log('✅ Firebase services initialized successfully');
            }
            catch (error) {
                console.error('❌ Firebase services initialization failed:', error);
                firebaseAdmin = null;
                firestoreDb = null;
                firebaseAuth = null;
                isInitialized = false;
                return false;
            }
        }
        return isInitialized;
    }
    catch (error) {
        console.error('❌ Firebase Admin initialization failed:', error);
        firebaseAdmin = null;
        firestoreDb = null;
        firebaseAuth = null;
        isInitialized = false;
        return false;
    }
};
export const getFirebaseAdmin = () => {
    if (!firebaseAdmin && !isInitialized) {
        initializeFirebase();
    }
    return firebaseAdmin;
};
export const getFirestore = () => {
    if (!firestoreDb && !isInitialized) {
        initializeFirebase();
    }
    return firestoreDb;
};
export const getFirebaseAuth = () => {
    if (!firebaseAuth && !isInitialized) {
        initializeFirebase();
    }
    return firebaseAuth;
};
export const isFirebaseAvailable = () => {
    return isInitialized && firebaseAdmin !== null && firestoreDb !== null && firebaseAuth !== null;
};
export const getUserRole = (email) => {
    return ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
};
initializeFirebase();
export const firebaseApp = firebaseAdmin;
export const firestore = firestoreDb;
export const auth = firebaseAuth;
