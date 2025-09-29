/**
 * Messages API Routes - UnifiedMessage System
 * Single source of truth for all chat, marking, and question data
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { AIMarkingService } from '../services/aiMarkingService.js';
import type { UnifiedMessage } from '../types/index.js';

const router = express.Router();

/**
 * POST /messages/chat
 * Unified chat endpoint - handles conversational flow with session management
 * Supports both authenticated and anonymous users
 */
router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message, imageData, model = 'auto', sessionId, mode } = req.body;
    
    // Use authenticated user ID or anonymous
    const userId = req.user?.uid || 'anonymous';
    const isAuthenticated = !!req.user?.uid;
    
    // Validate required fields - allow empty message if imageData is provided
    if ((!message || typeof message !== 'string') && !imageData) {
      return res.status(400).json({
        success: false,
        error: 'Message or image data is required'
      });
    }

    // Upload image to Firebase Storage if imageData is provided
    let imageLink = null;
    if (imageData && isAuthenticated) {
      try {
        const { ImageStorageService } = await import('../services/imageStorageService');
        imageLink = await ImageStorageService.uploadImage(
          imageData,
          userId,
          sessionId || `temp-${Date.now()}`,
          'original'
        );
      } catch (error) {
        console.error('❌ Failed to upload follow-up image:', error);
        // Continue without imageLink for unauthenticated users
      }
    }

    let currentSessionId = sessionId;
    let sessionTitle = 'Chat Session';

    // Create user message (needed for both new and existing sessions)
    const userMessage = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: message || (imageData ? 'Image uploaded' : ''),
      type: 'chat_user',
      timestamp: new Date().toISOString(),
      imageLink: imageLink || (isAuthenticated ? undefined : imageData),
      detectedQuestion: { found: false, message: message || 'Chat message' },
      metadata: {
        resultId: `chat-${Date.now()}`,
        processingTime: new Date().toISOString(),
        totalProcessingTimeMs: 0,
        modelUsed: model,
        totalAnnotations: 0,
        imageSize: imageData ? imageData.length : 0,
        confidence: 0,
        tokens: [0, 0],
        ocrMethod: 'Chat'
      }
    };

    // Session management - use provided sessionId or create new one
    if (!currentSessionId) {
      // Create a real session in unifiedSessions for authenticated users only

      if (isAuthenticated) {
        const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        // Create session with user message - both frontend and backend need it
        currentSessionId = await FirestoreService.createUnifiedSessionWithMessages({
          sessionId: newSessionId,
          title: sessionTitle,
          userId: userId,
          messageType: 'Chat',
          messages: [userMessage] // Include user message in database
        });
      } else {
        // For anonymous users, use provided sessionId or create a temporary one
        currentSessionId = sessionId || `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
    }

    // Generate AI response using real AI service
    let aiResponse: string;
    let apiUsed: string;
    
    try {
      if (imageData) {
        // For messages with images, use image-aware chat response
        const aiResult = await AIMarkingService.generateChatResponse(imageData, message, model as any, true);
        aiResponse = aiResult.response;
        apiUsed = aiResult.apiUsed;
      } else {
        // For text-only messages, use contextual response with progress tracking
        // First get existing session messages for context
        let chatHistory: any[] = [];
        if (currentSessionId) {
          try {
            const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
            if (existingSession?.messages) {
              chatHistory = existingSession.messages.map(msg => ({
                role: msg.role,
                content: msg.content
              }));
            }
          } catch (error) {
          }
        }

        // Simulate processing time for "Processing your question..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        aiResponse = await AIMarkingService.generateContextualResponse(message, chatHistory, model as any);
        apiUsed = 'Gemini 2.5 Pro';
      }
    } catch (error) {
      console.error('❌ AI service failed, using fallback response:', error);
      aiResponse = "I'm here to help with your questions! However, I'm experiencing some technical difficulties right now. Could you please try again?";
      apiUsed = 'Fallback';
    }

    // Create AI message with progressData for text-only submissions
    const aiMessage = {
      messageId: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant' as const,
      content: aiResponse,
      type: 'chat_assistant' as const,
      timestamp: new Date().toISOString(),
      detectedQuestion: { found: false, message: 'AI response' },
      isProcessing: false, // Mark as completed since this is the final response
      progressData: {
        allSteps: [
          'Processing your question...',
          'Generating response...'
        ],
        currentStepDescription: 'Generating response...', // Show final step
        completedSteps: ['Processing your question...', 'Generating response...'],
        isComplete: true
      },
      metadata: {
        resultId: `chat-ai-${Date.now()}`,
        processingTime: new Date().toISOString(),
        totalProcessingTimeMs: 0,
        modelUsed: model,
        totalAnnotations: 0,
        imageSize: imageData ? imageData.length : 0,
        confidence: 0,
        tokens: [0, 0],
        ocrMethod: 'Chat'
      }
    };

    // Handle session creation and message storage - only for authenticated users
    if (isAuthenticated) {
      if (!sessionId || sessionId.startsWith('temp-')) {
        // Creating new session - create session with both user and AI messages
        await FirestoreService.createUnifiedSessionWithMessages({
          sessionId: currentSessionId,
          title: sessionTitle,
          userId: userId,
          messageType: 'Chat',
          messages: [userMessage, aiMessage]
        });
      } else {
        // Adding to existing session - add both user and AI messages
        // User message needs to be persisted for follow-up messages
        try {
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, userMessage);
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, aiMessage);
        } catch (error) {
          console.error(`❌ Failed to add messages to session ${currentSessionId}:`, error);
          // This is a critical error - the session should exist but doesn't
          throw error; // Re-throw to prevent silent failures
        }
      }
    }

    // Get session data for response
    let sessionData;
    
    if (isAuthenticated) {
      // Load session data for response
      try {
        sessionData = await FirestoreService.getUnifiedSession(currentSessionId);
      } catch (error) {
        console.error(`❌ Failed to load session ${currentSessionId}:`, error);
        return res.status(500).json({
          success: false,
          error: 'Failed to load session data'
        });
      }
    } else {
      // For anonymous users, return only new messages (frontend maintains history)
      const userMessage = {
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'user' as const,
        content: message,
        type: 'chat_user' as const,
        timestamp: new Date().toISOString(),
        imageLink: imageLink || (isAuthenticated ? undefined : imageData),
        detectedQuestion: { found: false, message: 'Chat message' },
        metadata: {
          resultId: `chat-${Date.now()}`,
          processingTime: new Date().toISOString(),
          totalProcessingTimeMs: 0,
          modelUsed: model,
          totalAnnotations: 0,
          imageSize: imageData ? imageData.length : 0,
          confidence: 0,
          tokens: [0, 0],
          ocrMethod: 'Chat'
        }
      };

      // For anonymous users, return only new messages for frontend to append
      sessionData = {
        id: currentSessionId,
        title: sessionTitle,
        userId: userId,
        messageType: 'Chat',
        messages: [userMessage, aiMessage], // Only new messages
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPastPaper: false
      };
      
    }
    
    // Return consistent response format (same as process-single)
    if (isAuthenticated) {
      // Authenticated users get complete session (user message already in database)
      res.json({
        success: true,
        aiMessage: aiMessage,
        sessionId: currentSessionId,
        unifiedSession: sessionData
      });
    } else {
      // Anonymous users get only new messages for frontend to append
      res.json({
        success: true,
        newMessages: sessionData.messages, // Only new messages
        sessionId: currentSessionId,
        sessionTitle: sessionTitle
      });
    }

  } catch (error) {
    console.error('❌ Chat endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /messages
 * Create a new message (low-level API) - REQUIRES AUTHENTICATION
 */
router.post('/', optionalAuth, async (req, res) => {
  try {
    const messageData = req.body;
    
    // Use authenticated user ID or anonymous
    const userId = req.user?.uid || 'anonymous';
    const isAuthenticated = !!req.user?.uid;
    
    // Validate required fields
    if (!messageData.id || !messageData.sessionId || !messageData.role || !messageData.content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, sessionId, role, content'
      });
    }

    // For individual message creation, we'll create a single-message session
    const sessionId = messageData.sessionId || `single-msg-${Date.now()}`;
    
    if (isAuthenticated) {
      const sessionId_result = await FirestoreService.createUnifiedSessionWithMessages({
        sessionId: sessionId,
        title: `Single Message - ${new Date().toLocaleDateString()}`,
        userId: userId,
        messageType: 'Chat',
        messages: [messageData]
      });

      return res.json({
        success: true,
        sessionId: sessionId_result,
        message: 'Message saved successfully'
      });
    } else {
      return res.json({
        success: true,
        sessionId: sessionId,
        message: 'Message processed (not saved - anonymous user)'
      });
    }
  } catch (error) {
    console.error('Failed to save message:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save message'
    });
  }
});

/**
 * GET /messages/session/:sessionId
 * Get UnifiedSession with all messages (parent-child structure) - REQUIRES AUTHENTICATION
 */
router.get('/session/:sessionId', optionalAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await FirestoreService.getUnifiedSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    return res.json({
      success: true,
      session,
      sessionId,
      messages: session.messages,
      messageCount: session.messages.length
    });
  } catch (error) {
    console.error('Failed to get UnifiedSession:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /messages/sessions/:userId
 * Get user's UnifiedSessions (lightweight list) - REQUIRES AUTHENTICATION
 */
router.get('/sessions/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;


    // Only return sessions for authenticated users who match the requested userId
    if (req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - can only access your own sessions',
        details: `Requested: ${userId}, Authenticated: ${req.user.uid}`
      });
    }

    const sessions = await FirestoreService.getUserUnifiedSessions(userId, limit);

    return res.json({
      success: true,
      sessions,
      count: sessions.length
    });
  } catch (error) {
    console.error('Failed to get user UnifiedSessions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve user sessions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /messages/batch
 * Save multiple messages at once (for session creation) - REQUIRES AUTHENTICATION
 */
router.post('/batch', optionalAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array is required'
      });
    }

    // Use authenticated user ID or anonymous
    const userId = req.user?.uid || 'anonymous';
    const isAuthenticated = !!req.user?.uid;
    
    // Create session with all messages using batch creation
    const sessionId = messages[0]?.sessionId || `batch-session-${Date.now()}`;
    
    if (isAuthenticated) {
      const sessionId_result = await FirestoreService.createUnifiedSessionWithMessages({
        sessionId: sessionId,
        title: `Batch Session - ${new Date().toLocaleDateString()}`,
        userId: userId,
        messageType: 'Chat',
        messages: messages
      });

      return res.json({
        success: true,
        sessionId: sessionId_result,
        count: messages.length,
        savedSessionId: sessionId_result
      });
    } else {
      return res.json({
        success: true,
        sessionId: sessionId,
        count: messages.length,
        message: 'Messages processed (not saved - anonymous user)'
      });
    }
  } catch (error) {
    console.error('Failed to save message batch:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to save messages'
    });
  }
});

/**
 * DELETE /messages/session/:sessionId
 * Delete a UnifiedSession - REQUIRES AUTHENTICATION
 */
router.delete('/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;


    // Verify session exists and get ownership info
    const session = await FirestoreService.getUnifiedSession(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // Verify ownership before deleting
    if (session.userId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only delete your own sessions'
      });
    }

    // Delete the UnifiedSession
    await FirestoreService.deleteUnifiedSession(sessionId, session.userId);
    
    return res.json({
      success: true,
      message: 'Session deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete UnifiedSession:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete session',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /messages/session/:sessionId
 * Update session metadata (favorite, rating, title) - REQUIRES AUTHENTICATION
 */
router.put('/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updates = req.body;

    // Update the session
    await FirestoreService.updateUnifiedSession(sessionId, updates);

    res.json({
      success: true,
      message: 'Session updated successfully'
    });
  } catch (error) {
    console.error('❌ Update session error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update session'
    });
  }
});

/**
 * GET /messages/stats
 * Get basic statistics about messages
 */
router.get('/stats', optionalAuth, async (req, res) => {
  try {
    // This would be implemented based on your analytics needs
    return res.json({
      success: true,
      stats: {
        message: 'Stats endpoint - to be implemented'
      }
    });
  } catch (error) {
    console.error('Failed to get message stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve message statistics'
    });
  }
});

export default router;
