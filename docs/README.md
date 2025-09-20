# Intellimark Chat

A modern, Gemini-like chat application built with React frontend and Node.js backend. Features a beautiful UI with left sidebar navigation, user progress tracking, and AI-powered conversations.

## Features

- 🚀 **Modern UI**: Clean, responsive design inspired by Gemini Chat
- 📝 **AI Homework Marking**: Upload images for AI-powered analysis and feedback
- 💬 **Real-time Chat**: Interactive chat interface with AI responses
- 📊 **User Progress**: Track your learning progress and statistics
- 📚 **Chat History**: Persistent chat sessions with easy navigation
- 🔧 **Admin Panel**: Administrative dashboard for system management
- 📱 **Responsive Design**: Works seamlessly on desktop and mobile devices
- 🔄 **Unified Experience**: Seamless transition from upload to chat mode

## Tech Stack

### Frontend
- **React 18** - Modern React with hooks
- **Lucide React** - Beautiful, customizable icons
- **Date-fns** - Date utility library
- **CSS3** - Custom styling with modern design principles
- **Firebase** - Authentication and real-time database
- **Puppeteer** - Automated testing

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **TypeScript** - Type-safe development
- **Firebase Admin** - Backend Firebase integration
- **OpenAI API** - AI model integration
- **Google Vision API** - OCR processing
- **Mathpix API** - Mathematical OCR
- **Helmet** - Security middleware
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** - API protection

## Project Structure

```
intellimark-chat/
├── backend/                 # Node.js backend
│   ├── routes/             # API route handlers
│   │   ├── mark-homework.ts # Homework marking endpoints
│   │   ├── chat.js         # Chat-related endpoints
│   │   └── user.js         # User and admin endpoints
│   ├── services/           # Business logic services
│   │   ├── MarkHomeworkWithAnswer.ts
│   │   ├── ClassificationService.ts
│   │   ├── QuestionDetectionService.ts
│   │   └── ImageAnnotationService.ts
│   ├── server.js           # Main server file
│   ├── package.json        # Backend dependencies
│   └── config.env.example  # Environment variables template
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── markHomework/ # Homework marking components
│   │   │   │   ├── MarkHomeworkPageConsolidated.js
│   │   │   │   └── MainLayout.js
│   │   │   ├── chat/       # Chat components
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
