#!/bin/bash

echo "🚀 Starting Intellimark Chat Application..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "📦 Installing dependencies..."
npm run install-all

echo "🔧 Setting up environment..."
cd backend
if [ ! -f .env.local ]; then
  cp config.env.example .env.local
  echo "✅ Created .env.local file from template"
fi
cd ..

echo "🌐 Starting backend server on port 5001..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

echo "⏳ Waiting for backend to start..."
sleep 5

echo "🎨 Starting frontend on port 3000..."
cd frontend
npm start &
FRONTEND_PID=$!
cd ..

echo "✅ Application started successfully!"
echo ""
echo "🌐 Backend: http://localhost:5001"
echo "🎨 Frontend: http://localhost:3000"
echo "📊 Health Check: http://localhost:5001/health"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user to stop
trap "echo '🛑 Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
