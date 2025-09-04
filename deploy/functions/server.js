import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const app = express();
const DEFAULT_PORT = parseInt(process.env['PORT'] || '5001');
app.use(helmet());
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
app.use(limiter);
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
import authRoutes from './routes/auth';
import markHomeworkRoutes from './routes/mark-homework';
import adminRoutes from './routes/admin';
import chatRoutes from './routes/chat';
import paymentRoutes from './routes/payment';
app.use('/api/auth', authRoutes);
app.use('/api/mark-homework', markHomeworkRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payment', paymentRoutes);
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something went wrong!',
        message: process.env['NODE_ENV'] === 'development' ? err.message : 'Internal server error'
    });
});
app.use('*', (_req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
function startServer(port) {
    const server = app.listen(port, () => {
        console.log(`✅ Server running at http://localhost:${port}`);
        console.log(`Environment: ${process.env['NODE_ENV'] || 'development'}`);
        console.log(`📊 Health check: http://localhost:${port}/health`);
    });
    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`⚠️ Port ${port} in use, retrying with ${port + 1}...`);
            startServer(port + 1);
        }
        else {
            console.error('❌ Server error:', err);
            throw err;
        }
    });
}
startServer(DEFAULT_PORT);
export default app;
