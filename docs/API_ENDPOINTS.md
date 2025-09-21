# IntelliMark API Endpoints Documentation

## Overview

This document provides comprehensive documentation for all API endpoints in the IntelliMark system. The API is built with Express.js and TypeScript, providing RESTful endpoints for homework marking, chat functionality, authentication, and administration.

**Base URL**: `http://localhost:5001/api` (development)  
**Authentication**: JWT tokens via Firebase Auth  
**Content-Type**: `application/json`

## Authentication

All endpoints (except health checks) require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <jwt-token>
```

## Response Format

All API responses follow this standard format:
```json
{
  "success": true|false,
  "data": {...}, // Present on success
  "error": "Error message", // Present on error
  "timestamp": "2025-09-21T10:30:00.000Z"
}
```

---

## Authentication Endpoints (`/api/auth`)

### GET `/api/auth/test-updated-code`
Health check for authentication service.

**Response:**
```json
{
  "success": true,
  "message": "Server is running updated code",
  "timestamp": "2025-09-21T10:30:00.000Z"
}
```

### POST `/api/auth/login`
Authenticate user with Firebase.

**Request Body:**
```json
{
  "idToken": "firebase-id-token"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "uid": "user-id",
      "email": "user@example.com",
      "displayName": "User Name"
    },
    "token": "jwt-token"
  }
}
```

### POST `/api/auth/logout`
Logout user and invalidate token.

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### GET `/api/auth/user`
Get current authenticated user information.

**Response:**
```json
{
  "success": true,
  "data": {
    "uid": "user-id",
    "email": "user@example.com",
    "displayName": "User Name",
    "role": "user"
  }
}
```

---

## Mark Homework Endpoints (`/api/mark-homework`)

### POST `/api/mark-homework/upload`
Upload image and create initial user message.

**Request Body:**
```json
{
  "imageData": "base64-encoded-image",
  "model": "gemini-2.5-pro",
  "userId": "user-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "messageId": "msg-456",
    "imageLink": "https://storage.googleapis.com/...",
    "processingTime": 1500
  }
}
```

### POST `/api/mark-homework/process-single`
Single-phase image processing (main endpoint for initial uploads).

**Request Body:**
```json
{
  "imageData": "base64-encoded-image",
  "model": "gemini-2.5-pro",
  "userId": "user-id",
  "userEmail": "user@example.com",
  "sessionId": "session-123" // Optional for follow-up
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "isQuestionOnly": false,
    "isPastPaper": false,
    "annotatedImage": "base64-encoded-annotated-image",
    "aiResponse": "AI analysis and feedback...",
    "metadata": {
      "totalProcessingTimeMs": 2500,
      "apiUsed": "Single-Phase AI Marking System",
      "modelUsed": "gemini-2.5-pro",
      "ocrMethod": "Hybrid OCR"
    }
  }
}
```

### POST `/api/mark-homework/process`
Process follow-up text messages.

**Request Body:**
```json
{
  "message": "Follow-up question text",
  "sessionId": "session-123",
  "model": "gemini-2.5-pro",
  "userId": "user-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "aiResponse": "AI response to follow-up question...",
    "metadata": {
      "processingTimeMs": 800,
      "apiUsed": "Follow-up Processing",
      "modelUsed": "gemini-2.5-pro"
    }
  }
}
```

### GET `/api/mark-homework/stats`
Get system statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalSessions": 150,
    "totalUsers": 25,
    "averageProcessingTime": 2.1,
    "lastUpdated": "2025-09-21T10:30:00.000Z"
  }
}
```

