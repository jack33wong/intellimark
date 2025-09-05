// Wrapper to prevent server auto-start and export the Express app
const serverModule = require('./server.js');

// The server.js should export the app as default
// We need to prevent it from auto-starting by overriding the startServer function
if (serverModule.default) {
  module.exports = serverModule.default;
} else {
  // If no default export, try to find the app in the module
  for (const key in serverModule) {
    if (serverModule[key] && typeof serverModule[key] === 'function' && serverModule[key].listen) {
      module.exports = serverModule[key];
      break;
    }
  }
}

if (!module.exports) {
  throw new Error('Could not find Express app in server.js');
}
