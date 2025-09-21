# IntelliMark - AI-Powered Homework Marking System

A comprehensive AI-powered homework marking system built with React frontend and Node.js/TypeScript backend. Features real-time image processing, AI analysis, interactive chat, and session management for both authenticated and anonymous users.

## Features

- 🤖 **AI Homework Marking**: Upload images for AI-powered analysis and detailed feedback
- 💬 **Interactive Chat**: Real-time chat interface with follow-up questions and image uploads
- 📚 **Session Management**: Persistent chat sessions with history, favorites, and ratings
- 🔐 **Flexible Authentication**: Works for both authenticated and anonymous users
- 📊 **Progress Tracking**: Track learning progress and session statistics
- 🔧 **Admin Panel**: Comprehensive administrative dashboard
- 📱 **Responsive Design**: Optimized for desktop and mobile devices
- 🎯 **Unified Experience**: Seamless transition from upload to chat mode
- 🐛 **Debug Mode**: Built-in debugging with mock responses and simulated delays

## Tech Stack

### Frontend
- **React 18** - Modern React with hooks
- **Lucide React** - Beautiful, customizable icons
- **Date-fns** - Date utility library
- **CSS3** - Custom styling with modern design principles
- **Firebase** - Authentication and real-time database
- **Puppeteer** - Automated testing

### Backend
- **Node.js** - JavaScript runtime with ES modules
- **Express.js** - Web framework
- **TypeScript** - Type-safe development
- **Firebase Admin** - Backend Firebase integration
- **Google Gemini API** - AI model integration
- **Google Vision API** - OCR processing
- **MathPix API** - Mathematical OCR
- **Firestore** - NoSQL database
- **Firebase Storage** - File storage
- **Stripe** - Payment processing
- **Helmet** - Security middleware
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** - API protection

## Project Structure

```
intellimark/
├── backend/                 # Node.js/TypeScript backend
│   ├── routes/             # API route handlers
│   │   ├── mark-homework.ts # Homework marking endpoints
│   │   ├── messages.ts     # Chat and session endpoints
│   │   ├── auth.ts         # Authentication endpoints
│   │   ├── admin.ts        # Admin panel endpoints
│   │   ├── payment.ts      # Stripe payment endpoints
│   │   ├── debug.ts        # Debug mode endpoints
│   │   └── unified-processing.ts # Unified processing endpoints
│   ├── services/           # Business logic services
│   │   ├── marking/        # Marking services
│   │   │   └── MarkHomeworkWithAnswer.ts
│   │   ├── ai/             # AI services
│   │   │   ├── ClassificationService.ts
│   │   │   ├── QuestionDetectionService.ts
│   │   │   ├── HybridOCRService.ts
│   │   │   └── GoogleVisionService.ts
│   │   ├── firestoreService.ts # Database service
│   │   ├── imageStorageService.ts # File storage service
│   │   └── paymentService.ts # Payment service
│   ├── config/             # Configuration files
│   │   ├── firebase.ts     # Firebase configuration
│   │   ├── aiModels.ts     # AI model configuration
│   │   └── stripe.ts       # Stripe configuration
│   ├── middleware/         # Express middleware
│   │   └── auth.ts         # Authentication middleware
│   ├── types/              # TypeScript type definitions
│   │   └── index.ts        # Main type definitions
│   └── server.ts           # Main server file
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── markHomework/ # Mark homework components
│   │   │   ├── chat/       # Chat components
│   │   │   ├── layout/     # Layout components
│   │   │   ├── auth/       # Authentication components
│   │   │   ├── admin/      # Admin components
│   │   │   └── focused/    # Focused UI components
│   │   ├── hooks/          # Custom React hooks
│   │   │   ├── useMarkHomework.js
│   │   │   ├── useImageUpload.js
│   │   │   └── useAutoScroll.js
│   │   ├── services/       # Frontend services
│   │   │   ├── simpleSessionService.js
│   │   │   └── markingHistoryService.js
│   │   ├── contexts/       # React contexts
│   │   │   └── AuthContext.js
│   │   ├── utils/          # Utility functions
│   │   ├── config/         # Configuration
│   │   └── types/          # TypeScript types
│   └── public/             # Static assets
├── docs/                   # Documentation
│   ├── CURRENT_SYSTEM_ARCHITECTURE.md
│   ├── MARK_HOMEWORK_SPECIFICATION.md
│   └── README.md
└── deploy/                 # Deployment files
    ├── firebase.json
    └── functions/
```

