#!/bin/bash

# IntelliMark Production Deployment Script (Improved)
# This script provides a reliable way to build and deploy to Firebase

set -e  # Exit on any error

echo "🚀 IntelliMark Production Deployment (Improved)"
echo "=============================================="

# Check if we're in the right directory
if [ ! -f "backend/package.json" ] || [ ! -f "frontend/package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    echo "   Expected files: backend/package.json, frontend/package.json"
    exit 1
fi

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Error: Firebase CLI is not installed"
    echo "Please install it with: npm install -g firebase-tools"
    exit 1
fi

# Check if we're logged into Firebase
if ! firebase projects:list &> /dev/null; then
    echo "❌ Error: Not logged into Firebase"
    echo "Please run: firebase login"
    exit 1
fi


echo "🧹 Cleaning deploy directory..."
# Preserve firebase.json and .firebase directory
if [ -f "deploy/firebase.json" ]; then
    cp deploy/firebase.json /tmp/firebase.json.backup
fi
if [ -d "deploy/.firebase" ]; then
    cp -r deploy/.firebase /tmp/.firebase.backup
fi

rm -rf deploy/*
mkdir -p deploy/functions

# Restore firebase.json and .firebase directory
if [ -f "/tmp/firebase.json.backup" ]; then
    cp /tmp/firebase.json.backup deploy/firebase.json
    rm /tmp/firebase.json.backup
fi
if [ -d "/tmp/.firebase.backup" ]; then
    cp -r /tmp/.firebase.backup deploy/.firebase
    rm -rf /tmp/.firebase.backup
fi

echo "📦 Building production backend..."

# Build the production backend
cd backend
npm run build:production

if [ $? -ne 0 ]; then
    echo "❌ Backend build failed"
    exit 1
fi

echo "✅ Backend build completed successfully"

echo "📦 Building production frontend..."

# Build the production frontend
cd ../frontend
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed"
    exit 1
fi

echo "✅ Frontend build completed successfully"

echo "📦 Copying frontend files to deploy directory..."

# Copy frontend build to deploy directory
cp -r build/* ../deploy/

echo "✅ Frontend files copied successfully"

# Go to deploy directory
cd ../deploy

echo "📦 Installing Firebase Functions dependencies..."
cd functions
npm install
cd ..

echo "🚀 Deploying to Firebase..."

# Deploy to Firebase
firebase deploy

if [ $? -eq 0 ]; then
    echo "✅ Deployment completed successfully!"
    echo "🌐 Your app is live at: https://intellimark-6649e.web.app"
    echo "📊 Backend API: https://us-central1-intellimark-6649e.cloudfunctions.net/api"
else
    echo "❌ Deployment failed"
    exit 1
fi
