#!/bin/bash

# IntelliMark Backend Server with API Documentation
echo "🚀 Starting IntelliMark Backend Server with Swagger UI..."
echo ""

# Check if API spec exists
if [ ! -f "api-spec.json" ]; then
    echo "⚠️  API spec not found. Generating..."
    npm run generate-api-spec
    echo ""
fi

# Start the server
echo "📚 API Documentation will be available at:"
echo "   • Swagger UI: http://localhost:5001/api-docs"
echo "   • API Info:   http://localhost:5001/api"
echo "   • Health:     http://localhost:5001/health"
echo ""
echo "🔗 Quick links:"
echo "   • http://localhost:5001/docs (redirects to Swagger UI)"
echo "   • http://localhost:5001/swagger (redirects to Swagger UI)"
echo ""

npm start

