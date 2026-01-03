import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Static import for API spec (bundled by esbuild)
// @ts-ignore
import apiSpec from './api-spec.json';

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
    'https://intellimark-6649e.web.app',
    'https://www.aimarking.ai',
    'https://aimarking.ai'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


// (Body parsing moved to individual routes to prevent interference with Multer)

// Swagger UI setup
try {
  // Serve Swagger UI at /api-docs using the statically imported apiSpec
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'AI Marking API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true
    }
  }));

  console.log('📚 Swagger UI available at /api-docs');
} catch (error) {
  console.error('❌ Failed to setup Swagger UI:', error);
}

// Import routes
import authRoutes from './routes/auth.js';
import markingRouter from './routes/markingRouter.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payment.js';
import messagesRoutes from './routes/messages.js';
import analysisRouter from './routes/analysisRouter.js';
import usageRoutes from './routes/usage.js';
import configRoutes from './routes/config.js';
import creditsRoutes from './routes/credits.js';
import adminCreditsRoutes from './routes/admin/credits.js';

// Enable auth routes (Apply JSON/URLENCODED here)
app.use('/api/auth', express.json({ limit: '50mb' }), express.urlencoded({ extended: true, limit: '50mb' }), authRoutes);

// Enable marking API (Multer handles its own parsing)
app.use('/api/marking', markingRouter);

// Enable other APIs with standard parsers
const jsonParser = express.json({ limit: '50mb' });
const urlParser = express.urlencoded({ extended: true, limit: '50mb' });

app.use('/api/admin', jsonParser, urlParser, adminRoutes);
app.use('/api/messages', jsonParser, urlParser, messagesRoutes);
app.use('/api/analysis', jsonParser, urlParser, analysisRouter);
app.use('/api/usage', jsonParser, urlParser, usageRoutes);
app.use('/api/payment', jsonParser, urlParser, paymentRoutes);
app.use('/api/config', jsonParser, urlParser, configRoutes);
app.use('/api/credits', jsonParser, urlParser, creditsRoutes);
app.use('/api/admin/credits', jsonParser, urlParser, adminCreditsRoutes);




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
app.use((err: any, req: any, res: any, _next: any) => {
  const timestamp = new Date().toISOString();
  console.error(`❌ [${timestamp}] ERROR on ${req.method} ${req.path}`);
  console.error(`❌ Message: ${err.message}`);
  console.error(`❌ Stack: ${err.stack}`);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large', message: 'One or more files exceed the size limit.' });
  }

  res.status(500).json({
    error: 'Something went wrong!',
    message: err.message, // TEMPORARY DEBUG: Expose error in production
    stack: err.stack, // TEMPORARY DEBUG
    timestamp
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
// More reliable check for direct execution (works for both ESM and CJS bundle)
const isMainModule = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');

if (isMainModule) {
  startServer(DEFAULT_PORT);
}

// Export the app directly for Firebase Functions
export default app;
