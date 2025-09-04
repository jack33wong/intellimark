#!/bin/bash

# Quick Firebase Deployment Script
# Simplified version for faster deployment

set -e

echo "🚀 Quick Firebase Deployment for IntelliMark"

# Build and prepare
echo "📦 Building frontend..."
cd frontend && npm run build && cd ..

echo "🔨 Building backend (TypeScript → JavaScript)..."
cd backend && npm run build:deploy && cd ..

# Create deploy directory
rm -rf deploy
mkdir -p deploy

# Copy frontend
cp -r frontend/build/* deploy/

# Copy backend as functions
mkdir -p deploy/functions
cp -r backend/dist/* deploy/functions/
cp backend/package.json deploy/functions/

# Create Firebase config
cat > deploy/firebase.json << 'EOF'
{
  "hosting": {
    "public": ".",
    "rewrites": [
      {"source": "/api/**", "function": "api"},
      {"source": "**", "destination": "/index.html"}
    ]
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs18"
  }
}
EOF

# Create functions entry point
cat > deploy/functions/index.js << 'EOF'
const functions = require('firebase-functions');
const app = require('./server.js');
exports.api = functions.https.onRequest(app);
EOF

echo "✅ Deployment ready!"
echo "📁 Run: cd deploy && firebase deploy"
