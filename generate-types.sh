#!/bin/bash

# Auto-Generated Types Pipeline
# Generates API spec from backend and creates frontend types

echo "🚀 Starting Auto-Generated Types Pipeline..."

# Step 1: Generate API spec from backend
echo "📋 Step 1: Generating API specification from backend..."
cd backend
npm run generate-api-spec
if [ $? -ne 0 ]; then
    echo "❌ Failed to generate API spec"
    exit 1
fi

# Step 2: Generate examples for API schemas
echo "🎨 Step 2: Generating examples for API schemas..."
npm run generate-examples
if [ $? -ne 0 ]; then
    echo "❌ Failed to generate examples"
    exit 1
fi

# Step 3: Generate frontend types from API spec
echo "🔧 Step 3: Generating frontend types from API spec..."
cd ../frontend
npm run generate-types
if [ $? -ne 0 ]; then
    echo "❌ Failed to generate frontend types"
    exit 1
fi

echo "✅ Auto-Generated Types Pipeline completed successfully!"
echo "📄 API spec: backend/api-spec.json (with examples)"
echo "📄 Frontend types: frontend/src/types/api.ts"
echo "🌐 Swagger UI: http://localhost:5001/api-docs"
echo ""
echo "🎯 Next steps:"
echo "1. Check Swagger UI for rich examples"
echo "2. Test API endpoints with examples"
echo "3. Update frontend components if needed"

