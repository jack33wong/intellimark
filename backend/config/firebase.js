const admin = require('firebase-admin');
const path = require('path');

let db = null;
let adminInstance = null;

// Initialize Firebase Admin SDK only if service account file exists
try {
  const serviceAccount = require('../intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
  
  adminInstance = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'intellimark-6649e'
  });

  // Get Firestore instance
  db = admin.firestore();
  console.log('Firebase Admin SDK initialized successfully');
} catch (error) {
  console.warn('Firebase service account file not found. Running without Firebase functionality.');
  console.warn('To enable Firebase features, add the service account JSON file to the backend directory.');
}

module.exports = { admin: adminInstance, db };
