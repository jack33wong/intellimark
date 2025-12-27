# AI Marking Current System Architecture

## Overview

AI Marking is a comprehensive AI-powered homework marking system built with React frontend and Node.js/TypeScript backend. The system provides real-time image processing, AI analysis, and interactive chat functionality for both authenticated and anonymous users.

## System Architecture

### Frontend (React)
- **Port**: 3000
- **Framework**: React 18 with functional components and hooks
- **State Management**: Custom hooks with service-based state management
- **Routing**: React Router v6
- **Authentication**: Firebase Auth with multiple providers
- **UI Components**: Custom components with Lucide React icons

### Backend (Node.js/TypeScript)
- **Port**: 5001
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: Firebase Firestore
- **Storage**: Firebase Storage
- **AI Services**: Google Gemini, MathPix, Google Vision API
- **Authentication**: Firebase Admin SDK

## API Endpoints

### Authentication (`/api/auth`)
- `GET /test-updated-code` - Health check
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /user` - Get current user
- `POST /refresh-token` - Refresh authentication token

### Mark Homework (`/api/mark-homework`)
- `POST /upload` - Upload image and create user message
- `POST /process-single` - Single-phase image processing (main endpoint)
- `POST /process` - Follow-up text message processing
- `GET /stats` - System statistics
- `GET /health` - Health check

### Unified Processing (`/api/process`)
- `POST /` - Unified image processing
- `POST /ai` - AI response processing

### Messages (`/api/messages`)
- `POST /chat` - Unified chat endpoint
- `GET /sessions` - Get user sessions
- `GET /sessions/:id` - Get specific session
- `DELETE /sessions/:id` - Delete session

### Admin (`/api/admin`)
- `GET /json/collections/:collectionName` - Get JSON collections
- `POST /json/collections/markingSchemes` - Upload marking schemes
- `GET /users` - Get all users
- `GET /stats` - Admin statistics

### Payment (`/api/payment`)
- `POST /create-checkout-session` - Create Stripe checkout
- `POST /create-portal-session` - Create customer portal
- `POST /webhook` - Stripe webhook handler

### Debug (`/api/debug`)
- `POST /toggle` - Toggle debug mode
- `GET /status` - Get debug status

## Frontend Components

### Core Components

#### 1. MarkHomeworkPageConsolidated.js
**Main component** for the mark homework functionality
- **Purpose**: Orchestrates the entire mark homework flow
- **Key Features**:
  - Unified image handling for initial and follow-up uploads
  - Consolidated state management through `useMarkHomework` hook
  - Immediate image display with background processing
  - Smooth UI transitions from upload to chat mode

#### 2. MainLayout.js
**Layout component** for the mark homework page
- **Purpose**: Orchestrates all focused components
- **Key Features**:
  - Session management
  - Chat interface
  - Follow-up input handling

#### 3. Sidebar.js
**Navigation component** with session management
- **Purpose**: Navigation and session history
- **Key Features**:
  - Chat session history
  - Filter tabs (all, favorites, recent)
  - Session management (delete, favorite, rate)

#### 4. UnifiedChatInput.js
**Unified input component** for both initial and follow-up
- **Purpose**: Single component for all chat inputs
- **Key Features**:
  - File upload for images
  - Text input for messages
  - Model selection
  - Send button with validation

### Hooks

#### 1. useMarkHomework.js
**Main state management hook**
- **Purpose**: Single source of truth for mark homework state
- **State**:
  - `pageMode`: 'upload' | 'chat'
  - `isProcessing`: boolean
  - `isAIThinking`: boolean
  - `error`: string | null
  - Session data from `simpleSessionService`

#### 2. useImageUpload.js
**Image handling hook**
- **Purpose**: File selection and processing
- **Features**:
  - File validation
  - Base64 conversion
  - Preview generation

#### 3. useAutoScroll.js
**Chat scrolling hook**
- **Purpose**: Auto-scroll chat to bottom
- **Features**:
  - Scroll to bottom on new messages
  - Scroll button visibility
  - Image load handling

### Services

#### 1. simpleSessionService.js
**Session management service**
- **Purpose**: Single source of truth for session data
- **Features**:
  - Session creation and management
  - Message handling
  - Sidebar session updates
  - API communication

#### 2. markingHistoryService.js
**History management service**
- **Purpose**: Session history and persistence
- **Features**:
  - Session retrieval
  - Session deletion
  - Session updates

## Data Flow

### 1. Initial Image Upload
```
User selects image → useImageUpload → handleImageAnalysis → 
processImageAPI → /api/mark-homework/process-single → 
AI processing → Response → UI update
```

### 2. Follow-up Text Message
```
User types message → UnifiedChatInput → handleTextMessage → 
processImageAPI → /api/mark-homework/process → 
AI processing → Response → UI update
```

### 3. Follow-up Image Upload
```
User uploads image → UnifiedChatInput → handleFollowUpImage → 
processImageAPI → /api/mark-homework/process-single → 
AI processing → Response → UI update
```

## State Management

### Frontend State
- **Component State**: Local useState for UI-specific state
- **Service State**: `simpleSessionService` for session data
- **Context State**: `AuthContext` for authentication
- **Hook State**: Custom hooks for specific functionality

### Backend State
- **Session State**: Firestore database
- **User State**: Firebase Auth
- **File State**: Firebase Storage
- **Debug State**: Runtime configuration

## Authentication Flow

### 1. Login
```
User clicks login → Firebase Auth → JWT token → 
Backend validation → Session creation
```

### 2. Protected Routes
```
Route access → AuthContext check → 
Redirect to login if not authenticated
```

### 3. API Calls
```
Frontend request → JWT token in header → 
Backend middleware validation → 
Process request or return 401
```

## Error Handling

### Frontend
- **Component Level**: Try-catch in event handlers
- **Hook Level**: Error state in custom hooks
- **Service Level**: Error handling in API calls
- **Global Level**: Error boundaries (planned)

### Backend
- **Route Level**: Try-catch in route handlers
- **Service Level**: Error handling in service methods
- **Database Level**: Firestore error handling
- **API Level**: External API error handling

## Development Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Firebase project
- Google Cloud credentials

### Frontend Setup
```bash
cd frontend
npm install
npm start
```

### Backend Setup
```bash
cd backend
npm install
npm run dev
```

### Environment Variables
- `REACT_APP_FIREBASE_*` - Firebase configuration
- `GOOGLE_APPLICATION_CREDENTIALS` - Google Cloud credentials
- `STRIPE_SECRET_KEY` - Stripe payment configuration

## Deployment

### Frontend
- **Platform**: Firebase Hosting
- **Build**: `npm run build`
- **Deploy**: `firebase deploy`

### Backend
- **Platform**: Google Cloud Functions
- **Build**: `npm run build:production`
- **Deploy**: `firebase deploy --only functions`

## Monitoring and Debugging

### Debug Mode
- **Frontend**: Toggle in Header component
- **Backend**: `/api/debug/toggle` endpoint
- **Features**: Mock responses, simulated delays

### Logging
- **Frontend**: Console logging with emojis
- **Backend**: Structured logging with timestamps
- **Database**: Firestore audit logs

### Health Checks
- **Frontend**: Component mount checks
- **Backend**: `/api/mark-homework/health`
- **Database**: Firestore connection checks

## Security

### Authentication
- **JWT Tokens**: Secure token-based authentication
- **Firebase Auth**: Multiple provider support
- **Session Management**: Secure session handling

### Data Protection
- **Input Validation**: All inputs validated
- **SQL Injection**: Not applicable (NoSQL)
- **XSS Protection**: React's built-in protection
- **CSRF Protection**: Same-origin policy

### API Security
- **Rate Limiting**: Express rate limiting
- **CORS**: Configured for specific origins
- **Helmet**: Security headers
- **Input Sanitization**: All inputs sanitized

## Performance

### Frontend
- **Code Splitting**: React.lazy for route-based splitting
- **Memoization**: React.memo and useMemo
- **Image Optimization**: Base64 for small images, URLs for large
- **Bundle Size**: Optimized with webpack

### Backend
- **Caching**: Firestore caching
- **Connection Pooling**: Firebase connection management
- **Async Processing**: Non-blocking operations
- **Memory Management**: Proper cleanup and garbage collection

## Future Improvements

### Planned Features
- **Real-time Updates**: WebSocket integration
- **Offline Support**: Service worker implementation
- **Mobile App**: React Native version
- **Advanced Analytics**: User behavior tracking

### Technical Debt
- **TypeScript Migration**: Complete frontend TypeScript migration
- **Testing**: Comprehensive test coverage
- **Documentation**: API documentation with OpenAPI
- **Monitoring**: Advanced monitoring and alerting

---

*Last Updated: September 21, 2025*
*Version: 1.0.0*