### GET `/api/mark-homework/health`
Health check for mark homework service.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "service": "Complete Mark Question System",
  "features": [
    "AI Image Classification",
    "Real OCR Processing",
    "AI Marking Instructions",
    "Professional SVG Overlays",
    "Real Firestore Database Storage",
    "User History & Statistics"
  ],
  "timestamp": "2025-09-21T10:30:00.000Z"
}
```

---

## Messages Endpoints (`/api/messages`)

### POST `/api/messages/chat`
Unified chat endpoint for conversational flow.

**Request Body:**
```json
{
  "message": "User message text",
  "imageData": "base64-encoded-image", // Optional
  "model": "gemini-2.5-pro",
  "sessionId": "session-123", // Optional
  "mode": "marking" // or "question"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "messageId": "msg-456",
    "aiResponse": "AI response...",
    "imageLink": "https://storage.googleapis.com/...", // If image provided
    "sessionTitle": "Chat Session",
    "metadata": {
      "processingTimeMs": 1200,
      "apiUsed": "Unified Chat System"
    }
  }
}
```

### GET `/api/messages/sessions`
Get user's chat sessions.

**Query Parameters:**
- `limit`: Number of sessions to return (default: 20)
- `offset`: Number of sessions to skip (default: 0)
- `filter`: Filter by type ('all', 'favorites', 'recent')

**Response:**
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "session-123",
        "title": "Math Homework Session",
        "messageCount": 5,
        "createdAt": "2025-09-21T10:30:00.000Z",
        "updatedAt": "2025-09-21T10:35:00.000Z",
        "favorite": false,
        "rating": 4
      }
    ],
    "totalCount": 25,
    "hasMore": true
  }
}
```

### GET `/api/messages/sessions/:id`
Get specific session details.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "session-123",
    "title": "Math Homework Session",
    "messages": [
      {
        "id": "msg-1",
        "role": "user",
        "content": "I need help with this math problem",
        "imageData": "base64-encoded-image",
        "timestamp": "2025-09-21T10:30:00.000Z"
      },
      {
        "id": "msg-2",
        "role": "assistant",
        "content": "I can help you with that math problem...",
        "timestamp": "2025-09-21T10:30:15.000Z"
      }
    ],
    "favorite": false,
    "rating": 4,
    "createdAt": "2025-09-21T10:30:00.000Z",
    "updatedAt": "2025-09-21T10:35:00.000Z"
  }
}
```

### DELETE `/api/messages/sessions/:id`
Delete a chat session.

**Response:**
```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

---

## Admin Endpoints (`/api/admin`)

### GET `/api/admin/json/collections/:collectionName`
Get all entries from a JSON collection.

**Path Parameters:**
- `collectionName`: Name of the collection (e.g., 'fullExamPapers', 'questionBanks', 'markingSchemes')

**Response:**
```json
{
  "success": true,
  "data": {
    "collectionName": "fullExamPapers",
    "entries": [
      {
        "id": "exam-1",
        "title": "Math Exam 2025",
        "subject": "Mathematics",
        "totalMarks": 100,
        "uploadedAt": "2025-09-21T10:30:00.000Z"
      }
    ]
  }
}
```

### POST `/api/admin/json/collections/markingSchemes`
Upload marking scheme data.

**Request Body:**
```json
{
  "title": "Math Marking Scheme 2025",
  "subject": "Mathematics",
  "scheme": {
    "question1": {
      "marks": 10,
      "criteria": ["Correct formula", "Correct calculation", "Correct answer"]
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "scheme-123",
    "message": "Marking scheme uploaded successfully"
  }
}
```

### GET `/api/admin/users`
Get all users (admin only).

**Response:**
```json
{
  "success": true,
  "data": {
    "users": [
      {
        "uid": "user-1",
        "email": "user1@example.com",
        "displayName": "User One",
        "role": "user",
        "createdAt": "2025-09-21T10:30:00.000Z",
        "lastLogin": "2025-09-21T10:30:00.000Z"
      }
    ],
    "totalCount": 25
  }
}
```

