"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.auth = exports.firestore = exports.firebaseApp = exports.getUserRole = exports.isFirebaseAvailable = exports.getFirebaseAuth = exports.getFirestore = exports.getFirebaseAdmin = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const path_1 = require("path");
const fs_1 = require("fs");
const url_1 = require("url");
const path_2 = require("path");
const admin_1 = require("./admin");
let __filename;
let __dirname;
try {
    __filename = require.resolve('./firebase');
    __dirname = (0, path_2.dirname)(__filename);
}
catch {
    __filename = (0, url_1.fileURLToPath)(import.meta.url);
    __dirname = (0, path_2.dirname)(__filename);
}
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
        if (firebase_admin_1.default.apps.length > 0) {
            firebaseAdmin = firebase_admin_1.default.apps[0];
            console.log('✅ Using existing Firebase Admin app');
        }
        else {
            const possiblePaths = [
                (0, path_1.join)(process.cwd(), 'backend', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
                (0, path_1.join)(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
                (0, path_1.join)(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
                (0, path_1.join)(__dirname, 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json')
            ];
            console.log('🔍 Current working directory:', process.cwd());
            console.log('🔍 __dirname:', __dirname);
            console.log('🔍 Possible service account paths:');
            possiblePaths.forEach((path, index) => {
                console.log(`   ${index + 1}. ${path} - ${(0, fs_1.existsSync)(path) ? '✅ EXISTS' : '❌ NOT FOUND'}`);
            });
            const serviceAccountPath = possiblePaths.find(path => (0, fs_1.existsSync)(path));
            if (!serviceAccountPath) {
                throw new Error(`Service account file not found in any of these locations:\n${possiblePaths.join('\n')}`);
            }
            console.log('✅ Using service account at:', serviceAccountPath);
            try {
                console.log('✅ Service account file found, initializing Firebase...');
                firebaseAdmin = firebase_admin_1.default.initializeApp({
                    credential: firebase_admin_1.default.credential.cert(serviceAccountPath)
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
                firestoreDb = firebase_admin_1.default.firestore(firebaseAdmin);
                firebaseAuth = firebase_admin_1.default.auth(firebaseAdmin);
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
const getFirebaseAdmin = () => {
    if (!firebaseAdmin && !isInitialized) {
        initializeFirebase();
    }
    return firebaseAdmin;
};
exports.getFirebaseAdmin = getFirebaseAdmin;
const getFirestore = () => {
    if (!firestoreDb && !isInitialized) {
        initializeFirebase();
    }
    return firestoreDb;
};
exports.getFirestore = getFirestore;
const getFirebaseAuth = () => {
    if (!firebaseAuth && !isInitialized) {
        initializeFirebase();
    }
    return firebaseAuth;
};
exports.getFirebaseAuth = getFirebaseAuth;
const isFirebaseAvailable = () => {
    return isInitialized && firebaseAdmin !== null && firestoreDb !== null && firebaseAuth !== null;
};
exports.isFirebaseAvailable = isFirebaseAvailable;
const getUserRole = (email) => {
    return admin_1.ADMIN_EMAILS.includes(email) ? 'admin' : 'user';
};
exports.getUserRole = getUserRole;
initializeFirebase();
exports.firebaseApp = firebaseAdmin;
exports.firestore = firestoreDb;
exports.auth = firebaseAuth;
