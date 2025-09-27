# 🚀 API Migration Guide

## Overview

The marking homework API has been refactored to eliminate code duplication and provide a unified, maintainable solution. All duplicate endpoints have been replaced with a single, powerful endpoint.

## ⚠️ Breaking Changes

### Removed Endpoints

The following endpoints have been **COMPLETELY REMOVED** to avoid caching issues:

- `POST /api/mark-homework/upload` → **REMOVED**
- `POST /api/mark-homework/process-single` → **REMOVED**
- `POST /api/mark-homework/process` → **REMOVED**
- `POST /api/mark-homework/process-single-stream` → **REMOVED**
- `POST /api/process` → **REMOVED**

### New Unified Endpoints

**`POST /api/unified/process`** - Handles all processing flows (regular)
**`POST /api/unified/process-stream`** - Handles all processing flows with SSE (real-time progress)

## 🔄 Migration Examples

### 1. First-time Image Upload

**Old:**
```javascript
const response = await fetch('/api/mark-homework/process-single', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageData: 'base64...',
    model: 'auto'
  })
});
```

**New:**
```javascript
const response = await fetch('/api/unified/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageData: 'base64...',
    model: 'auto',
    mode: 'auto'  // New parameter
  })
});
```

### 2. Follow-up Image Upload

**Old:**
```javascript
const response = await fetch('/api/mark-homework/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageData: 'base64...',
    sessionId: 'session-123',
    model: 'auto'
  })
});
```

**New:**
```javascript
const response = await fetch('/api/unified/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    imageData: 'base64...',
    sessionId: 'session-123',
    model: 'auto',
    mode: 'auto'  // New parameter
  })
});
```

### 3. Text-only Chat

**Old:**
```javascript
const response = await fetch('/api/messages/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What is 2+2?',
    model: 'auto'
  })
});
```

**New:**
```javascript
const response = await fetch('/api/unified/process', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'What is 2+2?',
    model: 'auto',
    mode: 'chat'  // New parameter
  })
});
```

## 📋 New Parameters

### Required Parameters
- **Either** `imageData` **or** `message` must be provided

### Optional Parameters
- `sessionId` - For follow-up messages (existing session)
- `model` - AI model (`'auto'`, `'gemini-2.5-pro'`, `'gemini-2.0-flash'`)
- `mode` - Processing mode (`'auto'`, `'marking'`, `'question'`, `'chat'`)

## 🎯 Flow Detection

The unified endpoint automatically detects the flow type:

| Input | Flow Type | Description |
|-------|-----------|-------------|
| `imageData` only | `image_only` | Image processing |
| `message` only | `text` | Text-only chat |
| `imageData` + `message` | `image_with_text` | Image with text context |

## 🔐 Authentication

- **Authenticated users**: Full persistence, image links, session management
- **Unauthenticated users**: In-memory only, base64 images, no persistence

## 📊 Response Format

The unified endpoint returns a consistent response format:

```javascript
{
  "success": true,
  "flowType": "text|image_only|image_with_text",
  "isAuthenticated": false,
  "result": {
    "message": "AI response text",
    "isQuestionOnly": true,
    "sessionTitle": "Session Title",
    "progressData": { /* progress information */ },
    "metadata": { /* additional metadata */ },
    "imageLink": "https://...", // For authenticated users
    "imageData": "base64..."    // For unauthenticated users
  },
  "session": { /* session data for authenticated users */ }
}
```

## 🏥 Health Check

**`GET /api/unified/process/health`** - Service health check

```javascript
{
  "success": true,
  "service": "unified-marking",
  "status": "healthy",
  "timestamp": "2025-09-27T14:29:16.729Z",
  "version": "1.0.0"
}
```

## 🚀 Benefits

1. **Single endpoint** - No more confusion about which endpoint to use
2. **Consistent behavior** - Same logic across all flows
3. **Better maintainability** - Single place to fix bugs
4. **Easier testing** - Test one endpoint instead of multiple
5. **Future-proof** - Easy to add new features

## 📝 Migration Checklist

- [ ] Update frontend to use `/api/unified/process`
- [ ] Add `mode` parameter to requests
- [ ] Update error handling for new response format
- [ ] Test all flows (image, text, follow-up)
- [ ] Remove old endpoint calls
- [ ] Update documentation

## 🆘 Support

If you encounter issues during migration:

1. Check the deprecated endpoint response for migration details
2. Verify the new endpoint works: `GET /api/unified/process/health`
3. Test with simple requests first
4. Check server logs for detailed error messages

---

**Migration Deadline**: Deprecated endpoints will be removed in a future version. Please migrate as soon as possible.