### GET `/api/admin/stats`
Get admin statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalUsers": 25,
    "totalSessions": 150,
    "totalImages": 300,
    "averageSessionDuration": 5.2,
    "systemUptime": "7 days, 12 hours",
    "lastUpdated": "2025-09-21T10:30:00.000Z"
  }
}
```

---

## Payment Endpoints (`/api/payment`)

### POST `/api/payment/create-checkout-session`
Create Stripe checkout session.

**Request Body:**
```json
{
  "planId": "pro",
  "billingCycle": "monthly",
  "userId": "user-123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "cs_1234567890",
    "url": "https://checkout.stripe.com/pay/cs_1234567890"
  }
}
```

### POST `/api/payment/create-portal-session`
Create Stripe customer portal session.

**Request Body:**
```json
{
  "userId": "user-123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://billing.stripe.com/p/session_1234567890"
  }
}
```

### POST `/api/payment/webhook`
Stripe webhook handler (internal use).

---

## Debug Endpoints (`/api/debug`)

### POST `/api/debug/toggle`
Toggle debug mode on/off.

**Request Body:**
```json
{
  "debugMode": true
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "debugMode": true,
    "message": "Debug mode enabled"
  }
}
```

### GET `/api/debug/status`
Get current debug mode status.

**Response:**
```json
{
  "success": true,
  "data": {
    "debugMode": true,
    "fakeDelayMs": 1000,
    "returnOriginalImage": true
  }
}
```

---

## Unified Processing Endpoints (`/api/process`)

### POST `/api/process`
Unified image processing endpoint.

**Request Body:**
```json
{
  "imageData": "base64-encoded-image",
  "model": "gemini-2.5-pro",
  "sessionId": "session-123",
  "isFollowUp": false
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "result": {
      "isQuestionOnly": false,
      "annotatedImage": "base64-encoded-annotated-image",
      "aiResponse": "AI analysis...",
      "metadata": {
        "processingTimeMs": 2000,
        "apiUsed": "Unified Processing"
      }
    }
  }
}
```

### POST `/api/process/ai`
AI response processing endpoint.

**Request Body:**
```json
{
  "imageData": "base64-encoded-image",
  "sessionId": "session-123",
  "model": "gemini-2.5-pro"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "session-123",
    "aiResponse": "AI response...",
    "annotatedImageLink": "https://storage.googleapis.com/...",
    "metadata": {
      "processingTimeMs": 1500,
      "apiUsed": "AI Response Processing"
    }
  }
}
```

---

## Error Codes

### HTTP Status Codes
- `200` - Success
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found (resource doesn't exist)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

### Common Error Responses

**Authentication Error:**
```json
{
  "success": false,
  "error": "Invalid or expired token",
  "code": "AUTH_ERROR"
}
```

**Validation Error:**
```json
{
  "success": false,
  "error": "Image data is required",
  "code": "VALIDATION_ERROR",
  "details": {
    "field": "imageData",
    "message": "This field is required"
  }
}
```

**Rate Limit Error:**
```json
{
  "success": false,
  "error": "Rate limit exceeded. Please try again later.",
  "code": "RATE_LIMIT_ERROR",
  "retryAfter": 60
}
```

**Server Error:**
```json
{
  "success": false,
  "error": "Internal server error",
  "code": "INTERNAL_ERROR",
  "requestId": "req-123456789"
}
```

---

## Rate Limiting

- **General endpoints**: 100 requests per minute per IP
- **Image processing**: 10 requests per minute per user
- **Authentication**: 5 requests per minute per IP
- **Admin endpoints**: 50 requests per minute per user

## Request/Response Examples

### Complete Workflow Example

1. **Login**
```bash
curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"idToken": "firebase-id-token"}'
```

2. **Upload Image**
```bash
curl -X POST http://localhost:5001/api/mark-homework/process-single \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer jwt-token" \
  -d '{
    "imageData": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "model": "gemini-2.5-pro",
    "userId": "user-123"
  }'
```

3. **Follow-up Message**
```bash
curl -X POST http://localhost:5001/api/mark-homework/process \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer jwt-token" \
  -d '{
    "message": "Can you explain step 3 in more detail?",
    "sessionId": "session-123",
    "model": "gemini-2.5-pro",
    "userId": "user-123"
  }'
```

---

*Last Updated: September 21, 2025*  
*API Version: 1.0.0*
