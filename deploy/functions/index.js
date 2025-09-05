const functions = require('firebase-functions');

// Import the real backend server through wrapper
const app = require('./server-wrapper.js');

// Export the Express app as a Firebase Function
exports.api = functions.https.onRequest(app);
