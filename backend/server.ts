import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });


const app = express();
const DEFAULT_PORT = parseInt(process.env['PORT'] || '5001');

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000 // limit each IP to 1000 requests per windowMs (increased for development)
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Import routes
import authRoutes from './routes/auth';
import markHomeworkRoutes from './routes/mark-homework';
import adminRoutes from './routes/admin';
import chatRoutes from './routes/chat';
import paymentRoutes from './routes/payment';

// Enable auth routes
app.use('/api/auth', authRoutes);

// Enable mark question system
app.use('/api/mark-homework', markHomeworkRoutes);

// Enable admin routes
app.use('/api/admin', adminRoutes);

// Enable chat system
app.use('/api/chat', chatRoutes);

// Enable payment system
app.use('/api/payment', paymentRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});



// Error handling middleware
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env['NODE_ENV'] === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/**
 * Start server with dynamic port fallback
 * If the default port is busy, automatically try the next available port
 */
function startServer(port: number) {
  const server = app.listen(port, () => {
    console.log(`✅ Server running at http://localhost:${port}`);
    console.log(`Environment: ${process.env['NODE_ENV'] || 'development'}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. Please kill the process using port ${port} and try again.`);
      console.error('❌ Only port 5001 is allowed for backend development.');
      process.exit(1);
    } else {
      console.error('❌ Server error:', err);
      throw err;
    }
  });
}

// Start the server only if not being imported as a module
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(DEFAULT_PORT);
}

// Export the app directly for Firebase Functions
export default app;

// For CommonJS compatibility in Firebase Functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = app;
  module.exports.default = app;
}
