/**
 * Complete Mark Question API Route
 * Full implementation with real service integration
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import admin from 'firebase-admin';
import { MarkHomeworkWithAnswerAuto } from '../services/marking/MarkHomeworkWithAnswerAuto.js';
import { createAIMessage, handleAIMessageIdForEndpoint } from '../utils/messageUtils.js';

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
  const validModels = ['auto', 'gemini-2.5-pro'];
  return validModels.includes(modelType);
}

const router = express.Router();

/**
 * POST /api/mark-homework/upload
 * 
 * PURPOSE: Admin and test image uploads without AI processing
 * USED BY: Admin panel, test files, bulk upload scenarios
 * DIFFERENCE FROM /process-single: No AI processing, just image storage
 * 
 * USAGE STATS:
 * - Called by: AdminPage.js, test-question-only-node.js
 * - Frequency: Low (admin/test use cases only)
 * - Authentication: Optional (works for both auth and anonymous)
 * 
 * FRONTEND USAGE:
 * - AdminPanel: Bulk image uploads
 * - TestFiles: Image validation testing
 * - SpecialCases: Non-AI image processing
 * 
 * @param {Object} req - Express request
 * @param {string} req.body.imageData - Base64 encoded image
 * @param {string} req.body.model - AI model (default: gemini-2.5-pro)
 * @param {string} req.body.sessionId - Optional session ID for follow-up
 * 
 * @returns {Object} Response with sessionId and user message (no AI response)
 * 
 * @example
 * // Admin panel usage
 * const response = await fetch('/api/mark-homework/upload', {
 *   method: 'POST',
 *   body: JSON.stringify({ imageData, model: 'gemini-2.5-pro' })
 * });
 */
