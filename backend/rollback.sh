#!/bin/bash

echo "🔄 Rolling back to Working Firebase Authentication Checkpoint..."
echo "📅 Checkpoint Date: September 1, 2025"
echo ""

# Stop any running servers
echo "🛑 Stopping running servers..."
pkill -f "ts-node|nodemon" 2>/dev/null
sleep 2

# Check if we are in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must run this script from the backend directory"
    echo "   Current directory: $(pwd)"
    echo "   Please cd to backend/ and run again"
    exit 1
fi

# Create backup of current state (optional)
echo "💾 Creating backup of current state..."
mkdir -p checkpoints/backup-$(date +%Y%m%d-%H%M%S)
cp -r routes middleware types services utils server.ts tsconfig.json package.json checkpoints/backup-$(date +%Y%m%d-%H%M%S)/ 2>/dev/null

# Restore from checkpoint
echo "📥 Restoring files from checkpoint..."
cp -r checkpoints/working-firebase-auth/* .

echo "✅ Rollback completed!"
echo ""
echo "🚀 To start the server:"
echo "   npm run dev"
echo ""
echo "📊 Health check will be available at:"
echo "   http://localhost:5001/health"
echo ""
echo "🔐 Firebase authentication endpoints:"
echo "   POST /api/auth/social-login"
echo "   GET /api/auth/profile"
echo "   PUT /api/auth/profile"
echo ""
echo "📝 For full details, see: checkpoints/working-firebase-auth/CHECKPOINT_README.md"
