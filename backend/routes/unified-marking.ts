/**
 * Unified Marking Routes
 * 
 * PURPOSE: Single endpoint for all marking, question, and chat processing
 * REPLACES: All duplicate endpoints in mark-homework.ts and messages.ts
 * 
 * DESIGN PRINCIPLES:
 * - Fail fast: Clear errors, no fallbacks
 * - Simple: One endpoint, clear parameters
 * - DRY: No code duplication
 * - Consistent: Same behavior across all flows
 */

import express from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { markingMiddleware } from '../middleware/markingMiddleware.js';
import { UnifiedMarkingService } from '../services/unifiedMarkingService.js';
import type { Request, Response } from 'express';

const router = express.Router();

/**
 * POST /api/process
 * 
 * PURPOSE: Unified endpoint for all processing flows
 * SUPPORTS: Marking, Question, Chat, First-time, Follow-up, Auth, Unauth
 * 
 * PARAMETERS:
 * - imageData: Base64 image (optional)
 * - message: Text message (optional)
 * - sessionId: Existing session ID (optional, for follow-up)
 * - model: AI model ('auto', 'gemini-2.5-pro', 'gemini-2.0-flash')
 * - mode: Processing mode ('auto', 'marking', 'question', 'chat')
 * 
 * FLOW DETECTION:
 * - imageData + message: Image with text
 * - imageData only: Image only
 * - message only: Text only
 * - sessionId present: Follow-up
 * - sessionId absent: First-time
 * 
 * AUTHENTICATION:
 * - Authenticated: Full persistence, image links, session management
 * - Unauthenticated: In-memory only, base64 images, no persistence
 * 
 * @param {Object} req - Express request
 * @param {string} req.body.imageData - Base64 encoded image (optional)
 * @param {string} req.body.message - Text message (optional)
 * @param {string} req.body.sessionId - Existing session ID (optional)
 * @param {string} req.body.model - AI model (default: 'auto')
 * @param {string} req.body.mode - Processing mode (default: 'auto')
 * 
 * @returns {Object} Unified response with processing result and session data
 * 
 * @example
 * // First-time image upload
 * const response = await fetch('/api/process', {
 *   method: 'POST',
 *   body: JSON.stringify({ imageData: 'base64...', model: 'auto' })
 * });
 * 
 * @example
 * // Follow-up text message
 * const response = await fetch('/api/process', {
 *   method: 'POST',
 *   body: JSON.stringify({ 
 *     message: 'Can you explain this step?', 
 *     sessionId: 'session-123',
 *     model: 'auto'
 *   })
 * });
 * 
 * @example
 * // Text-only chat
 * const response = await fetch('/api/process', {
 *   method: 'POST',
 *   body: JSON.stringify({ 
 *     message: 'What is 2+2?', 
 *     mode: 'chat'
 *   })
 * });
 */
router.post('/process', optionalAuth, markingMiddleware(), async (req: Request, res: Response) => {
  try {
    // Process request using unified service
    const result = await UnifiedMarkingService.processRequest(req, {
      // Additional options can be passed here
    });
    
    // Return unified response
    res.json(result);
    
  } catch (error) {
    console.error('❌ Unified marking endpoint error:', error);
    
    // Fail fast - return clear error
    res.status(500).json({
      success: false,
      error: error.message || 'Processing failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Contact support'
    });
  }
});

/**
 * POST /api/process-stream
 * 
 * PURPOSE: Unified endpoint with Server-Sent Events (SSE) for real-time progress
 * SUPPORTS: Same as /api/process but with real-time progress updates
 * 
 * @param {Object} req - Express request
 * @param {string} req.body.imageData - Base64 encoded image (optional)
 * @param {string} req.body.message - Text message (optional)
 * @param {string} req.body.sessionId - Existing session ID (optional)
 * @param {string} req.body.model - AI model (default: 'auto')
 * @param {string} req.body.mode - Processing mode (default: 'auto')
 * 
 * @returns {Server-Sent Events} Real-time progress updates
 */
router.post('/process-stream', optionalAuth, markingMiddleware(), async (req: Request, res: Response) => {
  try {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    res.write('data: {"type":"connected","message":"SSE connection established"}\n\n');

    // Process request with progress callbacks
    const result = await UnifiedMarkingService.processRequest(req, {
      onProgress: (progressData: any) => {
        // Send progress update via SSE
        res.write(`data: ${JSON.stringify({
          type: 'progress',
          ...progressData
        })}\n\n`);
      }
    });

    // Send final result
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      ...result
    })}\n\n`);

    // Close connection
    res.end();
    
  } catch (error) {
    console.error('❌ Unified marking SSE endpoint error:', error);
    
    // Send error via SSE
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message || 'Processing failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : 'Contact support'
    })}\n\n`);
    
    res.end();
  }
});

/**
 * GET /api/process/health
 * 
 * PURPOSE: Health check endpoint for the unified marking service
 * 
 * @returns {Object} Health status
 */
router.get('/process/health', async (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      service: 'unified-marking',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: error.message
    });
  }
});

export default router;
