# Mark Homework Requirements

## 📋 **Overview**

The Mark Homework feature is a core functionality that allows users to upload homework images and receive AI-powered feedback, explanations, and corrections. The system supports both marking mode (full homework with answers) and question mode (question-only images).

## 🎯 **Core Business Requirements**

### **Two Modes of Operation**

#### **1. Marking Mode**
- **Purpose**: Full homework with answers that need to be marked
- **Input**: Image containing both question and student's answer
- **Output**: Marking instructions, corrections, and annotated image
- **AI Response**: Detailed feedback on correctness and improvements

#### **2. Question Mode**
- **Purpose**: Question-only images that need explanations
- **Input**: Image containing only the question (no answer)
- **Output**: Step-by-step explanation and solution
- **AI Response**: Educational content to help understand the problem

### **User Experience Flow**

#### **Step 1: Upload (200-500ms)**
- User selects image or with text and clicks send
- Upload area and chat input moves to bottom (chat mode)
- Send button disabled
- Show inputted text or default message if empty
- Frontend converts to base64 and shows image immediately

#### **Step 2: Backend Processing (???ms)**
- AI thinking animation shows
- Backend processes image and creates session
- Backend generates marking instructions or explanations
- Creates annotated image (for marking mode)
- AI response appears in chat

#### **Step 3: Complete**
- Ready for next interaction
- Send button enabled
- Chat input stays at bottom

## 🔐 **Authentication-Based Behavior**

### **For Authenticated Users**

#### **New Upload Behavior:**
- **User Chat Bubbles**: 
  - Source: Chat session memory (immediate display)
  - Image: From base64 data
  - Persistence: Saved to database in background
- **Assistant Chat Bubbles**:
  - Source: Database (reliable source)
  - Image: From Firebase Storage (annotated images)
  - Persistence: Saved to database

#### **Chat History:**
- **Source**: All data from database
- **Persistence**: Full database persistence for all messages
- **Availability**: Complete chat history across sessions

### **For Unauthenticated Users**

#### **All Data Behavior:**
- **Source**: Chat session memory only
- **Persistence**: No database persistence
- **Chat History**: Not available (lost on page refresh)
- **Image Storage**: Base64 data only (no Firebase Storage)

## 🏗️ **Technical Architecture**

### **Single-Phase API Design**

#### **Endpoint**: `/api/mark-homework/process-single`
- **Function**: Handles upload + classification + AI processing in one call
- **Input**: Image data, model selection, user message (for authenticated users)
- **Output**: AI message structure only
- **Persistence**: Saves to database for authenticated users

#### **Response Structure**:
```json
{
  "success": true,
  "aiMessage": {
    "id": "msg-timestamp-random",
    "role": "assistant",
    "content": "AI response text",
    "type": "question_response" | "marking_annotated",
    "imageLink": "firebase-storage-url", // For authenticated users
    "imageData": "base64-data", // For unauthenticated users
    "metadata": { ... }
  }
}
```

### **Frontend Architecture**

#### **Service Layer**:
- **Single API Call**: One request instead of two-phase
- **Session Management**: Handles authenticated vs unauthenticated users
- **Chat History**: Loads from database for authenticated users
- **Error Handling**: Graceful fallbacks and user feedback

#### **Component Structure**:
- **MarkHomeworkPageConsolidated**: Main page component
- **SimpleSessionService**: API and session management
- **ChatMessage**: Message display component
- **FollowUpChatInput**: Chat input with model selection

## 🎨 **UI Requirements**

### **3-Step Visual Flow**

#### **Phase 1: Upload (200-500ms)**
- Immediate UI transition to chat mode
- User message displayed instantly
- Image preview shown immediately

#### **Phase 2: Processing (???ms)**
- AI thinking animation
- Processing indicators
- No user interaction during processing

#### **Phase 3: Complete**
- AI response displayed
- Ready for next interaction
- Send button re-enabled

### **Chat Interface Requirements**

#### **User Messages**:
- Show uploaded image + text
- Immediate display from session memory
- Consistent styling across modes

#### **Assistant Messages**:
- Show AI response + annotated image (if marking mode)
- Load from database for authenticated users
- Show from API response for unauthenticated users

