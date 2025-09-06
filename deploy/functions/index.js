const functions = require('firebase-functions');
const app = require('./server.js');

// Export the Express app as a Firebase Function
exports.api = functions.https.onRequest(app);
