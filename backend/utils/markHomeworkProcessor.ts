/**
 * Shared Mark Homework Processing Utility
 * Consolidates duplicate processing logic from all endpoints
 */

import { MarkHomeworkWithAnswer } from '../services/marking/MarkHomeworkWithAnswer.js';
import { ImageStorageService } from '../services/imageStorageService.js';
import { FirestoreService } from '../services/firestoreService.js';
import type { ModelType } from '../types/index.js';

export interface ProcessingOptions {
  imageData: string;
  model: ModelType;
  userId: string;
  userEmail: string;
  isAuthenticated: boolean;
  sessionId?: string;
  userMessage?: any;
}

export interface ProcessingResult {
  success: boolean;
  aiMessage?: any;
  sessionId: string;
  error?: string;
}

/**
 * Shared processing function for all mark homework endpoints
 * Eliminates duplicate logic and provides consistent timeout handling
 */
export async function processMarkHomework(options: ProcessingOptions): Promise<ProcessingResult> {
  const { imageData, model, userId, userEmail, isAuthenticated, sessionId, userMessage } = options;
  
  try {
    // Consistent timeout handling - 60 seconds for all processing
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

    // Generate session ID if not provided
    const finalSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Upload annotated image to Firebase Storage if it's a marking result
    let annotatedImageLink;
    if (!result.isQuestionOnly && result.annotatedImage && isAuthenticated) {
      try {
        annotatedImageLink = await ImageStorageService.uploadImage(
          result.annotatedImage,
          userId || 'anonymous',
          finalSessionId,
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

    // For authenticated users, persist to database
    if (isAuthenticated) {
      try {
        if (sessionId && userMessage) {
          // Follow-up message: add both user and AI messages to existing session
          await FirestoreService.addMessageToUnifiedSession(finalSessionId, userMessage);
          await FirestoreService.addMessageToUnifiedSession(finalSessionId, aiMessage);
          console.log(`✅ [PROCESSOR] Added follow-up messages to existing session ${finalSessionId} for user ${userId}`);
        } else {
          // Initial message: create user message and save both user and AI messages
          const userMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            role: 'user',
            content: 'I have a question about this image. Can you help me understand it?',
            timestamp: new Date().toISOString(),
            type: 'marking_original',
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

          await FirestoreService.createUnifiedSessionWithMessages({
            sessionId: finalSessionId,
            title: 'Marking Session',
            userId: userId,
            messageType: result.isQuestionOnly ? 'Question' : 'Marking',
            messages: [userMessage, aiMessage], // Save both user and AI messages
            isPastPaper: result.isPastPaper || false,
            sessionMetadata: {
              totalProcessingTimeMs: result.metadata?.totalProcessingTimeMs || 0,
              lastModelUsed: model,
              lastApiUsed: result.apiUsed || 'Single-Phase AI Marking System'
            }
          });
          console.log(`✅ [PROCESSOR] Created new session ${finalSessionId} with both user and AI messages for user ${userId}`);
        }
      } catch (error) {
        console.error('❌ [PROCESSOR] Failed to persist to database:', error);
        // Continue without throwing - user still gets response
      }
    }

    return {
      success: true,
      aiMessage,
      sessionId: finalSessionId
    };

  } catch (error) {
    console.error('❌ [PROCESSOR] Processing failed:', error);
    return {
      success: false,
      sessionId: sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      error: error instanceof Error ? error.message : 'Processing failed'
    };
  }
}
