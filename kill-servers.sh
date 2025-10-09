#!/bin/bash

# Kill servers script for Intellimark development
# Kills processes running on ports 3000 (frontend) and 5001 (backend)

echo "🔄 Killing servers on ports 3000 and 5001..."

# Kill frontend server (port 3000)
echo "📱 Killing frontend server (port 3000)..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || echo "No process found on port 3000"

# Kill backend server (port 5001)
echo "🔧 Killing backend server (port 5001)..."
lsof -ti:5001 | xargs kill -9 2>/dev/null || echo "No process found on port 5001"

echo "✅ Servers killed successfully!"
echo "💡 You can now start fresh servers with:"
echo "   Frontend: cd frontend && npm start"
echo "   Backend: cd backend && npx tsx server.ts"








