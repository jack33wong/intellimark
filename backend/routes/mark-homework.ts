/**
 * Complete Mark Question API Route
 * Full implementation with real service integration
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth';
import admin from 'firebase-admin';
import { MarkHomeworkWithAnswer } from '../services/marking/MarkHomeworkWithAnswer';

// Get Firestore instance
admin.firestore();

// Helper function to sanitize data for Firestore (remove undefined values)
function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore).filter(item => item !== undefined);
  }
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeForFirestore(value);
      }
    }
    return sanitized;
  }
  return obj;
}

// Orchestrator owns inner service types; route stays thin

// Simple model validation function to avoid import issues
function validateModelConfig(modelType: string): boolean {
  const validModels = ['gemini-2.5-pro', 'chatgpt-5', 'chatgpt-4o'];
  return validModels.includes(modelType);
}

const router = express.Router();

/**
 * POST /mark-homework
 * Returns full session data with all messages and metadata
 */
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  const { imageData, model = 'chatgpt-4o', sessionId: providedSessionId } = req.body;
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;

    // Delegate to orchestrator (see docs/markanswer.md)
    const result = await MarkHomeworkWithAnswer.run({
      imageData,
      model,
      userId,
      userEmail
    });

    // Create full session data with messages
    // Use provided sessionId for follow-up images, or create new one
    const sessionId = providedSessionId || result.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionTitle = result.sessionTitle || 'Marking Session';
    
    // Upload original image to Firebase Storage for authenticated users
    let originalImageLink;
    if (isAuthenticated) {
      const { ImageStorageService } = await import('../services/imageStorageService');
      try {
        originalImageLink = await ImageStorageService.uploadImage(
          imageData,
          userId || 'anonymous',
          sessionId,
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
      // Add simplified detectedQuestion data 
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

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage) {
      const { ImageStorageService } = await import('../services/imageStorageService');
      try {
        console.log('⬆️ Uploading annotated image to Firebase Storage...');
        annotatedImageLink = await ImageStorageService.uploadImage(
          result.annotatedImage,
          userId || 'anonymous', 
          sessionId,
          'annotated'
        );
      } catch (error) {
        console.error('❌ Failed to upload annotated image:', error);
        annotatedImageLink = null;
      }
    }

    // For authenticated users, only create user message (AI message will be created in /process endpoint)
    let session;
    if (isAuthenticated) {
      // Create session with only user message for authenticated users
      session = {
        id: sessionId,
        title: sessionTitle,
        messages: [userMessage], // Only user message
        userId: userId,
        messageType: result.isQuestionOnly ? 'Question' : 'Marking',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0,
        sessionMetadata: {
          totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
          totalTokens: result.metadata?.tokens?.reduce((a: number, b: number) => a + b, 0) || 0,
          averageConfidence: result.metadata?.confidence || 0,
          lastApiUsed: result.apiUsed || 'Complete AI Marking System',
          lastModelUsed: model,
          totalMessages: 1 // Only user message
        }
      };
    } else {
      // For unauthenticated users, create complete session with both messages (legacy behavior)
      const aiMessage = {
        id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: result.message || 'Question marked successfully with burned annotations',
        timestamp: new Date().toISOString(),
        type: result.isQuestionOnly ? 'question_response' : 'marking_annotated',
        model: model,
        apiUsed: result.apiUsed || 'Complete AI Marking System',
        // Add imageLink for annotated images (uploaded to Firebase Storage)
        imageLink: annotatedImageLink,
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
          tokens: result.metadata?.tokens || [0, 0],
          confidence: result.metadata?.confidence || 0,
          totalAnnotations: result.metadata?.totalAnnotations || 0,
          imageSize: result.metadata?.imageSize || 0,
          ocrMethod: result.ocrMethod || 'Enhanced OCR Processing',
          classificationResult: result.classification ? sanitizeForFirestore(result.classification) : null
        }
      };

      session = {
        id: sessionId,
        title: sessionTitle,
        messages: [userMessage, aiMessage], // Both messages for unauthenticated users
        userId: userId,
        messageType: result.isQuestionOnly ? 'Question' : 'Marking',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        favorite: false,
        rating: 0,
        sessionMetadata: {
          totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
          totalTokens: result.metadata?.tokens?.reduce((a: number, b: number) => a + b, 0) || 0,
          averageConfidence: result.metadata?.confidence || 0,
          lastApiUsed: result.apiUsed || 'Complete AI Marking System',
          lastModelUsed: model,
          totalMessages: 2
        }
      };
    }

    // Create UnifiedSession with Messages (parent-child structure) - only for authenticated users
    let finalSessionId = sessionId;
    let sessionSaved = false;
    
    if (isAuthenticated) {
      try {
        const { FirestoreService } = await import('../services/firestoreService');
        
        if (providedSessionId) {
          // Follow-up image: Add message to existing session
          await FirestoreService.addMessageToUnifiedSession(providedSessionId, userMessage);
          finalSessionId = providedSessionId;
          sessionSaved = true;
        } else {
          // New session: Create complete session with messages using parent-child structure
          finalSessionId = await FirestoreService.createUnifiedSessionWithMessages({
            sessionId: finalSessionId,
            title: sessionTitle,
            userId: userId,
            messageType: result.isQuestionOnly ? 'Question' : 'Marking',
            messages: [userMessage], // Only user message for authenticated users
            isPastPaper: result.isPastPaper || false,
            sessionMetadata: {
              totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
              totalTokens: result.metadata?.tokens?.reduce((a: number, b: number) => a + b, 0) || 0,
              averageConfidence: result.metadata?.confidence || 0,
              lastApiUsed: result.apiUsed || 'Complete AI Marking System',
              lastModelUsed: model,
              totalMessages: 1 // Only user message
            }
          });
          
          sessionSaved = true;
        }
      } catch (error) {
        console.error('❌ Failed to create/add to UnifiedSession:', error);
        // Continue with response even if session creation fails
      }
    }

    // Get the properly formatted session from our UnifiedSession API
    let finalSession;
    try {
      if (sessionSaved) {
        const { FirestoreService } = await import('../services/firestoreService');
        finalSession = await FirestoreService.getUnifiedSession(finalSessionId);
      } else {
        // Fallback for unsaved sessions
        finalSession = {
          ...session,
          id: finalSessionId,
          messages: session.messages || []
        };
      }
    } catch (error) {
      console.error('Failed to get formatted session:', error);
      // Fallback to basic session structure
      finalSession = {
        ...session,
        id: finalSessionId,
        messages: session.messages || []
      };
    }

    // Create clean result without markingData or base64 images for response
    const cleanResult = {
      isQuestionOnly: result.isQuestionOnly,
      result: result.result,
      // annotatedImage removed - frontend will get imageLink in messages
      instructions: result.instructions,
      message: result.message,
      apiUsed: result.apiUsed,
      ocrMethod: result.ocrMethod,
      classification: result.classification,
      questionDetection: result.questionDetection,
      sessionId: result.sessionId,
      sessionTitle: result.sessionTitle,
      metadata: result.metadata
    };

    // For both authenticated and unauthenticated users, return user message immediately (Response 1)
    return res.json({
      success: true,
      responseType: 'original_image',
      userMessage: userMessage,
      processing: true,
      sessionId: finalSessionId,
      sessionTitle: sessionTitle
    });
  } catch (error) {
    console.error('Error in complete mark question:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error in mark question system', 
      details: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Contact support' 
    });
  }
});

