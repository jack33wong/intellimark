#!/bin/bash

# IntelliMark Firebase Deployment Script
# This script prepares and deploys both frontend and backend to Firebase

set -e  # Exit on any error

echo "🚀 Starting IntelliMark Firebase Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

# Create deployment directory
DEPLOY_DIR="deploy"
print_status "Creating deployment directory: $DEPLOY_DIR"
rm -rf $DEPLOY_DIR
mkdir -p $DEPLOY_DIR

# Build Frontend
print_status "Building frontend..."
cd frontend
if [ ! -d "node_modules" ]; then
    print_status "Installing frontend dependencies..."
    npm install
fi

npm run build
print_success "Frontend built successfully"

# Copy frontend build to deploy directory
print_status "Copying frontend build to deploy directory..."
cp -r build/* ../$DEPLOY_DIR/
cd ..

# Build Backend (TypeScript to JavaScript)
print_status "Building backend (TypeScript to JavaScript)..."
cd backend

# Install backend dependencies if needed
if [ ! -d "node_modules" ]; then
    print_status "Installing backend dependencies..."
    npm install
fi

# Build TypeScript to JavaScript
npm run build:deploy
print_success "Backend built successfully"

# Copy backend to deploy directory
print_status "Copying backend to deploy directory..."
mkdir -p ../$DEPLOY_DIR/functions
cp -r dist/* ../$DEPLOY_DIR/functions/
cp package.json ../$DEPLOY_DIR/functions/
cp package-lock.json ../$DEPLOY_DIR/functions/

# Copy environment files if they exist
if [ -f ".env.local" ]; then
    print_status "Copying environment file..."
    cp .env.local ../$DEPLOY_DIR/functions/
fi

# Copy Firebase service account key if it exists
if [ -f "intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json" ]; then
    print_status "Copying Firebase service account key..."
    cp intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json ../$DEPLOY_DIR/functions/
fi

cd ..

# Create Firebase configuration
print_status "Creating Firebase configuration..."
cat > $DEPLOY_DIR/firebase.json << EOF
{
  "hosting": {
    "public": ".",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**",
      "functions/**"
    ],
    "rewrites": [
      {
        "source": "/api/**",
        "function": "api"
      },
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs18"
  }
}
EOF

# Create functions package.json
print_status "Creating functions package.json..."
cat > $DEPLOY_DIR/functions/package.json << EOF
{
  "name": "intellimark-functions",
  "version": "1.0.0",
  "description": "IntelliMark Firebase Functions",
  "main": "server.js",
  "engines": {
    "node": "18"
  },
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@google-cloud/firestore": "^7.11.3",
    "@grpc/proto-loader": "^0.8.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "firebase-admin": "^13.5.0",
    "google-gax": "^5.0.3",
    "helmet": "^7.1.0",
    "sharp": "^0.34.3",
    "stripe": "^18.5.0",
    "uuid": "^9.0.1"
  }
}
EOF

# Create Firebase Functions entry point
print_status "Creating Firebase Functions entry point..."
cat > $DEPLOY_DIR/functions/index.js << EOF
const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp();

// Import the compiled Express app
const app = require('./server.js');

// Export the Express app as a Firebase Function
exports.api = functions.https.onRequest(app);
EOF

print_success "Deployment package created successfully!"
print_status "Deployment directory structure:"
tree $DEPLOY_DIR -I 'node_modules' || ls -la $DEPLOY_DIR

echo ""
print_success "🎉 Deployment preparation complete!"
echo ""
print_status "Next steps:"
echo "1. cd $DEPLOY_DIR"
echo "2. firebase login (if not already logged in)"
echo "3. firebase use <your-project-id>"
echo "4. firebase deploy"
echo ""
print_warning "Make sure you have Firebase CLI installed: npm install -g firebase-tools"
