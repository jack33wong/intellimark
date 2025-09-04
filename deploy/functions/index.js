const functions = require('firebase-functions');
const app = require('./server.js');
exports.api = functions.https.onRequest(app);
