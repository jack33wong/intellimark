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

### **3. Consolidated Homework Marking Flow**

```
┌─────────────────────────────────────────────────────────────────┐
│                CONSOLIDATED HOMEWORK MARKING FLOW              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 1: UPLOAD & USER MESSAGE               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. User selects image file                                  │ │
│  │ 2. Image preview displayed immediately (base64)             │ │
│  │ 3. User clicks send button                                  │ │
│  │ 4. State set to PROCESSING (send button disabled)          │ │
│  │ 5. Switch to chat mode (input bar moves to bottom)         │ │
│  │ 6. User message displayed with image                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 2: AI PROCESSING                       │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. AI thinking animation displayed                          │ │
│  │ 2. Backend API Phase 1: /mark-homework/upload              │ │
│  │    • Image Classification (Question vs Q&A)                │ │
│  │    • OCR Processing (Google Vision + Mathpix)              │ │
│  │    • Question Detection (Exam metadata extraction)         │ │
│  │ 3. Backend API Phase 2: /mark-homework/process             │ │
│  │    • AI Marking Instructions Generation                    │ │
│  │    • SVG Annotation Overlay Creation                       │ │
│  │    • Session Creation & Message Storage                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PHASE 3: COMPLETE                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ 1. AI response displayed with annotated image              │ │
│  │ 2. State reset to IDLE (send button re-enabled)           │ │
│  │ 3. Session saved to chat history                           │ │
│  │ 4. Ready for follow-up questions or new upload             │ │
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
│  │ 3. Create session in FirestoreService                      │ │
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
│  │ /api/mark-homework/upload (POST)                           │ │
│  │   • Phase 1: Image upload and initial processing           │ │
│  │   • AI classification and OCR                              │ │
│  │   • Returns user message with imageData                    │ │
│  │                                                             │ │
│  │ /api/mark-homework/process (POST)                          │ │
│  │   • Phase 2: AI processing and response generation         │ │
│  │   • Marking instructions and annotations                   │ │
│  │   • Returns AI message with annotated image                │ │
│  │                                                             │ │
│  │ /api/messages/session/:sessionId (GET)                     │ │
│  │   • Get specific session data                              │ │
│  │   • Include full message history                           │ │
│  │                                                             │ │
│  │ /api/chat/ (POST)                                          │ │
│  │   • Send messages to sessions                              │ │
│  │   • Create new sessions                                    │ │
│  │   • Generate AI responses                                  │ │
│  │                                                             │ │
│  │ /api/chat/sessions/:userId (GET)                           │ │
│  │   • Retrieve user sessions                                 │ │
│  │   • Support anonymous users                                │ │
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
│  │ 1. Simple Session Service (simpleSessionService)           │ │
│  │    • Direct Firestore integration                          │ │
│  │    • Immediate UI updates                                  │ │
│  │    • Real-time persistence                                 │ │
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
- **MarkHomeworkPageConsolidated**: Main upload and chat interface
- **useMarkHomework**: Consolidated state management hook
- **FollowUpChatInput**: Dynamic chat input component
- **MainLayout**: Layout orchestrator
- **Sidebar**: Navigation and chat history
- **ProtectedRoute**: Authentication guards

### **Backend Services:**
- **MarkHomeworkWithAnswer**: Core homework processing service
- **ClassificationService**: Image classification
- **QuestionDetectionService**: Exam metadata extraction
- **HybridOCRService**: OCR processing
- **ImageAnnotationService**: SVG overlay generation
- **LLMOrchestrator**: AI model coordination
- **FirestoreService**: Database operations

### **External Integrations:**
- **Firebase**: Authentication and database
- **OpenAI**: GPT models
- **Google Vision**: OCR processing
- **Mathpix**: Mathematical OCR
- **Stripe**: Payment processing

This flow diagram represents the current consolidated state of the IntelliMark application after significant refactoring to eliminate over-engineering and state management complexity. The system now follows a clean, single-source-of-truth architecture with unified handlers and simplified state flow.

## 🎯 **Key Architectural Improvements:**

### **✅ Consolidated Design:**
- **Single Source of Truth**: All state managed by `useMarkHomework` hook
- **Unified Image Handler**: Single `handleImageAnalysis` function for all uploads
- **Simplified State Flow**: 4-state system (`idle`, `processing`, `complete`, `error`)
- **Fail-Fast Error Handling**: No silent failures, immediate error reporting
- **Consistent User Experience**: Identical behavior for authenticated and unauthenticated users

### **🔄 Data Flow:**
1. **Upload** → **Process** → **Display** → **Chat** → **Persist**
2. **Anonymous/Authenticated** → **Session Creation** → **Message Handling** → **AI Response**
3. **In-Memory Cache** → **Batch Persistence** → **Firestore Storage**

### **📋 Technical Architecture:**
- **Frontend**: React 18 with consolidated hooks and components
- **Backend**: Node.js/TypeScript with microservice architecture
- **State Management**: Single `useMarkHomework` hook
- **API Design**: RESTful endpoints with clear separation of concerns
- **Error Handling**: Fail-fast principles with user-friendly messages
