# Intellimark Chat

A modern, Gemini-like chat application built with React frontend and Node.js backend. Features a beautiful UI with left sidebar navigation, user progress tracking, and AI-powered conversations.

## Features

- 🚀 **Modern UI**: Clean, responsive design inspired by Gemini Chat
- 💬 **Real-time Chat**: Interactive chat interface with AI responses
- 📊 **User Progress**: Track your learning progress and statistics
- 📚 **Chat History**: Persistent chat sessions with easy navigation
- 🔧 **Admin Panel**: Administrative dashboard for system management
- 📱 **Responsive Design**: Works seamlessly on desktop and mobile devices

## Tech Stack

### Frontend
- **React 18** - Modern React with hooks
- **Lucide React** - Beautiful, customizable icons
- **Date-fns** - Date utility library
- **CSS3** - Custom styling with modern design principles

### Backend
- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **Helmet** - Security middleware
- **CORS** - Cross-origin resource sharing
- **Rate Limiting** - API protection

## Project Structure

```
intellimark-chat/
├── backend/                 # Node.js backend
│   ├── routes/             # API route handlers
│   │   ├── chat.js         # Chat-related endpoints
│   │   └── user.js         # User and admin endpoints
│   ├── server.js           # Main server file
│   ├── package.json        # Backend dependencies
│   └── env.example         # Environment variables template
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── Sidebar.js  # Left navigation sidebar
│   │   │   └── ChatInterface.js # Main chat area
│   │   ├── App.js          # Main application component
│   │   ├── index.js        # React entry point
│   │   └── index.css       # Global styles
│   ├── public/             # Static assets
│   └── package.json        # Frontend dependencies
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
   cp env.example .env
   # Edit .env with your configuration
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

## API Endpoints

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

### User Progress Tracking
- Total chats and messages
- Learning streak counter
- Weekly activity statistics
- Topics covered in conversations

## Future Enhancements

- [ ] Database integration (PostgreSQL/MongoDB)
- [ ] Real AI integration (OpenAI, Gemini, etc.)
- [ ] User authentication and profiles
- [ ] File upload and sharing
- [ ] Voice messages
- [ ] Multi-language support
- [ ] Advanced analytics dashboard

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
