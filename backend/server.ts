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

// Initialize SVG service config
import { SVGOverlayService } from './services/marking/svgOverlayService.js';
SVGOverlayService.setProductionMode(process.env['NODE_ENV'] === 'production');

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

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Enable auth routes
app.use('/api/auth', authRoutes);

// Enable marking API
app.use('/api/marking', markingRouter);

// Enable admin routes
app.use('/api/admin', adminRoutes);

// Enable messages API (new UnifiedMessage system)
app.use('/api/messages', messagesRoutes);

// Enable analysis API
app.use('/api/analysis', analysisRouter);

// Enable usage API (user-specific usage statistics)
app.use('/api/usage', usageRoutes);

// Enable payment system
app.use('/api/payment', paymentRoutes);

// Enable config API (credit system configuration)
app.use('/api/config', configRoutes);

// Enable credits API (user credit management)
app.use('/api/credits', creditsRoutes);

// Enable admin credits API
app.use('/api/admin/credits', adminCreditsRoutes);




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
// More reliable check for direct execution (works for both ESM and CJS bundle)
const isMainModule = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');

if (isMainModule) {
  startServer(DEFAULT_PORT);
}

// Export the app directly for Firebase Functions
export default app;
