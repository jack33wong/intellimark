#!/bin/bash

# Intellimark Chat Environment Setup Script
# This script helps you create a .env.local file from the template

echo "🚀 Setting up environment configuration for Intellimark Chat..."

# Check if .env.local already exists
if [ -f ".env.local" ]; then
    echo "⚠️  .env.local already exists. Do you want to overwrite it? (y/n)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo "📝 Overwriting existing .env.local..."
    else
        echo "❌ Setup cancelled. .env.local was not modified."
        exit 0
    fi
fi

# Create .env.local from template
if [ -f "config.env.example" ]; then
    cp config.env.example .env.local
    echo "✅ .env.local created successfully from config.env.example"
    echo "📝 You can now edit .env.local with your specific values"
else
    echo "❌ config.env.example not found. Creating basic .env.local..."
    
    cat > .env.local << 'EOF'
# Intellimark Chat Application Environment Configuration

# Application Configuration
NODE_ENV=development
APP_NAME=Intellimark Chat
APP_VERSION=1.0.0

# Backend Configuration
BACKEND_PORT=5001
BACKEND_HOST=localhost
BACKEND_URL=http://localhost:5001

# Frontend Configuration
FRONTEND_PORT=3000
FRONTEND_HOST=localhost
FRONTEND_URL=http://localhost:3000

# API Configuration
API_BASE_URL=http://localhost:5001
API_TIMEOUT=30000

# File Upload Configuration
MAX_FILE_SIZE=52428800
ALLOWED_FILE_TYPES=application/pdf
UPLOAD_PATH=backend/uploads

# Security Configuration
CORS_ORIGIN=http://localhost:3000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Development Configuration
DEBUG=true
HOT_RELOAD=true
EOF

    echo "✅ Basic .env.local created successfully"
fi

echo ""
echo "🔧 Next steps:"
echo "1. Edit .env.local with your specific configuration values"
echo "2. Restart your application to load the new environment variables"
echo "3. The .env.local file is already in .gitignore for security"
echo ""
echo "📁 Files created:"
echo "   - .env.local (your environment configuration)"
echo "   - config.env.example (template for future reference)"
echo ""
echo "🎉 Environment setup complete!"