## API Endpoints

### Authentication (`/api/auth`)
- `GET /test-updated-code` - Health check
- `POST /login` - User login
- `POST /logout` - User logout
- `GET /user` - Get current user

### Mark Homework (`/api/mark-homework`)
- `POST /upload` - Upload image and create user message
- `POST /process-single` - Single-phase image processing (main endpoint)
- `POST /process` - Follow-up text message processing
- `GET /stats` - System statistics
- `GET /health` - Health check

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

## Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- Firebase project
- Google Cloud credentials

### Development Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd intellimark
   ```

2. **Backend Setup**
   ```bash
   cd backend
   npm install
   cp config.env.example .env.local
   # Configure your environment variables
   npm run dev
   ```

3. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm start
   ```

4. **Access the application**
   - Frontend: http://localhost:3000
   - Backend: http://localhost:5001
   - Health Check: http://localhost:5001/api/mark-homework/health

### Environment Variables

#### Backend (.env.local)
```env
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json

# Stripe
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-webhook-secret

# AI Services
GEMINI_API_KEY=your-gemini-api-key
MATHPIX_APP_ID=your-mathpix-app-id
MATHPIX_APP_KEY=your-mathpix-app-key
```

#### Frontend (.env)
```env
REACT_APP_FIREBASE_API_KEY=your-api-key
REACT_APP_FIREBASE_AUTH_DOMAIN=your-domain
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-bucket
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
REACT_APP_FIREBASE_APP_ID=your-app-id
```

## Documentation

- **[API Quick Reference](API_QUICK_REFERENCE.md)** - Quick reference for common API endpoints
- **[API Endpoints](API_ENDPOINTS.md)** - Complete API documentation with examples
- **[Current System Architecture](CURRENT_SYSTEM_ARCHITECTURE.md)** - Detailed system architecture and components
- **[Mark Homework Specification](MARK_HOMEWORK_SPECIFICATION.md)** - Mark homework feature specification
- **[Frontend Components](FRONTEND_COMPONENTS_README.md)** - Frontend component documentation
- **[Core Services](CORE_SERVICES_README.md)** - Backend service documentation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
│   │   │   │   └── FollowUpChatInput.js
│   │   │   ├── Sidebar.js  # Left navigation sidebar
│   │   │   └── ChatInterface.js # Main chat area
│   │   ├── hooks/          # Custom React hooks
│   │   │   ├── useMarkHomework.js
│   │   │   └── useImageUpload.js
│   │   ├── services/       # Frontend services
│   │   │   └── simpleSessionService.js
│   │   ├── App.js          # Main application component
│   │   ├── index.js        # React entry point
│   │   └── index.css       # Global styles
│   ├── public/             # Static assets
│   └── package.json        # Frontend dependencies
├── docs/                   # Documentation
│   ├── MARK_HOMEWORK_SPECIFICATION.md
│   ├── SYSTEM_FLOW.md
│   └── README.md
├── package.json            # Root package.json with scripts
└── README.md              # This file
```

## Quick Start

### Prerequisites
- Node.js 16+ 
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd intellimark-chat
   ```

2. **Install all dependencies**
   ```bash
   npm run install-all
   ```

3. **Set up environment variables**
   ```bash
   cd backend
   cp config.env.example .env.local
# Edit .env.local with your configuration
   ```

4. **Start the development servers**
   ```bash
   npm run dev
   ```

