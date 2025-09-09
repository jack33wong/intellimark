# IntelliMark System Flow Diagram

## 🔄 **IntelliMark Application Flow Diagram**

### **1. Application Entry Points**

```
┌─────────────────────────────────────────────────────────────────┐
│                        APPLICATION START                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION CHECK                         │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │   Authenticated │    │   Anonymous     │                    │
│  │     User        │    │     User        │                    │
│  └─────────────────┘    └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ROUTE SELECTION                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    /login   │  │     /       │  │ /mark-homework│            │
│  │   (Public)  │  │  (Optional) │  │  (Optional)  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### **2. Main Application Layout**

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAIN APPLICATION LAYOUT                      │
│  ┌─────────────────┐              ┌─────────────────┐          │
│  │     SIDEBAR     │              │   MAIN CONTENT  │          │
│  │                 │              │                 │          │
│  │ • Mark Homework │              │ • Welcome Page  │          │
│  │ • Chat History  │              │ • Upload Mode   │          │
│  │ • Filter Tabs   │              │ • Chat Mode     │          │
│  │ • User Profile  │              │ • Admin Panel   │          │
│  └─────────────────┘              └─────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### **3. Homework Marking Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                    HOMEWORK MARKING FLOW                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      UPLOAD MODE                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. User selects image file                                  │ │
│  │ 2. Preview image displayed                                  │ │
│  │ 3. Select AI model (GPT-4, GPT-5, Gemini)                  │ │
│  │ 4. Click "Analyze" button                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND PROCESSING                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Image Classification (Question vs Q&A)                   │ │
│  │ 2. OCR Processing (Google Vision + Mathpix)                │ │
│  │ 3. Question Detection (Exam metadata extraction)           │ │
│  │ 4. AI Marking Instructions Generation                       │ │
│  │ 5. SVG Annotation Overlay Creation                         │ │
│  │ 6. Session Creation & Message Storage                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CHAT MODE                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Display original image with metadata                    │ │
│  │ 2. Display annotated image with feedback                   │ │
│  │ 3. Enable follow-up chat functionality                     │ │
│  │ 4. Save session to chat history                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **4. Chat System Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                        CHAT SYSTEM                              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MESSAGE PROCESSING                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. User types message in chat input                        │ │
│  │ 2. Check if first message (send image data)                │ │
│  │ 3. Check if follow-up (no image data)                      │ │
│  │ 4. Send to /api/chat/ endpoint                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND CHAT PROCESSING                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Validate user authentication (optional)                 │ │
│  │ 2. Create or retrieve session                              │ │
│  │ 3. Add user message to session                             │ │
│  │ 4. Generate AI response (if not image persistence)         │ │
│  │ 5. Add AI response to session                              │ │
│  │ 6. Persist to Firestore (immediate for critical sessions)  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND DISPLAY                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Display user message immediately                        │ │
│  │ 2. Show AI response when ready                             │ │
│  │ 3. Update chat history in sidebar                          │ │
│  │ 4. Enable continued conversation                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **5. Session Management Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION MANAGEMENT                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION CREATION                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Determine session type (Question/Marking/Chat)          │ │
│  │ 2. Generate descriptive title with metadata                │ │
│  │ 3. Create session in ChatSessionManager                    │ │
│  │ 4. Store in Firestore database                             │ │
│  │ 5. Cache in memory for fast access                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION RETRIEVAL                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Check in-memory cache first                             │ │
│  │ 2. Fallback to Firestore if not cached                     │ │
│  │ 3. Merge in-memory and Firestore data                     │ │
│  │ 4. Return complete session data                            │ │
│  │ 5. Support both authenticated and anonymous users          │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **6. Authentication Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    USER AUTHENTICATION                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Check Firebase ID token in localStorage                 │ │
│  │ 2. Validate token with backend /api/auth/profile           │ │
│  │ 3. If expired, refresh token automatically                 │ │
│  │ 4. Update user state in AuthContext                        │ │
│  │ 5. Support both authenticated and anonymous access         │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SESSION ACCESS                               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Authenticated Users: Use their UID                         │ │
│  │ Anonymous Users: Use 'anonymous' fallback                  │ │
│  │ Both can access their respective sessions                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **7. Backend API Endpoints**

```
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API STRUCTURE                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API ENDPOINTS                              │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ /api/mark-homework (POST)                                  │ │
│  │   • Image upload and processing                            │ │
│  │   • AI classification and OCR                              │ │
│  │   • Session creation                                       │ │
│  │                                                             │ │
│  │ /api/chat/ (POST)                                          │ │
│  │   • Send messages to sessions                              │ │
│  │   • Create new sessions                                    │ │
│  │   • Generate AI responses                                  │ │
│  │                                                             │ │
│  │ /api/chat/sessions/:userId (GET)                           │ │
│  │   • Retrieve user sessions                                 │ │
│  │   • Support anonymous users                                │ │
│  │                                                             │ │
│  │ /api/chat/session/:sessionId (GET)                         │ │
│  │   • Get specific session data                              │ │
│  │   • Include full message history                           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **8. Data Storage Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATA STORAGE ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      STORAGE LAYERS                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. In-Memory Cache (ChatSessionManager)                    │ │
│  │    • Fast access to active sessions                        │ │
│  │    • Immediate UI updates                                  │ │
│  │    • Batch persistence to Firestore                        │ │
│  │                                                             │ │
│  │ 2. Firestore Database                                      │ │
│  │    • Persistent session storage                            │ │
│  │    • User authentication data                              │ │
│  │    • Long-term data retention                              │ │
│  │                                                             │ │
│  │ 3. Firebase Storage                                        │ │
│  │    • Image file storage                                    │ │
│  │    • Annotated image storage                               │ │
│  │    • Base64 conversion for AI processing                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **9. User Experience Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                    USER EXPERIENCE FLOW                         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      TYPICAL USER JOURNEY                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. User visits application (authenticated or anonymous)    │ │
│  │ 2. Sees chat history in sidebar (if any)                   │ │
│  │ 3. Clicks "Mark Homework" to upload image                  │ │
│  │ 4. Selects image and AI model                              │ │
│  │ 5. Clicks "Analyze" to process                             │ │
│  │ 6. Views results in chat mode                              │ │
│  │ 7. Can ask follow-up questions                             │ │
│  │ 8. Session saved to chat history                           │ │
│  │ 9. Can revisit session later from sidebar                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### **10. Error Handling Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      ERROR SCENARIOS                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. Authentication Errors                                   │ │
│  │    • Token refresh automatically                           │ │
│  │    • Fallback to anonymous mode                            │ │
│  │                                                             │ │
│  │ 2. API Errors                                              │ │
│  │    • Display user-friendly error messages                  │ │
│  │    • Retry mechanisms for transient failures               │ │
│  │                                                             │ │
│  │ 3. Image Processing Errors                                 │ │
│  │    • Clear error messages                                  │ │
│  │    • Allow retry with different image                      │ │
│  │                                                             │ │
│  │ 4. Session Errors                                          │ │
│  │    • Graceful degradation                                  │ │
│  │    • Data recovery mechanisms                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 🎯 **Key Features Summary:**

