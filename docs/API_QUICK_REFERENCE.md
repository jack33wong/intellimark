# IntelliMark API Quick Reference

## Most Common Endpoints

### 🔐 Authentication
```bash
# Login
POST /api/auth/login
{"idToken": "firebase-token"}

# Get user info
GET /api/auth/user
Authorization: Bearer <token>
```

### 📝 Mark Homework (Main Flow)
```bash
# Initial image upload
POST /api/mark-homework/process-single
Authorization: Bearer <token>
{
  "imageData": "base64-image",
  "model": "gemini-2.5-pro",
  "userId": "user-123"
}

# Follow-up text message
POST /api/mark-homework/process
Authorization: Bearer <token>
{
  "message": "Follow-up question",
  "sessionId": "session-123",
  "model": "gemini-2.5-pro",
  "userId": "user-123"
}
```

### 💬 Chat & Sessions
```bash
# Unified chat
POST /api/messages/chat
Authorization: Bearer <token>
{
  "message": "User message",
  "imageData": "base64-image", // Optional
  "sessionId": "session-123", // Optional
  "model": "gemini-2.5-pro"
}

# Get user sessions
GET /api/messages/sessions?limit=20&filter=all
Authorization: Bearer <token>

# Get specific session
GET /api/messages/sessions/:id
Authorization: Bearer <token>
```

### 🛠️ Debug & Health
```bash
# Health check
GET /api/mark-homework/health

# Toggle debug mode
POST /api/debug/toggle
{"debugMode": true}

# Get debug status
GET /api/debug/status
```

## Response Format
```json
{
  "success": true|false,
  "data": {...}, // On success
  "error": "Error message", // On error
  "timestamp": "2025-09-21T10:30:00.000Z"
}
```

## Common Headers
```bash
Content-Type: application/json
Authorization: Bearer <jwt-token>
```

## Base URL
- Development: `http://localhost:5001/api`
- Production: `https://your-domain.com/api`

## Rate Limits
- General: 100 req/min per IP
- Image processing: 10 req/min per user
- Auth: 5 req/min per IP

---
*For complete documentation, see [API_ENDPOINTS.md](API_ENDPOINTS.md)*