This will start both the backend (port 5000) and frontend (port 3000) servers concurrently.

### Manual Start

If you prefer to run servers separately:

**Backend:**
```bash
cd backend
npm run dev
```

**Frontend:**
```bash
cd frontend
npm start
```

## Testing

The project includes a comprehensive test suite using Puppeteer for automated testing.

### Test Account
- **Email**: `admin@intellimark.com`
- **Password**: `123456`

### Running Tests

1. **Setup test environment**
   ```bash
   cd frontend/test
   node setup.js
   ```

2. **Run all tests**
   ```bash
   cd frontend/test
   node run-tests.js
   ```

3. **Run specific test categories**
   ```bash
   # Authentication tests
   node run-tests.js auth
   
   # Core functionality tests
   node run-tests.js core
   
   # Database persistence tests
   node run-tests.js database
   ```

### Test Categories
- **Authentication**: Email/password login, user profile loading
- **Core Functionality**: Image upload, AI processing, UI transitions
- **Database Persistence**: Session saving, data retrieval
- **Session Management**: Session caching, ID consistency
- **State Management**: Frontend state flows and transitions

See `frontend/test/README.md` for detailed test documentation.

## API Endpoints

### Mark Homework Endpoints
- `POST /api/mark-homework/upload` - Upload image for analysis (Phase 1)
- `POST /api/mark-homework/process` - Process image with AI (Phase 2)
- `GET /api/messages/session/:sessionId` - Get session messages

### Chat Endpoints
- `POST /api/chat/new` - Create a new chat session
- `POST /api/chat/:chatId/message` - Send a message
- `GET /api/chat/:chatId/messages` - Get chat messages
- `GET /api/chat` - Get all chats
- `DELETE /api/chat/:chatId` - Delete a chat

### User Endpoints
- `GET /api/user/progress` - Get user progress statistics
- `GET /api/user/admin` - Get admin dashboard data

## Development

### Available Scripts

- `npm run dev` - Start both frontend and backend in development mode
- `npm run server` - Start only the backend server
- `npm run client` - Start only the frontend development server
- `npm run build` - Build the frontend for production
- `npm run test` - Run tests for both frontend and backend

### Code Style

- Follow ESLint and Prettier configurations
- Use TypeScript-style JSDoc comments
- Follow React best practices and hooks patterns
- Maintain clean architecture with separation of concerns

## Features in Detail

### Mark Homework Feature
- **Image Upload**: Drag-and-drop or click to upload homework images
- **AI Analysis**: Automatic question detection and OCR processing
- **Real-time Feedback**: Immediate image display with AI thinking animation
- **Annotated Results**: Visual feedback with SVG overlays
- **Follow-up Chat**: Continue conversation about the homework
- **Session Management**: Persistent chat history and progress tracking

### Sidebar Navigation
- **New Chat Button**: Creates a fresh conversation
- **User Progress**: Shows learning statistics and achievements
- **Chat History**: Lists all previous conversations with timestamps
- **Admin Section**: Access to administrative functions

### Chat Interface
- **Real-time Messaging**: Send and receive messages instantly
- **Auto-scroll**: Automatically scrolls to new messages
- **Message Timestamps**: Shows when messages were sent
- **Responsive Input**: Auto-resizing textarea with Enter key support
- **Dynamic Positioning**: Smooth transitions between upload and chat modes

### User Progress Tracking
- Total chats and messages
- Learning streak counter
- Weekly activity statistics
- Topics covered in conversations
- Homework analysis history

## Future Enhancements

- [x] Real AI integration (OpenAI, Gemini, etc.)
- [x] User authentication and profiles
- [x] File upload and sharing
- [ ] Batch image processing
- [ ] Voice messages
- [ ] Multi-language support
- [ ] Advanced analytics dashboard
- [ ] Custom annotation tools
- [ ] Offline processing capabilities

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions, please open an issue in the GitHub repository or contact the development team.
