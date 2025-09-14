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
  const { imageData, model = 'chatgpt-4o', userId: requestUserId } = req.body;
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || requestUserId || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';

    // Delegate to orchestrator (see docs/markanswer.md)
    const result = await MarkHomeworkWithAnswer.run({
      imageData,
      model,
      userId,
      userEmail
    });

    // Create full session data with messages
    const sessionId = result.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionTitle = result.sessionTitle || 'Marking Session';
    
    // Create user message
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: 'I have a question about this image. Can you help me understand it?',
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_original' : 'marking_original',
      imageData: imageData,
      fileName: 'uploaded-image.png',
      metadata: {
        processingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
        confidence: result.metadata?.confidence || 0,
        imageSize: result.metadata?.imageSize || 0
      }
    };

    // Create AI response message
    const aiMessage = {
      id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant',
      content: result.message || 'Question marked successfully with burned annotations',
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_response' : 'marking_annotated',
      model: model,
      apiUsed: result.apiUsed || 'Complete AI Marking System',
      markingData: {
        instructions: result.instructions,
        annotatedImage: result.annotatedImage,
        classification: result.classification
      },
      detectedQuestion: result.questionDetection,
      metadata: {
        processingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
        tokens: result.metadata?.tokens || [0, 0],
        confidence: result.metadata?.confidence || 0,
        totalAnnotations: result.metadata?.totalAnnotations || 0,
        imageSize: result.metadata?.imageSize || 0,
        ocrMethod: result.ocrMethod || 'Enhanced OCR Processing',
        classificationResult: result.classification
      }
    };

    // Create full session
    const session = {
      id: sessionId,
      title: sessionTitle,
      messages: [userMessage, aiMessage],
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

    // Save session to Firestore
    try {
      const { FirestoreService } = await import('../services/firestoreService');
      const savedSessionId = await FirestoreService.createChatSession({
        title: sessionTitle,
        messages: [userMessage, aiMessage],
        userId: userId,
        messageType: result.isQuestionOnly ? 'Question' : 'Marking',
        favorite: false,
        rating: 0,
        contextSummary: null,
        lastSummaryUpdate: null
      });
      console.log(`✅ Session ${savedSessionId} saved to Firestore for ${result.isQuestionOnly ? 'Question' : 'Marking'} mode`);
    } catch (firestoreError) {
      console.error('⚠️ Failed to save session to Firestore:', firestoreError);
      // Continue with response even if Firestore save fails
    }

    return res.json({
      success: true,
      session: session,
      // Keep original result for backward compatibility
      ...result
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
