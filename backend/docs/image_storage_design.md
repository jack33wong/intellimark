# Image Storage Design Document

## 🎯 **Core Design Principles**

### **1. Authentication-Based Storage Strategy**
- **Authenticated Users**: Store images in Firebase Storage with persistent URLs
- **Unauthenticated Users**: No database persistence, base64 only for immediate display

### **2. Message Type Differentiation**
- **User Messages**: Always contain uploaded images (user input)
- **Assistant Messages**: May contain annotated images (AI output)

### **3. Display Context Separation**
- **Live Response**: Immediate display format (varies by user type and message type)
- **Chat History**: Persistent storage format (Firebase URLs for authenticated users only)

---

## 📊 **Design Matrix**

| User Type | Message Type | Database Storage | Live Response | Chat History |
|-----------|--------------|-----------------|---------------|--------------|
| **Authenticated** | User Message | Firebase URL | Base64 | Firebase URL |
| **Authenticated** | Assistant Message | Firebase URL | **Firebase URL** | Firebase URL |
| **Unauthenticated** | User Message | No Storage | Base64 | N/A (No History) |
| **Unauthenticated** | Assistant Message | No Storage | Base64 | N/A (No History) |

---

## 🏗️ **Architectural Principles**

### **Separation of Concerns**
- **Database Layer**: Firebase URLs only, no base64 contamination
- **Response Layer**: Appropriate format per message type and user type
- **Storage Layer**: Firebase Storage for authenticated users, base64 for unauthenticated

### **Data Flow Isolation**
- **Database Persistence**: Use dedicated objects with Firebase URLs
- **Live Response**: Use separate objects with appropriate display format
- **No Object Reuse**: Prevent side effects between database and response layers

---

## 📋 **Authentication-Specific Design**

### **Authenticated Users**
- **Upload**: Images → Firebase Storage → Firebase URL
- **Database**: Store Firebase URLs in `imageDataArray[].url`
- **Response**: 
  - User messages: Base64 for immediate display
  - Assistant messages: Firebase URLs for efficient loading
- **History**: Firebase URLs with progressive loading

### **Unauthenticated Users**
- **Upload**: Images → Base64 conversion only
- **Database**: No persistence
- **Response**: Base64 for all message types
- **History**: No chat history available

---

## 🖼️ **Image Type Design**

### **User Images (Uploaded)**
- **Source**: User file upload
- **Purpose**: Input for AI processing
- **Storage**: Firebase Storage (auth) or base64 (unauth)
- **Display**: 
  - Authenticated: Base64 for immediate display, Firebase URLs for history
  - Unauthenticated: Base64 only

### **Assistant Images (Annotated)**
- **Source**: AI-generated annotations
- **Purpose**: Output for user review
- **Storage**: Firebase Storage (auth) or base64 (unauth)
- **Display**: 
  - Authenticated: Firebase URLs for both immediate display and history
  - Unauthenticated: Base64 only

---

## 📈 **Performance Design**

### **Storage Efficiency**
- **Firebase URLs**: ~200 bytes per image reference
- **Base64**: ~1.8MB per image (1000x larger)
- **Database Impact**: 1000x storage reduction for authenticated users

### **Loading Performance**
- **Live Response**: 
  - User messages: Base64 for instant display
  - Assistant messages: Firebase URLs with progressive loading
- **Chat History**: Firebase URLs with progressive loading
- **Caching**: Firebase URLs enable browser/CDN caching

---

## 🎯 **Design Goals**

### **Functional Requirements**
- ✅ Authenticated users: Firebase URLs in database
- ✅ Unauthenticated users: No database persistence
- ✅ Live responses: Appropriate format per message type
- ✅ Chat history: Firebase URLs for efficient loading

### **Architectural Requirements**
- ✅ No base64 contamination in database
- ✅ Proper object isolation between DB and response
- ✅ Efficient storage utilization
- ✅ Maintainable code architecture

---

This design document defines the **core architectural principles** for image storage, focusing on authentication-based strategies, message type differentiation, and display context separation. The design ensures efficient storage for authenticated users while providing immediate display capabilities for all users.

---

## 📊 **imageDataArray Structure**

### **Core Data Structure**
All image storage uses the `imageDataArray` field exclusively. This field contains an array of image objects, supporting 1 to N images per message.

### **imageDataArray Object Structure**
```typescript
interface ImageDataObject {
  url: string;                    // Firebase URL (DB) or Base64 (Response)
  originalFileName: string;        // Original filename (e.g., "q21-edexcel-ball-pen-stroke.png")
  fileSize: number;               // File size in bytes
}
```

### **Storage Patterns**

#### **Single Image (1 image)**
```typescript
imageDataArray: [
  {
    url: "https://storage.googleapis.com/.../annotated-q21-edexcel-ball-pen-stroke-1761486663043-a1b2c3.png",
    originalFileName: "q21-edexcel-ball-pen-stroke.png",
    fileSize: 422504
  }
]
```

#### **Multiple Images (N images)**
```typescript
imageDataArray: [
  {
    url: "https://storage.googleapis.com/.../annotated-q13-14-edexcel-ball-pen-1761486663043-a1b2c3.png",
    originalFileName: "q13-14-edexcel-ball-pen.png",
    fileSize: 380107
  },
  {
    url: "https://storage.googleapis.com/.../annotated-q21-edexcel-bottom-no-cut-1761486663044-b2c3d4.png",
    originalFileName: "q21-edexcel-bottom-no-cut.png",
    fileSize: 422504
  }
]
```

### **Design Principles for imageDataArray**

1. **Single Source of Truth**: All image data goes through `imageDataArray` only
2. **Consistent Structure**: Same object structure for all images (1 to N)
3. **No Alternative Fields**: Never use `imageLink`, `imageData`, or other image fields
4. **Index Mapping**: Array index corresponds to file upload order
5. **Filename Consistency**: Uses `FilenameService` for all naming patterns

### **Usage Examples**

#### **User Message (Uploaded Images)**
```typescript
// Database Storage
imageDataArray: [
  {
    url: "https://storage.googleapis.com/.../q21-edexcel-ball-pen-stroke.png",
    originalFileName: "q21-edexcel-ball-pen-stroke.png",
    fileSize: 422504
  }
]

// Response Format (User Messages → Base64)
imageDataArray: [
  {
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    originalFileName: "q21-edexcel-ball-pen-stroke.png",
    fileSize: 422504
  }
]
```

#### **Assistant Message (Annotated Images)**
```typescript
// Database Storage
imageDataArray: [
  {
    url: "https://storage.googleapis.com/.../annotated-q21-edexcel-ball-pen-stroke-1761486663043-a1b2c3.png",
    originalFileName: "annotated-q21-edexcel-ball-pen-stroke-1761486663043-a1b2c3.png",
    fileSize: 450123
  }
]

// Response Format (Assistant Messages → Firebase URLs)
imageDataArray: [
  {
    url: "https://storage.googleapis.com/.../annotated-q21-edexcel-ball-pen-stroke-1761486663043-a1b2c3.png",
    originalFileName: "annotated-q21-edexcel-ball-pen-stroke-1761486663043-a1b2c3.png",
    fileSize: 450123
  }
]
```
