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
 * POST /mark-homework/upload
 * Returns user message only (AI message will be created in /process endpoint)
 */
router.post('/upload', optionalAuth, async (req: Request, res: Response) => {
  let { imageData, model = 'gemini-2.5-pro', sessionId: providedSessionId } = req.body;
  
  // Convert 'auto' to default model
  if (model === 'auto') {
    model = 'gemini-2.5-pro';
  }
  
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;

    // Delegate to orchestrator (see docs/markanswer.md)
    
    // Add timeout to prevent hanging
    const result = await Promise.race([
      MarkHomeworkWithAnswer.run({
        imageData,
        model,
        userId,
        userEmail
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MarkHomeworkWithAnswer.run() timeout after 30 seconds')), 30000)
      )
    ]) as any; // Type assertion to fix TypeScript errors
    

    // Create full session data with messages
    // Use provided sessionId for follow-up images, or create new one
    const sessionId = providedSessionId || result.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionTitle = result.sessionTitle || 'Marking Session';
    
    // Upload original image to Firebase Storage for authenticated users only
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

    // Create user message - IDENTICAL for both authenticated and unauthenticated users
    const userMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: 'I have a question about this image. Can you help me understand it?',
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_original' : 'marking_original',
      imageLink: originalImageLink, // Only for authenticated users (null for unauthenticated)
      imageData: imageData, // ALWAYS include imageData for immediate display
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

    // Always create session with only user message (AI message will be created in /process endpoint)
    const session = {
      id: sessionId,
      title: sessionTitle,
      messages: [userMessage], // Only user message for all users
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

    // Create UnifiedSession with Messages (parent-child structure) - for authenticated users only
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
          try {
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
            
            // CRITICAL: Wait for session to be fully created and verify it exists
            console.log(`🔍 [PHASE1] Waiting for session ${finalSessionId} to be created...`);
            let sessionVerified = false;
            let attempts = 0;
            const maxAttempts = 10;
            
            while (!sessionVerified && attempts < maxAttempts) {
              attempts++;
              try {
                const verifySession = await FirestoreService.getUnifiedSession(finalSessionId);
                if (verifySession && verifySession.id) {
                  sessionVerified = true;
                  console.log(`✅ [PHASE1] Session ${finalSessionId} verified after ${attempts} attempts`);
                } else {
                  console.log(`⏳ [PHASE1] Session ${finalSessionId} not ready, attempt ${attempts}/${maxAttempts}`);
                  await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
                }
              } catch (error) {
                console.log(`⏳ [PHASE1] Session verification failed, attempt ${attempts}/${maxAttempts}:`, error.message);
                await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
              }
            }
            
            if (!sessionVerified) {
              throw new Error(`Session ${finalSessionId} could not be verified after ${maxAttempts} attempts`);
            }
            
            sessionSaved = true;
          } catch (createError) {
            console.error(`❌ [${new Date().toISOString()}] /upload endpoint: createUnifiedSessionWithMessages failed:`, createError);
            console.error(`❌ [${new Date().toISOString()}] /upload endpoint: Create error details:`, createError.message);
            console.error(`❌ [${new Date().toISOString()}] /upload endpoint: Create error stack:`, createError.stack);
            throw createError; // Re-throw to be caught by outer catch block
          }
        }
      } catch (error) {
        console.error('❌ Failed to create/add to UnifiedSession:', error);
        console.error('❌ Error details:', error.message);
        console.error('❌ Error stack:', error.stack);
        // Don't continue if session creation fails - this is critical
        throw new Error(`Session creation failed: ${error.message}`);
      }
    } else {
      // For unauthenticated users, we don't save to database but still return the same structure
    }
    
    // For unauthenticated users, we don't save to database but still return the same structure

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

    // Create UnifiedSession for Response 1 (Original Image)
    const unifiedSession = {
      id: finalSessionId,
      title: sessionTitle,
      messages: [userMessage],
      userId: userId,
      userEmail: userEmail,
      messageType: result.isQuestionOnly ? 'Question' : 'Marking',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isPastPaper: result.isPastPaper || false,
      favorite: false,
      rating: 0,
      sessionMetadata: {
        totalMessages: 1,
        lastModelUsed: model,
        totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
        lastApiUsed: result.apiUsed || 'Complete AI Marking System'
      }
    };

    // For both authenticated and unauthenticated users, return UnifiedSession immediately (Response 1)
    
    return res.json({
      success: true,
      responseType: 'original_image',
      unifiedSession: unifiedSession,
      processing: true,
      classification: result.classification,
      debug: {
        isAuthenticated,
        userId,
        userEmail,
        sessionSaved,
        finalSessionId,
        userMessageForDebug: userMessage
      }
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
 * POST /mark-homework/process-single
 * Single-phase: Upload + Classification + AI Processing
 * Returns just the AI message structure
 */
router.post('/process-single', optionalAuth, async (req: Request, res: Response) => {
  let { imageData, model = 'gemini-2.5-pro', userMessage } = req.body;

  if (!imageData) {
    return res.status(400).json({ success: false, error: 'Image data is required' });
  }

  // Convert 'auto' to default model
  if (model === 'auto') {
    model = 'gemini-2.5-pro';
  }

  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;

    // Process the image for AI response (includes classification + marking)
    // Add timeout to prevent hanging
    const result = await Promise.race([
      MarkHomeworkWithAnswer.run({
        imageData,
        model,
        userId,
        userEmail
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MarkHomeworkWithAnswer.run() timeout after 60 seconds')), 60000)
      )
    ]) as any;

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage && isAuthenticated) {
      const { ImageStorageService } = await import('../services/imageStorageService');
      try {
        annotatedImageLink = await ImageStorageService.uploadImage(
          result.annotatedImage,
          userId || 'anonymous',
          `single-${Date.now()}`,
          'annotated'
        );
      } catch (error) {
        console.error('❌ Failed to upload annotated image:', error);
        annotatedImageLink = null;
      }
    }

    // Create AI response message (common for both authenticated and unauthenticated users)
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

    // For authenticated users, persist to database
    if (isAuthenticated) {
      try {
        const { FirestoreService } = await import('../services/firestoreService');
        
        // Determine if this is a follow-up message (existing session) or new session
        const isFollowUp = userMessage?.sessionId && userMessage.sessionId !== 'undefined';
        let sessionId = userMessage?.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Create timestamps to ensure proper order
        const baseTime = Date.now();
        const userTimestamp = new Date(baseTime - 2000).toISOString(); // 2 seconds earlier
        const aiTimestamp = new Date(baseTime).toISOString(); // Current time
        
        // Create user message for database (earlier timestamp)
        const dbUserMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          content: userMessage?.content || 'I have a question about this image. Can you help me understand it?',
          timestamp: userTimestamp,
          type: isFollowUp ? 'follow_up' : 'marking_original',
          imageData: imageData, // Store original image data
          fileName: 'uploaded-image.png',
          metadata: {
            processingTimeMs: 0,
            confidence: 0,
            modelUsed: model,
            apiUsed: 'Single-Phase Upload',
            ocrMethod: 'User Upload'
          }
        };

        // Update AI message timestamp for database (later timestamp)
        const dbAiMessage = {
          ...aiMessage,
          timestamp: aiTimestamp
        };

        // Single-phase: Always create new session immediately (no retry needed)
        await FirestoreService.createUnifiedSessionWithMessages({
          sessionId: sessionId,
          title: 'Marking Session',
          userId: userId,
          messageType: result.isQuestionOnly ? 'Question' : 'Marking',
          messages: [dbUserMessage, dbAiMessage],
          isPastPaper: result.isPastPaper || false,
          sessionMetadata: {
            totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
            lastModelUsed: model,
            lastApiUsed: result.apiUsed || 'Single-Phase AI Marking System'
          }
        });
        console.log(`✅ [SINGLE-PHASE] Created new session ${sessionId} for user ${userId}`);
        
      } catch (error) {
        console.error('❌ [SINGLE-PHASE] Failed to persist to database:', error);
        // Continue without throwing - user still gets response
      }
    }

    // Return just the AI message structure
    res.json({
      success: true,
      aiMessage: aiMessage
    });

  } catch (error) {
    console.error('❌ Single-phase processing failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Single-phase processing failed'
    });
  }
});