router.post('/upload', optionalAuth, async (req: Request, res: Response) => {
  let { imageData, model = 'auto', sessionId: providedSessionId } = req.body;
  
  // Use centralized model configuration for 'auto'
  if (model === 'auto') {
    const { getDefaultModel } = await import('../config/aiModels.js');
    model = getDefaultModel();
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
      MarkHomeworkWithAnswerAuto.run({
        imageData,
        model,
        debug: false,
        onProgress: undefined
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MarkHomeworkWithAnswerAuto.run() timeout after 30 seconds')), 30000)
      )
    ]) as any; // Type assertion to fix TypeScript errors

    // Create full session data with messages
    // Use provided sessionId for follow-up images, or create new one
    const sessionId = providedSessionId || result.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const sessionTitle = result.sessionTitle || 'Marking Session';
    
    // Upload original image to Firebase Storage for authenticated users only
    let originalImageLink;
    if (isAuthenticated) {
      const { ImageStorageService } = await import('../services/imageStorageService.js');
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
      imageData: !isAuthenticated ? imageData : undefined, // For unauthenticated users
      fileName: 'uploaded-image.png',
      // Add simplified detectedQuestion data 
      detectedQuestion: result.questionDetection?.found ? {
        found: true,
        questionText: result.classification?.extractedQuestionText || '',
        examBoard: result.questionDetection.match?.board || '',
        examCode: result.questionDetection.match?.paperCode || '',
        paperTitle: result.questionDetection.match?.qualification || '',
        subject: result.questionDetection.match?.qualification || '',
        tier: '',
        year: result.questionDetection.match?.year || ''
      } : {
        found: false,
        questionText: '',
        examBoard: '',
        examCode: '',
        paperTitle: '',
        subject: '',
        tier: '',
        year: ''
      },
      processingStats: {
        processingTimeMs: result.processingStats?.processingTimeMs || 0,
        confidence: result.processingStats?.confidence || 0,
        imageSize: result.processingStats?.imageSize || 0,
        modelUsed: result.processingStats?.modelUsed || model,
        apiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
        llmTokens: result.processingStats?.llmTokens || 0,
        mathpixCalls: result.processingStats?.mathpixCalls || 0,
        annotations: result.processingStats?.annotations || 0,
        ocrMethod: result.ocrMethod || 'hybrid'
      }
    };

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage) {
      const { ImageStorageService } = await import('../services/imageStorageService.js');
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
      sessionStats: {
        totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
        totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0),
        totalLlmTokens: result.processingStats?.llmTokens || 0,
        totalMathpixCalls: result.processingStats?.mathpixCalls || 0,
        averageConfidence: result.processingStats?.confidence || 0,
        lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
        lastModelUsed: result.processingStats?.modelUsed || model,
        totalMessages: 1, // Only user message
        imageSize: result.processingStats?.imageSize || 0,
        totalAnnotations: result.processingStats?.annotations || 0
      }
    };

    // Create UnifiedSession with Messages (parent-child structure) - for authenticated users only
    let finalSessionId = sessionId;
    let sessionSaved = false;
    
    if (isAuthenticated) {
      try {
        const { FirestoreService } = await import('../services/firestoreService.js');
        
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
                sessionStats: {
                  totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
                  totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
                  totalLlmTokens: result.processingStats?.llmTokens || 0, // Input tokens
                  totalMathpixCalls: result.processingStats?.mathpixCalls || 0, // Mathpix API calls
                  averageConfidence: result.processingStats?.confidence || 0,
                  lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
                  lastModelUsed: result.processingStats?.modelUsed || model,
                  totalMessages: 1, // Only user message
                  imageSize: result.processingStats?.imageSize || 0,
                  totalAnnotations: result.processingStats?.annotations || 0
                }
              });
            
            // CRITICAL: Wait for session to be fully created and verify it exists
            let sessionVerified = false;
            let attempts = 0;
            const maxAttempts = 10;
            
            while (!sessionVerified && attempts < maxAttempts) {
              attempts++;
              try {
                const verifySession = await FirestoreService.getUnifiedSession(finalSessionId);
                if (verifySession && verifySession.id) {
                  sessionVerified = true;
                  } else {
                  await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
                }
              } catch (error) {
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
        const { FirestoreService } = await import('../services/firestoreService.js');
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
      processingStats: result.processingStats
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
      sessionStats: {
        totalMessages: 1,
        lastModelUsed: result.processingStats?.modelUsed || model,
        totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
        lastApiUsed: result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
        totalLlmTokens: result.processingStats?.llmTokens || 0, // Input tokens
        totalMathpixCalls: result.processingStats?.mathpixCalls || 0, // Mathpix API calls
        totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
        averageConfidence: result.processingStats?.confidence || 0,
        imageSize: result.processingStats?.imageSize || 0,
        totalAnnotations: result.processingStats?.annotations || 0
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
    
    // Provide user-friendly error messages based on error type
    let userFriendlyMessage = 'Internal server error in mark question system';
    let statusCode = 500;
    
    if (error instanceof Error) {
      if (error.message.includes('quota exceeded') || error.message.includes('429')) {
        userFriendlyMessage = 'API quota exceeded. Please try again later or contact support if this persists.';
        statusCode = 429;
      } else if (error.message.includes('timeout')) {
        userFriendlyMessage = 'Request timed out. The image might be too complex or the service is busy. Please try again.';
        statusCode = 408;
      } else if (error.message.includes('authentication') || error.message.includes('401') || error.message.includes('403')) {
        userFriendlyMessage = 'Authentication error. Please refresh the page and try again.';
        statusCode = 401;
      } else if (error.message.includes('network') || error.message.includes('connection')) {
        userFriendlyMessage = 'Network error. Please check your connection and try again.';
        statusCode = 503;
      }
    }
    
    return res.status(statusCode).json({ 
      success: false, 
      error: userFriendlyMessage, 
      details: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Contact support' 
    });
  }
});

/**
 * POST /api/mark-homework/process-single-stream
 * 
 * PURPOSE: SSE endpoint for real-time progress tracking during image processing
 * USED BY: Frontend for progress updates during AI processing
 * 
 * @param {Object} req - Express request
 * @param {string} req.body.imageData - Base64 encoded image
 * @param {string} req.body.model - AI model (default: gemini-2.5-pro)
 * @param {Object} req.body.userMessage - Optional user message
 * 
 * @returns {SSE Stream} Real-time progress updates
 */
