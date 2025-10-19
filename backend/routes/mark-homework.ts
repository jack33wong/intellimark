/**
 * Mark Homework API Route
 * Streamlined implementation with only actively used endpoints
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import admin from 'firebase-admin';
import { MarkingPipeline } from '../services/marking/MarkingPipeline.js';
import { createAIMessage, handleAIMessageIdForEndpoint } from '../utils/messageUtils.js';

// Get Firestore instance
admin.firestore();

// Import centralized model validation
import { isModelSupported } from '../config/aiModels.js';

// Simple model validation function using centralized validation
function validateModelConfig(modelType: string): boolean {
  return isModelSupported(modelType);
}

const router = express.Router();

/**
 * POST /api/mark-homework/process-single-stream
 * 
 * PURPOSE: SSE endpoint for real-time progress tracking during image processing
 * USED BY: Frontend for progress updates during AI processing
 * 
 * @param {Object} req - Express request
 * @param {string} req.body.imageData - Base64 encoded image
 * @param {string} req.body.model - AI model (default: auto)
 * @param {Object} req.body.userMessage - Optional user message
 * 
 * @returns {SSE Stream} Real-time progress updates
 */
router.post('/process-single-stream', optionalAuth, async (req: Request, res: Response) => {
  let { imageData, model = 'auto', customText, debug = false, aiMessageId, sessionId: providedSessionId, originalFileName } = req.body;

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
        MarkingPipeline.run({
          imageData,
          model,
          debug,
          onProgress,
          fileName: originalFileName
        }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('MarkingPipeline.run() timeout after 360 seconds')), 360000)
      )
    ]) as any;

    // Check if result is an error (timeout case)
    if (result instanceof Error) {
      throw result; // Re-throw the timeout error immediately
    }

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
    // Ensure progress data includes all steps and is marked as complete
    const finalProgressData = result.progressData ? { 
      ...result.progressData, 
      isComplete: true,
      currentStepIndex: result.progressData.allSteps ? result.progressData.allSteps.length - 1 : 0,
      currentStepDescription: 'Generating response...'
    } : null;
    
    // Create AI message using factory
    const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, result.message, 'marking');
    const aiMessage = createAIMessage({
      content: result.message,
      messageId: result.messageId || resolvedAIMessageId,
      imageData: result.annotatedImage || null,
      originalFileName: originalFileName,
      progressData: finalProgressData,
      isQuestionOnly: result.isQuestionOnly,
      suggestedFollowUps: result.suggestedFollowUps,
      processingStats: {
        processingTimeMs: result.processingStats?.processingTimeMs || 0,
        confidence: result.processingStats?.confidence || 0,
        modelUsed: result.processingStats?.modelUsed || model,
        apiUsed: result.processingStats?.apiUsed || result.apiUsed || (() => {
          throw new Error('Missing API URL in processing stats - this indicates a service configuration error');
        })(),
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
      questionNumber: result.questionDetection.match?.questionNumber || '',
      subQuestionNumber: result.questionDetection.match?.subQuestionNumber || '',
      examBoard: result.questionDetection.match?.board || '',
      examCode: result.questionDetection.match?.paperCode || '',
      paperTitle: result.questionDetection.match?.qualification || '',
      subject: result.questionDetection.match?.qualification || '',
      tier: result.questionDetection.match?.tier || '',
      year: result.questionDetection.match?.year || '',
      marks: result.questionDetection.match?.marks,
      markingScheme: result.questionDetection.match?.markingScheme?.questionMarks ? JSON.stringify(result.questionDetection.match.markingScheme.questionMarks) : ''
    } : {
      found: false,
      questionText: '',
      questionNumber: '',
      subQuestionNumber: '',
      examBoard: '',
      examCode: '',
      paperTitle: '',
      subject: '',
      tier: '',
      year: '',
      markingScheme: ''
    };

    // Update AI message with image link for authenticated users
    if (isAuthenticated && annotatedImageLink) {
      (aiMessage as any).imageLink = annotatedImageLink;
      (aiMessage as any).imageData = undefined; // Don't send base64 data for authenticated users
    }

    // ============================================================================
    // SESSION ID HANDLING: Different logic for authenticated vs unauthenticated users
    // ============================================================================
    // AUTHENTICATED USERS: Use provided sessionId for follow-up messages to maintain conversation continuity
    // UNAUTHENTICATED USERS: Always create new permanent sessionId (no temp- prefix)
    // ============================================================================
    let sessionId;
    if (isAuthenticated && providedSessionId) {
      // Authenticated users: Use existing session for follow-up messages
      sessionId = providedSessionId;
    } else {
      // Unauthenticated users: Create new permanent session (no temp- prefix)
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    
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

        // Create user message for database using centralized factory
        const { createUserMessage } = await import('../utils/messageUtils.js');
        const dbUserMessage = createUserMessage({
          content: customText || 'I have a question about this image. Can you help me understand it?',
          imageLink: originalImageLink, // For authenticated users
          imageData: !isAuthenticated ? imageData : undefined, // For unauthenticated users
          originalFileName: originalFileName,
          sessionId: sessionId,
          model: model
        });

        // Override timestamp for database consistency
        (dbUserMessage as any).timestamp = userTimestamp;

        // Update AI message timestamp for database (later timestamp)
        const dbAiMessage = {
          ...aiMessage,
          timestamp: aiTimestamp
        };

        if (providedSessionId) {
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
                lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || (() => {
          throw new Error('Missing API URL in processing stats - this indicates a service configuration error');
        })(),
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
            // Remove detectedQuestion from session metadata - now stored in individual messages
            sessionStats: {
              totalProcessingTimeMs: result.processingStats?.processingTimeMs || 0,
              lastModelUsed: result.processingStats?.modelUsed || model,
              lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || (() => {
          throw new Error('Missing API URL in processing stats - this indicates a service configuration error');
        })(),
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
          lastApiUsed: result.processingStats?.apiUsed || result.apiUsed || (() => {
          throw new Error('Missing API URL in processing stats - this indicates a service configuration error');
        })(),
          totalLlmTokens: result.processingStats?.llmTokens || 0,
          totalMathpixCalls: result.processingStats?.mathpixCalls || 0,
          totalTokens: (result.processingStats?.llmTokens || 0) + (result.processingStats?.mathpixCalls || 0) || 0,
          averageConfidence: result.processingStats?.confidence || 0,
          imageSize: result.processingStats?.imageSize || 0,
          totalAnnotations: result.processingStats?.annotations || 0
        }
      };
    }

    // Send final result with consistent format for both authenticated and unauthenticated users
    const finalResult = {
      success: true,
      aiMessage: aiMessage,
      sessionId: sessionId,
      ...(isAuthenticated ? { unifiedSession: completeSession } : { sessionTitle: completeSession.title })
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
 * GET /mark-homework/download-image
 * Download image by proxying the request to avoid CORS issues
 */
router.get('/download-image', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { url, filename } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Image URL is required' 
      });
    }

    // Fetch the image from the external URL
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).json({ 
        success: false, 
        error: 'Image not found' 
      });
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // Set headers for download
    const downloadFilename = filename && typeof filename === 'string' ? filename : 'image';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', imageBuffer.byteLength);
    
    // Send the image data
    res.send(Buffer.from(imageBuffer));
    
  } catch (error) {
    console.error('Error downloading image:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to download image' 
    });
  }
});

export default router;