/**
 * POST /mark-homework/process
 * Complete AI processing and return AI response (Response 2)
 */
router.post('/process', optionalAuth, async (req: Request, res: Response) => {
  let { imageData, model = 'gemini-2.5-pro', sessionId, userMessage } = req.body;
  
  // Convert 'auto' to default model
  if (model === 'auto') {
    model = 'gemini-2.5-pro';
  }
  
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!sessionId) return res.status(400).json({ success: false, error: 'Session ID is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;
    

    // Process the image for AI response
    const result = await MarkHomeworkWithAnswer.run({
      imageData,
      model,
      userId,
      userEmail
    }) as any; // Type assertion to fix TypeScript errors

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

    // Always create session with only AI message
    let aiSession;
    try {
      const { FirestoreService } = await import('../services/firestoreService');
      if (isAuthenticated) {
        try {
          // Try to add the AI message to the existing session
          
          
          try {
            
            await FirestoreService.addMessageToUnifiedSession(sessionId, aiMessage);
          } catch (error: any) {
            console.error(`❌ [${new Date().toISOString()}] /process endpoint: addMessageToUnifiedSession failed:`, error);
            console.error(`❌ [${new Date().toISOString()}] /process endpoint: Error message:`, error.message);
            console.error(`❌ [${new Date().toISOString()}] /process endpoint: Error stack:`, error.stack);
            
            // Use the user message passed from frontend
            
            // Create a new session with both user and AI messages if available
            const messages = [];
            if (userMessage) {
              messages.push(userMessage);
              
            }
            messages.push(aiMessage);
            
            await FirestoreService.createUnifiedSessionWithMessages({
              sessionId: sessionId,
              title: 'Marking Session',
              userId: userId,
              messageType: result.isQuestionOnly ? 'Question' : 'Marking',
              messages: messages,
              isPastPaper: result.isPastPaper || false,
              sessionMetadata: {
                totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
                lastModelUsed: model,
                lastApiUsed: result.apiUsed || 'Complete AI Marking System'
              }
            });
          }
          // Get the session with AI message only
          const completeSession = await FirestoreService.getUnifiedSession(sessionId);
          // Extract only the AI message
          const aiMessages = completeSession.messages.filter(msg => msg.role === 'assistant');
          aiSession = {
            id: sessionId,
            title: completeSession.title || 'Marking Session',
            messages: aiMessages, // Only AI message
            userId: userId,
            userEmail: userEmail,
            messageType: result.isQuestionOnly ? 'Question' : 'Marking',
            createdAt: completeSession.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isPastPaper: completeSession.isPastPaper || false,
            favorite: completeSession.favorite || false,
            rating: completeSession.rating || 0,
            sessionMetadata: {
              totalMessages: aiMessages.length,
              lastModelUsed: model,
              totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
              lastApiUsed: result.apiUsed || 'Complete AI Marking System'
            }
          };
        } catch (error) {
          console.error('❌ Failed to add AI message to session:', error);
          console.error('❌ Session ID:', sessionId);
          console.error('❌ Error details:', error.message);
          // Create a fallback session with just the AI message
          aiSession = {
            id: sessionId,
            title: 'Marking Session',
            messages: [aiMessage],
            userId: userId,
            userEmail: userEmail,
            messageType: result.isQuestionOnly ? 'Question' : 'Marking',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isPastPaper: result.isPastPaper || false,
            favorite: false,
            rating: 0,
            sessionMetadata: {
              totalMessages: 1,
              lastModelUsed: model,
              totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
              lastApiUsed: result.apiUsed || 'Complete AI Marking System'
            }
          };
        }
      } else {
        // For unauthenticated users, create session with only AI message
        aiSession = {
          id: sessionId,
          title: 'Marking Session',
          messages: [aiMessage], // Only AI message
          userId: userId,
          userEmail: userEmail,
          messageType: result.isQuestionOnly ? 'Question' : 'Marking',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isPastPaper: false,
          favorite: false,
          rating: 0,
          sessionMetadata: {
            totalMessages: 1,
            lastModelUsed: model,
            totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
            lastApiUsed: result.apiUsed || 'Complete AI Marking System'
          }
        };
      }
    } catch (error) {
      console.error('❌ Failed to create AI session:', error);
      // Fallback to basic session structure
      aiSession = {
        id: sessionId,
        title: 'Marking Session',
        messages: [aiMessage], // Only AI message
        userId: userId,
        userEmail: userEmail,
        messageType: result.isQuestionOnly ? 'Question' : 'Marking',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPastPaper: false,
        favorite: false,
        rating: 0,
        sessionMetadata: {
          totalMessages: 1,
          lastModelUsed: model,
          totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
          lastApiUsed: result.apiUsed || 'Complete AI Marking System'
        }
      };
    }

    return res.json({
      success: true,
      responseType: 'ai_response',
      unifiedSession: aiSession,
      processing: false
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