#### **Model Selection**:
- **Auto**: Use system default (Gemini 2.5 Pro)
- **Gemini 2.5 Pro**: Google Gemini 2.5 Pro
- **ChatGPT 4o**: OpenAI GPT-4 Omni

## 🔧 **Technical Implementation**

### **Backend Services**

#### **Classification Service**:
- **Purpose**: Determine if image is "question-only" or "marking"
- **AI Models**: Gemini 2.5 Pro (default) or ChatGPT 4o
- **Fallback**: Heuristic-based classification when AI unavailable

#### **OCR Service**:
- **Primary**: Google Cloud Vision API
- **Secondary**: Mathpix API
- **Hybrid**: Combines both for best results

#### **AI Processing**:
- **Default Model**: Gemini 2.5 Pro
- **Authentication**: Google Service Account
- **Response**: Marking instructions or explanations

#### **Image Storage**:
- **Authenticated Users**: Firebase Storage
- **Unauthenticated Users**: Base64 data only

#### **Database**:
- **Service**: Firestore
- **Collections**: UnifiedSessions, UnifiedMessages
- **Persistence**: Full persistence for authenticated users

### **Frontend Services**

#### **API Integration**:
- **Single-Phase**: One API call for complete processing
- **Error Handling**: Graceful fallbacks and user feedback
- **Timeout**: 30-second timeout for API calls

#### **Session Management**:
- **Authenticated**: Full database integration
- **Unauthenticated**: Session memory only
- **State Management**: React state with service layer

## 📊 **Data Flow**

### **Authenticated User Flow**

```
1. User uploads image
   ↓
2. Frontend creates user message (session memory)
   ↓
3. Frontend calls single-phase API
   ↓
4. Backend processes image + classification
   ↓
5. Backend saves user + AI messages to database
   ↓
6. Frontend displays AI response from API
   ↓
7. Chat history loads from database
```

### **Unauthenticated User Flow**

```
1. User uploads image
   ↓
2. Frontend creates user message (session memory)
   ↓
3. Frontend calls single-phase API
   ↓
4. Backend processes image + classification
   ↓
5. Backend returns AI response (no database save)
   ↓
6. Frontend displays AI response from API
   ↓
7. No chat history (session memory only)
```

## ✅ **Success Criteria**

### **Functional Requirements**

1. **Immediate Response**: User sees their message instantly
2. **Reliable Persistence**: Data saved for authenticated users
3. **Consistent Experience**: Same UI flow for all users
4. **Chat History**: Available for authenticated users
5. **No Race Conditions**: Single-phase eliminates timing issues
6. **Maintainable Code**: Simple, clean architecture

### **Performance Requirements**

1. **Upload Phase**: 200-500ms for UI transition
2. **Processing Phase**: Variable based on AI response time
3. **API Timeout**: 30 seconds maximum
4. **Image Processing**: Efficient base64 conversion
5. **Database Operations**: Non-blocking persistence

### **User Experience Requirements**

1. **Visual Feedback**: Clear processing indicators
2. **Error Handling**: Graceful error messages
3. **Responsive Design**: Works on all device sizes
4. **Accessibility**: Screen reader compatible
5. **Consistent Styling**: Unified design language

## 🔄 **Integration Points**

### **Authentication System**
- **Frontend**: React authentication context
- **Backend**: JWT token validation
- **Database**: User-specific data isolation

### **File Upload System**
- **Frontend**: Drag-and-drop + click upload
- **Validation**: File type and size checks
- **Processing**: Base64 conversion

### **AI Services**
- **Classification**: Question vs marking detection
- **OCR**: Text extraction from images
- **Generation**: AI responses and explanations

### **Storage Systems**
- **Images**: Firebase Storage (authenticated) or base64 (unauthenticated)
- **Database**: Firestore for sessions and messages
- **Caching**: Frontend state management

## 📝 **Notes**

- **Default Model**: Gemini 2.5 Pro is the system default
- **Fallback**: Heuristic classification when AI services unavailable
- **Persistence**: Only authenticated users get database persistence
- **Chat History**: Only available for authenticated users
- **Single-Phase**: Eliminates race conditions and timing issues
- **Maintainable**: Clean architecture with separation of concerns

---

*This document defines the complete requirements for the Mark Homework feature as implemented and discussed.*