router.post('/process-single-stream', optionalAuth, async (req: Request, res: Response) => {
  let { imageData, model = 'auto', userMessage, debug = false, aiMessageId } = req.body;

  if (!imageData) {
    return res.status(400).json({ success: false, error: 'Image data is required' });
  }

  // Use centralized model configuration for 'auto'
  if (model === 'auto') {
    const { getDefaultModel } = await import('../config/aiModels.js');
    model = getDefaultModel();
  }

  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;
    

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Progress callback for SSE
    const onProgress = (data: any) => {
      try {
        // Don't send progress updates with isComplete: true via SSE
        // The complete event will be sent separately with the final result
        if (data.isComplete) {
          return;
        }
        const sseData = `data: ${JSON.stringify(data)}\n\n`;
        res.write(sseData);
      } catch (sseError) {
        console.error('❌ SSE write error:', sseError);
        console.error('❌ SSE data that failed:', data);
        throw sseError;
      }
    };

    // Process the image with auto-progress tracking
      const result = await Promise.race([
        MarkHomeworkWithAnswerAuto.run({
          imageData,
          model,
          debug,
          onProgress
        }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MarkHomeworkWithAnswerAuto.run() timeout after 60 seconds')), 60000)
      )
    ]) as any;

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage && isAuthenticated) {
      const { ImageStorageService } = await import('../services/imageStorageService.js');
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

    // Create AI message with separate content and progressData
    const finalProgressData = result.progressData ? { ...result.progressData, isComplete: true } : null;
    
    // Create AI message using factory
    const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, result.message, 'marking');
    const aiMessage = createAIMessage({
      content: result.message,
      messageId: result.messageId || resolvedAIMessageId,
      imageData: result.annotatedImage || null,
      fileName: result.isQuestionOnly ? null : 'annotated-image.png',
      progressData: finalProgressData,
      isQuestionOnly: result.isQuestionOnly,
      processingStats: {
        processingTimeMs: result.processingStats?.processingTimeMs || 0,
        confidence: result.processingStats?.confidence || 0,
        modelUsed: result.processingStats?.modelUsed || model,
        apiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
        ocrMethod: result.ocrMethod || 'Enhanced OCR Processing',
        annotations: result.processingStats?.annotations || 0,
        llmTokens: result.processingStats?.llmTokens || 0,
        mathpixCalls: result.processingStats?.mathpixCalls || 0
      }
    });

    // Add detectedQuestion data to AI message
    (aiMessage as any).detectedQuestion = result.questionDetection?.found ? {
      found: true,
      questionText: result.classification?.extractedQuestionText || '',
      examBoard: result.questionDetection.match?.board || '',
      examCode: result.questionDetection.match?.paperCode || '',
      paperTitle: result.questionDetection.match?.qualification || '',
      subject: result.questionDetection.match?.qualification || '',
      tier: '',
      year: result.questionDetection.match?.year || ''
    } : {
      found: false,
      questionText: '',
      examBoard: '',
      examCode: '',
      paperTitle: '',
      subject: '',
      tier: '',
      year: ''
    };

    // Update AI message with image link for authenticated users
    if (isAuthenticated && annotatedImageLink) {
      (aiMessage as any).imageLink = annotatedImageLink;
      (aiMessage as any).imageData = undefined; // Don't send base64 data for authenticated users
    }

    // Determine session ID (needed for response)
    const isFollowUp = userMessage?.sessionId && userMessage.sessionId !== 'undefined';
    let sessionId = userMessage?.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // For authenticated users, persist to database
    if (isAuthenticated) {
      try {
        const { FirestoreService } = await import('../services/firestoreService.js');
        
        // Create timestamps to ensure proper order
        const baseTime = Date.now();
        const userTimestamp = new Date(baseTime - 2000).toISOString(); // 2 seconds earlier
        const aiTimestamp = new Date(baseTime).toISOString(); // Current time
        
        // Upload original image to Firebase Storage for authenticated users only
        let originalImageLink;
        const { ImageStorageService } = await import('../services/imageStorageService.js');
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

        // Create user message for database (earlier timestamp)
        const dbUserMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          content: userMessage?.content || 'I have a question about this image. Can you help me understand it?',
          timestamp: userTimestamp,
          type: isFollowUp ? 'follow_up' : 'marking_original',
          imageLink: originalImageLink, // For authenticated users
          imageData: !isAuthenticated ? imageData : undefined, // For unauthenticated users
          fileName: 'uploaded-image.png',
          processingStats: {
            processingTimeMs: 0,
            confidence: 0,
            modelUsed: model,
            apiUsed: 'User Upload',
            ocrMethod: 'User Upload'
          }
        };

        // Update AI message timestamp for database (later timestamp)
        const dbAiMessage = {
          ...aiMessage,
          timestamp: aiTimestamp
        };

        if (isFollowUp) {
          // For follow-up messages, add to existing session
          try {
            await FirestoreService.addMessageToUnifiedSession(sessionId, dbUserMessage);
            await FirestoreService.addMessageToUnifiedSession(sessionId, dbAiMessage);
            } catch (error) {
            // Create new session with both user and AI messages
            await FirestoreService.createUnifiedSessionWithMessages({
              sessionId: sessionId,
              title: result.sessionTitle || 'Marking Session',
              userId: userId,
              messageType: result.isQuestionOnly ? 'Question' : 'Marking',
              messages: [dbUserMessage, dbAiMessage],
              isPastPaper: result.isPastPaper || false,
              sessionStats: {
                totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
                lastModelUsed: result.processingStats?.modelUsed || model,
                lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
                totalLlmTokens: result.processingStats?.llmTokens || 0,
                totalMathpixCalls: result.processingStats?.mathpixCalls || 0,
                totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
                averageConfidence: result.processingStats?.confidence || 0,
                imageSize: result.processingStats?.imageSize || 0,
                totalAnnotations: result.processingStats?.annotations || 0
              }
            });
          }
        } else {
          // For initial messages, create new session
          await FirestoreService.createUnifiedSessionWithMessages({
            sessionId: sessionId,
            title: result.sessionTitle || 'Marking Session',
            userId: userId,
            messageType: result.isQuestionOnly ? 'Question' : 'Marking',
            messages: [dbUserMessage, dbAiMessage],
            isPastPaper: result.isPastPaper || false,
            sessionStats: {
              totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
              lastModelUsed: result.processingStats?.modelUsed || model,
              lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
              totalLlmTokens: result.processingStats?.llmTokens || 0,
              totalMathpixCalls: result.processingStats?.mathpixCalls || 0,
              totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
              averageConfidence: result.processingStats?.confidence || 0,
              imageSize: result.processingStats?.imageSize || 0,
              totalAnnotations: result.processingStats?.annotations || 0
            }
          });
        }
        
      } catch (error) {
        console.error('❌ [SSE] Failed to persist to database:', error);
        // Continue without throwing - user still gets response
      }
    }

    // Get the complete session with metadata for the response
    let completeSession;
    try {
      const { FirestoreService } = await import('../services/firestoreService.js');
      completeSession = await FirestoreService.getUnifiedSession(sessionId);
      
      // Check if session was found
      if (!completeSession) {
        console.error(`❌ Session ${sessionId} not found in database`);
        // Fallback to basic session structure
        completeSession = {
          id: sessionId,
          title: result.sessionTitle || 'Marking Session',
          userId: userId || 'anonymous',
          messageType: 'Marking',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          favorite: false,
          rating: 0,
          messages: [aiMessage],
          sessionStats: result.sessionStats || {}
        };
      } else {
        // Ensure title is set - use the generated title from the service
        if (!completeSession.title) {
          completeSession.title = result.sessionTitle || 'Marking Session';
        }
      }
    } catch (error) {
      console.error('❌ Failed to get complete session:', error);
      // Fallback to basic session structure
      completeSession = {
        id: sessionId,
        title: result.sessionTitle || 'Marking Session',
        userId: userId,
        messageType: result.isQuestionOnly ? 'Question' : 'Marking',
        messages: [aiMessage], // Use aiMessage directly
        isPastPaper: result.isPastPaper || false,
        sessionStats: {
          totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
          lastModelUsed: result.processingStats?.modelUsed || model,
          lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
          totalLlmTokens: result.processingStats?.llmTokens || 0,
          totalMathpixCalls: result.processingStats?.mathpixCalls || 0,
          totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
          averageConfidence: result.processingStats?.confidence || 0,
          imageSize: result.processingStats?.imageSize || 0,
          totalAnnotations: result.processingStats?.annotations || 0
        }
      };
    }

    // Send final result (same structure as regular endpoint)
    const finalResult = {
      success: true,
      aiMessage: aiMessage,
      sessionId: sessionId,
      unifiedSession: completeSession
    };
    
    const completeData = { type: 'complete', result: finalResult };
    const sseData = `data: ${JSON.stringify(completeData)}\n\n`;
    
    try {
      res.write(sseData);
      res.end();
    } catch (writeError) {
      console.error('❌ SSE final write error:', writeError);
      console.error('❌ SSE final data that failed:', completeData);
      throw writeError;
    }

  } catch (error) {
    console.error('❌ Error in process-single-stream:', error);
    console.error('❌ Error stack:', error.stack);
    
    try {
      // Provide user-friendly error messages based on error type
      let userFriendlyMessage = 'An unexpected error occurred. Please try again.';
      
      if (error instanceof Error) {
        if (error.message.includes('quota exceeded') || error.message.includes('429')) {
          userFriendlyMessage = 'API quota exceeded. Please try again later or contact support if this persists.';
        } else if (error.message.includes('timeout')) {
          userFriendlyMessage = 'Request timed out. The image might be too complex or the service is busy. Please try again.';
        } else if (error.message.includes('authentication') || error.message.includes('401') || error.message.includes('403')) {
          userFriendlyMessage = 'Authentication error. Please refresh the page and try again.';
        } else if (error.message.includes('network') || error.message.includes('connection')) {
          userFriendlyMessage = 'Network error. Please check your connection and try again.';
        }
      }
      
      const errorData = { 
        type: 'error', 
        error: userFriendlyMessage,
        technicalError: process.env['NODE_ENV'] === 'development' ? error.message : undefined
      };
      const sseData = `data: ${JSON.stringify(errorData)}\n\n`;
      res.write(sseData);
      res.end();
    } catch (writeError) {
      console.error('❌ SSE error write failed:', writeError);
      console.error('❌ Original error:', error);
    }
  }
});

