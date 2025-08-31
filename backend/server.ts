import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

// @ts-ignore - Import JavaScript routes
import chatRoutes from './routes/chat.js';
// @ts-ignore - Import JavaScript routes  
import userRoutes from './routes/user.js';
// @ts-ignore - Import JavaScript routes
import adminRoutes from './routes/admin.js';
import markHomeworkRoutes from './routes/mark-homework';

dotenv.config();

const app = express();
const DEFAULT_PORT = parseInt(process.env['PORT'] || '5001');

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: process.env['FRONTEND_URL'] || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mark-homework', markHomeworkRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} in use, retrying with ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('❌ Server error:', err);
      throw err;
    }
  });
}

// Start the server
startServer(DEFAULT_PORT);

export default app;
