const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccount = require('../intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'intellimark-6649e'
});

// Get Firestore instance
const db = admin.firestore();

module.exports = { admin, db };
