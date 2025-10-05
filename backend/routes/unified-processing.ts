/**
 * Unified Image Processing API
 * Single endpoint for ALL image processing
 * Handles both authenticated and unauthenticated users
 * Returns consistent response structure
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { optionalAuth } from '../middleware/auth.js';
import { MarkHomeworkWithAnswerAuto } from '../services/marking/MarkHomeworkWithAnswerAuto.js';
import { FirestoreService } from '../services/firestoreService.js';
import { ImageStorageService } from '../services/imageStorageService.js';

const router = Router();

/**
 * Unified image processing endpoint
 * POST /api/process
 */
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { imageData, model = 'auto', sessionId = null, isFollowUp = false } = req.body;
    
    if (!imageData) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;


    // Process image for AI analysis
    const result = await MarkHomeworkWithAnswerAuto.run({
      imageData,
      model,
      debug: false,
      onProgress: undefined
    });

    // Generate session ID
    const finalSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Upload original image to Firebase Storage if authenticated
    let originalImageLink = null;
    if (isAuthenticated) {
      try {
        originalImageLink = await ImageStorageService.uploadImage(
          imageData,
          userId,
          finalSessionId,
          'original'
        );
      } catch (error) {
        console.error('❌ Failed to upload original image:', error);
        originalImageLink = null;
      }
    }

    // Create user message
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: 'I have a question about this image. Can you help me understand it?',
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_original' : 'marking_original',
      imageLink: originalImageLink, // For authenticated users
      imageData: !isAuthenticated ? imageData : undefined, // For unauthenticated users
      fileName: 'uploaded-image.png',
      detectedQuestion: result.questionDetection?.found ? {
        found: true,
        questionText: result.classification?.extractedQuestionText || '',
        message: result.questionDetection?.message || 'Question detected'
      } : {
        found: false,
        message: result.questionDetection?.message || 'No question detected'
      },
      metadata: {
        processingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
        confidence: result.metadata?.confidence || 0,
        imageSize: result.metadata?.imageSize || 0
      }
    };

    // Save session if authenticated
    if (isAuthenticated) {
      try {
        if (isFollowUp && sessionId) {
          // Add message to existing session
          await FirestoreService.addMessageToUnifiedSession(sessionId, userMessage);
        } else {
          // Create new session
          await FirestoreService.createUnifiedSessionWithMessages({
            sessionId: finalSessionId,
            title: result.isPastPaper 
              ? `Past Paper - ${result.classification?.extractedQuestionText?.substring(0, 20) || 'Question'}`
              : `${result.isQuestionOnly ? 'Question' : 'Marking'} ${result.classification?.extractedQuestionText?.substring(0, 20) || new Date().toLocaleDateString()}`,
            userId,
            messageType: result.isQuestionOnly ? 'Question' : 'Marking',
            messages: [userMessage],
            isPastPaper: result.isPastPaper || false
          });
        }
      } catch (error) {
        console.error('❌ Failed to save session:', error);
      }
    }

    // Return Response 1: Original image
    return res.json({
      success: true,
      data: {
        responseType: 'original_image',
        userMessage,
        sessionId: finalSessionId,
        imageData: !isAuthenticated ? imageData : undefined, // For unauthenticated users
        processing: true
      }
    });

  } catch (error) {
    console.error('❌ Unified processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Contact support'
    });
  }
});

/**
 * AI response processing endpoint
 * POST /api/process/ai
 */
router.post('/ai', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { imageData, sessionId, model = 'auto' } = req.body;
    
    if (!imageData || !sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Image data and session ID are required'
      });
    }

    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;

    // Process image for AI response
    const result = await MarkHomeworkWithAnswerAuto.run({
      imageData,
      model,
      debug: false,
      onProgress: undefined
    });

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink = null;
    if (!result.isQuestionOnly && result.annotatedImage && isAuthenticated) {
      try {
        annotatedImageLink = await ImageStorageService.uploadImage(
          result.annotatedImage,
          userId,
          sessionId,
          'annotated'
        );
      } catch (error) {
        console.error('❌ Failed to upload annotated image:', error);
        annotatedImageLink = null;
      }
    }

    // Create AI response message
    // Use content-based ID for stability across re-renders
    const aiContentHash = crypto.createHash('md5').update(result.message || 'Processing complete').digest('hex').substring(0, 8);
    const aiMessage = {
      id: `msg-${aiContentHash}`,
      role: 'assistant',
      content: result.message || 'Processing complete',
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_response' : 'marking_annotated',
      imageLink: annotatedImageLink, // For authenticated users
      imageData: !isAuthenticated && result.annotatedImage ? result.annotatedImage : undefined, // For unauthenticated users
      fileName: 'annotated-image.png',
      metadata: {
        processingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
        confidence: result.metadata?.confidence || 0,
        apiUsed: result.apiUsed,
        ocrMethod: result.ocrMethod
      }
    };

    // Save AI message to database if authenticated
    if (isAuthenticated) {
      try {
        await FirestoreService.addMessageToUnifiedSession(sessionId, aiMessage);
      } catch (error) {
        console.error('❌ Failed to save AI message:', error);
      }
    }

    // Return Response 2: AI response
    return res.json({
      success: true,
      data: {
        responseType: 'ai_response',
        aiMessage,
        sessionId,
        isQuestionOnly: result.isQuestionOnly,
        markingResult: isAuthenticated ? {
          instructions: result.instructions,
          classification: result.classification,
          metadata: result.metadata,
          apiUsed: result.apiUsed,
          ocrMethod: result.ocrMethod
        } : null
      }
    });

  } catch (error) {
    console.error('❌ AI processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error in AI processing',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Contact support'
    });
  }
});

export default router;
