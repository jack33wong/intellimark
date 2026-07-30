#!/bin/bash

# AI Marking Production Deployment Script (Cloud Run + Firebase Hosting)
# This script deploys the backend container to Google Cloud Run,
# and builds the frontend and deploys it to Firebase Hosting.

set -e  # Exit on any error

echo "🚀 AI Marking Production Deployment (Cloud Run Architecture)"
echo "=========================================================="

# Check if we're in the right directory
if [ ! -f "backend/package.json" ] || [ ! -f "frontend/package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Error: Firebase CLI is not installed"
    exit 1
fi

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI is not installed"
    exit 1
fi

PROJECT_ID="intellimark-6649e"
REGION="europe-west2"
SERVICE_NAME="api-backend"

echo "🚀 Deploying Backend to Google Cloud Run..."
cd backend

# Securely inject environment variables without baking them into the Docker image
ENV_VARS_FLAG=""
if [ -f ".env.local" ]; then
    echo "🔒 Securing environment variables from .env.local..."
    node -e "
const fs = require('fs');
const dotenv = require('dotenv');
const parsed = dotenv.parse(fs.readFileSync('.env.local'));
let yaml = '';
for (const [k, v] of Object.entries(parsed)) {
  yaml += k + ': ' + JSON.stringify(v) + '\n';
}
fs.writeFileSync('env.yaml', yaml);
"
    ENV_VARS_FLAG="--env-vars-file env.yaml"
fi

# Deploy to Cloud Run
# This will automatically build the Dockerfile using Google Cloud Build and deploy it
gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --memory 8Gi \
  --cpu 8 \
  --timeout 3600 \
  --concurrency 5 \
  --no-cpu-throttling \
  $ENV_VARS_FLAG \
  --quiet

# Clean up temporary yaml
if [ -f "env.yaml" ]; then
    rm env.yaml
fi

if [ $? -ne 0 ]; then
    echo "❌ Backend Cloud Run deployment failed"
    exit 1
fi

CLOUD_RUN_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --project $PROJECT_ID --format 'value(status.url)')
echo "✅ Backend deployed successfully to Cloud Run at: $CLOUD_RUN_URL"
cd ..


echo "📦 Building production frontend..."

# Build the production frontend
cd frontend
export REACT_APP_API_BASE_URL=$CLOUD_RUN_URL
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed"
    exit 1
fi

echo "✅ Frontend build completed successfully"
cd ..

echo "🧹 Preparing deploy directory..."
# Deep clean deploy directory but keep firebase config
find deploy -mindepth 1 ! -name 'firebase.json' ! -name '.firebaserc' -delete

echo "📦 Copying frontend files to deploy directory..."
cp -r frontend/build/* deploy/

echo "🚀 Deploying Frontend and Routing to Firebase Hosting..."
cd deploy

# Deploy only hosting
firebase deploy --only hosting --project $PROJECT_ID

if [ $? -eq 0 ]; then
    echo "✅ Deployment completed successfully!"
    echo "🌐 Your app is live at: https://$PROJECT_ID.web.app"
    echo "📊 Backend API is served via Cloud Run at $CLOUD_RUN_URL."
    echo "⏰ Deployment Time: $(date)"
else
    echo "❌ Firebase Hosting deployment failed"
    exit 1
fi
