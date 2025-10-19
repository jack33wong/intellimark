import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });


const app = express();
const DEFAULT_PORT = parseInt(process.env['PORT'] || '5001');

// Trust proxy for rate limiting (needed for X-Forwarded-For header)
app.set('trust proxy', 1);

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
  origin: [
    'http://localhost:3000', 
    'http://127.0.0.1:3000',
    'https://intellimark-6649e.web.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Swagger UI setup
try {
  const apiSpecPath = path.join(__dirname, 'api-spec.json');
  if (fs.existsSync(apiSpecPath)) {
    const apiSpec = JSON.parse(fs.readFileSync(apiSpecPath, 'utf8'));
    
    // Serve Swagger UI at /api-docs
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'IntelliMark API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: 'list',
        filter: true,
        showExtensions: true,
        showCommonExtensions: true
      }
    }));
    
    console.log('📚 Swagger UI available at: http://localhost:5001/api-docs');
  } else {
    console.warn('⚠️  API spec not found at:', apiSpecPath);
    console.warn('   Run: npm run generate-api-spec');
  }
} catch (error) {
  console.error('❌ Failed to setup Swagger UI:', error);
}

// Import routes
import authRoutes from './routes/auth.js';
import markingApiRoutes from './routes/markingApi.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payment.js';
import messagesRoutes from './routes/messages.js';

// Enable auth routes
app.use('/api/auth', authRoutes);

// Enable marking API
app.use('/api/marking', markingApiRoutes);

// Enable admin routes
app.use('/api/admin', adminRoutes);


// Enable messages API (new UnifiedMessage system)
app.use('/api/messages', messagesRoutes);


// Enable payment system
app.use('/api/payment', paymentRoutes);




// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API documentation redirect
app.get('/docs', (_req, res) => {
  res.redirect('/api-docs');
});

app.get('/swagger', (_req, res) => {
  res.redirect('/api-docs');
});

// API info endpoint
app.get('/api', (_req, res) => {
  res.json({
    name: 'IntelliMark API',
    version: '1.0.0',
    description: 'AI-powered homework marking and question detection API',
    documentation: {
      swagger: '/api-docs',
      health: '/health'
    },
    endpoints: {
      auth: '/api/auth',
      marking: '/api/marking',
      messages: '/api/messages',
      admin: '/api/admin',
      payment: '/api/payment'
    }
  });
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
// More reliable check for direct execution
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.endsWith('server.ts')) {
  startServer(DEFAULT_PORT);
}

// Export the app directly for Firebase Functions
export default app;

// For CommonJS compatibility in Firebase Functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = app;
  module.exports.default = app;
}