### **✅ Working Features:**
- **Anonymous User Support**: Users can use the app without login
- **Chat History**: Persistent session storage and retrieval
- **Image Processing**: AI-powered homework marking with OCR
- **Follow-up Chat**: Continuous conversation with context
- **Session Management**: Smart caching with Firestore persistence
- **Authentication**: Firebase integration with token refresh
- **Multiple AI Models**: GPT-4, GPT-5, and Gemini support

### **🔄 Data Flow:**
1. **Upload** → **Process** → **Display** → **Chat** → **Persist**
2. **Anonymous/Authenticated** → **Session Creation** → **Message Handling** → **AI Response**
3. **In-Memory Cache** → **Batch Persistence** → **Firestore Storage**

## 📋 **Technical Architecture:**

### **Frontend Components:**
- **React Router**: Navigation and routing
- **AuthContext**: Authentication state management
- **MarkHomeworkPage**: Main upload and chat interface
- **Sidebar**: Navigation and chat history
- **ProtectedRoute**: Authentication guards

### **Backend Services:**
- **ChatSessionManager**: Session lifecycle management
- **FirestoreService**: Database operations
- **AIMarkingService**: AI integration
- **ImageStorageService**: File handling
- **SVGOverlayService**: Annotation generation

### **External Integrations:**
- **Firebase**: Authentication and database
- **OpenAI**: GPT models
- **Google Vision**: OCR processing
- **Mathpix**: Mathematical OCR
- **Stripe**: Payment processing

This flow diagram represents the current working state of the IntelliMark application after the recent fixes.