/**
 * POST /mark-homework/process
 * Complete AI processing and return AI response (Response 2)
 */
router.post('/process', optionalAuth, async (req: Request, res: Response) => {
  const { imageData, model = 'chatgpt-4o', sessionId } = req.body;
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!sessionId) return res.status(400).json({ success: false, error: 'Session ID is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;
    
    console.log('🔍 DEBUG: /process endpoint called', { 
      sessionId, 
      isAuthenticated, 
      userId,
      imageDataLength: imageData?.length 
    });
    

    // Process the image for AI response
    const result = await MarkHomeworkWithAnswer.run({
      imageData,
      model,
      userId,
      userEmail
    });

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage && isAuthenticated) {
      const { ImageStorageService } = await import('../services/imageStorageService');
      try {
        annotatedImageLink = await ImageStorageService.uploadImage(
          result.annotatedImage,
          userId || 'anonymous',
          sessionId,
          'annotated'
        );
      } catch (error) {
        console.error('❌ Failed to upload annotated image:', error);
        annotatedImageLink = null;
      }
    }

    // Create AI response message
    const aiMessage = {
      id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
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
        modelUsed: result.metadata?.modelUsed || model,
        apiUsed: result.apiUsed,
        ocrMethod: result.ocrMethod
      }
    };

    // Save AI message to database if authenticated
    if (isAuthenticated) {
      const { FirestoreService } = await import('../services/firestoreService');
      try {
        await FirestoreService.addMessageToUnifiedSession(sessionId, aiMessage);
      } catch (error) {
        console.error('❌ Failed to save AI message:', error);
      }
    }


    return res.json({
      success: true,
      responseType: 'ai_response',
      aiMessage: aiMessage,
      processing: false,
      sessionId: sessionId,
      isQuestionOnly: result.isQuestionOnly,
      markingResult: isAuthenticated ? {
        instructions: result.instructions,
        classification: result.classification,
        metadata: result.metadata,
        apiUsed: result.apiUsed,
        ocrMethod: result.ocrMethod
      } : null
    });

  } catch (error) {
    console.error('Error in AI processing:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error in AI processing', 
      details: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Contact support' 
    });
  }
});

/**
 * GET /mark-homework/stats
 * Get system statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const { FirestoreService } = await import('../services/firestoreService');
    const stats = await FirestoreService.getSystemStats();
    return res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error retrieving system statistics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve system statistics'
    });
  }
});

/**
 * GET /mark-homework/health
 * Health check for mark question system
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'Complete Mark Question System',
    features: [
      'AI Image Classification',
      'Real OCR Processing',
      'AI Marking Instructions',
      'Professional SVG Overlays',
      'Real Firestore Database Storage',
      'User History & Statistics'
    ],
    timestamp: new Date().toISOString()
  });
});

export default router;