/**
router.post('/process', optionalAuth, async (req: Request, res: Response) => {
  // Log usage for monitoring and documentation
  let { imageData, model = 'auto', sessionId, userMessage } = req.body;
  
  // Use centralized model configuration for 'auto'
  if (model === 'auto') {
    const { getDefaultModel } = await import('../config/aiModels.js');
    model = getDefaultModel();
  }
  
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!sessionId) return res.status(400).json({ success: false, error: 'Session ID is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    const isAuthenticated = !!(req as any)?.user?.uid;

    // Process the image for AI response
    const result = await MarkHomeworkWithAnswerAuto.run({
      imageData,
      model,
      debug: false,
      onProgress: undefined
    }) as any; // Type assertion to fix TypeScript errors

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage && isAuthenticated) {
      const { ImageStorageService } = await import('../services/imageStorageService.js');
      try {
        annotatedImageLink = await ImageStorageService.uploadImage(
          result.annotatedImage,
          userId || 'anonymous',
          sessionId,
          'annotated'
        );
      } catch (error) {
        console.error('❌ Failed to upload annotated image:', error);
        console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
        console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        throw new Error(`Failed to upload annotated image: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Create AI message with separate content and progressData
    const aiMessage = {
      id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant',
      content: result.message,
      timestamp: new Date().toISOString(),
      type: result.isQuestionOnly ? 'question_response' : 'marking_annotated',
      imageLink: annotatedImageLink, // For authenticated users
      imageData: !isAuthenticated && result.annotatedImage ? result.annotatedImage : undefined, // For unauthenticated users
      fileName: 'annotated-image.png',
      processingStats: {
        processingTimeMs: result.processingStats?.processingTimeMs || 0,
        confidence: result.processingStats?.confidence || 0,
        modelUsed: result.processingStats?.modelUsed || model,
        apiUsed: result.processingStats?.apiUsed || result.apiUsed,
        ocrMethod: result.ocrMethod
      }
    };

    // Always create session with only AI message
    let aiSession;
    try {
      const { FirestoreService } = await import('../services/firestoreService.js');
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
              title: result.sessionTitle || 'Marking Session',
              userId: userId,
              messageType: result.isQuestionOnly ? 'Question' : 'Marking',
              messages: messages,
              isPastPaper: result.isPastPaper || false,
              sessionStats: {
                totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
                lastModelUsed: result.processingStats?.modelUsed || model,
                lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
                totalLlmTokens: result.processingStats?.llmTokens || 0, // Input tokens
                totalMathpixCalls: result.processingStats?.mathpixCalls || 0, // Mathpix API calls
                totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
                averageConfidence: result.processingStats?.confidence || 0,
                imageSize: result.processingStats?.imageSize || 0,
                totalAnnotations: result.processingStats?.annotations || 0
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
            sessionStats: {
              totalMessages: aiMessages.length,
              lastModelUsed: result.processingStats?.modelUsed || model,
              totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
              lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
              totalLlmTokens: result.processingStats?.llmTokens || 0, // Input tokens
              totalMathpixCalls: result.processingStats?.mathpixCalls || 0, // Mathpix API calls
              totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
              averageConfidence: result.processingStats?.confidence || 0,
              imageSize: result.processingStats?.imageSize || 0,
              totalAnnotations: result.processingStats?.annotations || 0
            }
          };
        } catch (error) {
          console.error('❌ Failed to add AI message to session:', error);
          console.error('❌ Session ID:', sessionId);
          console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
          console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
          throw new Error(`Failed to add AI message to session: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
          sessionStats: {
            totalMessages: 1,
            lastModelUsed: result.processingStats?.modelUsed || model,
            totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
            lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
            totalLlmTokens: result.processingStats?.llmTokens || 0, // Input tokens
            totalMathpixCalls: result.processingStats?.mathpixCalls || 0, // Mathpix API calls
            totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
            averageConfidence: result.processingStats?.confidence || 0,
            imageSize: result.processingStats?.imageSize || 0,
            totalAnnotations: result.processingStats?.annotations || 0
          }
        };
      }
    } catch (error) {
      console.error('❌ Failed to create AI session:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      throw new Error(`Failed to create AI session: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    const { FirestoreService } = await import('../services/firestoreService.js');
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
