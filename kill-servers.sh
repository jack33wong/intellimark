#!/bin/bash

# Kill servers script for AI Marking development
# Kills backend processes running on port 5001 and related processes

echo "🔄 Killing backend servers on port 5001..."

# Kill backend server (port 5001)
echo "🔧 Killing backend server (port 5001)..."
lsof -ti:5001 | xargs kill -9 2>/dev/null || echo "No process found on port 5001"

# Kill nodemon processes that might be managing the server
echo "🔄 Killing nodemon processes..."
pkill -f "nodemon.*server.ts" 2>/dev/null || echo "No nodemon processes found"

# Kill any tsx processes running server.ts
echo "🔄 Killing tsx server processes..."
pkill -f "tsx.*server.ts" 2>/dev/null || echo "No tsx server processes found"

echo "✅ Backend servers killed successfully!"
echo "💡 You can now start fresh backend server with:"
echo "   Backend: npm run dev"
