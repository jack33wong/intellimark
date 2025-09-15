/**
 * Messages API Routes - UnifiedMessage System
 * Single source of truth for all chat, marking, and question data
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService';
import { optionalAuth, requireAuth } from '../middleware/auth';
import { AIMarkingService } from '../services/aiMarkingService';
import type { UnifiedMessage } from '../types';

const router = express.Router();

/**
 * POST /messages/chat
 * Unified chat endpoint - handles conversational flow with session management - REQUIRES AUTHENTICATION
 */
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, imageData, model = 'chatgpt-4o', sessionId, mode } = req.body;
    
    // Use authenticated user ID
    const userId = req.user.uid;
    
    // Validate required fields
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    let currentSessionId = sessionId;
    let sessionTitle = 'Chat Session';


    // Session management - only for authenticated users
    if (!currentSessionId) {
      // Create a real session in unifiedSessions for authenticated users
      const userMessage = {
        messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'user',
        content: message,
        type: 'chat_user',
        timestamp: new Date().toISOString(),
        imageLink: imageData || undefined,
        detectedQuestion: { found: false, message: 'Chat message' },
        metadata: {
          resultId: `chat-${Date.now()}`,
          processingTime: new Date().toISOString(),
          totalProcessingTimeMs: 0,
          modelUsed: model,
          totalAnnotations: 0,
          imageSize: 0,
          confidence: 0,
          tokens: [0, 0],
          ocrMethod: 'Chat'
        }
      };

      const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      currentSessionId = await FirestoreService.createUnifiedSessionWithMessages({
        sessionId: newSessionId,
        title: sessionTitle,
        userId: userId,
        messageType: 'Chat',
        messages: [userMessage]
      });
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
        // For text-only messages, use contextual response
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
            console.log('No existing session found for context, proceeding with empty history');
          }
        }

        aiResponse = await AIMarkingService.generateContextualResponse(message, chatHistory, model as any);
        apiUsed = model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni';
      }
    } catch (error) {
      console.error('❌ AI service failed, using fallback response:', error);
      aiResponse = "I'm here to help with your questions! However, I'm experiencing some technical difficulties right now. Could you please try again?";
      apiUsed = 'Fallback';
    }

    // Create AI message
    const aiMessage = {
      messageId: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant' as const,
      content: aiResponse,
      type: 'chat_assistant' as const,
      timestamp: new Date().toISOString(),
      detectedQuestion: { found: false, message: 'AI response' },
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

    // Handle session creation and message storage
    if (!sessionId) {
      // Creating new session - add AI message
      await FirestoreService.addMessageToUnifiedSession(currentSessionId, aiMessage);
    } else {
      // Adding to existing session - always save if session exists
        const userMessage = {
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          role: 'user' as const,
          content: message,
          type: 'chat_user' as const,
          timestamp: new Date().toISOString(),
          imageLink: imageData || undefined,
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

        try {
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, userMessage);
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, aiMessage);
        } catch (error) {
          console.error(`❌ Failed to add messages to session ${currentSessionId}:`, error);
          // This is a critical error - the session should exist but doesn't
          throw error; // Re-throw to prevent silent failures
        }
    }

    // Get session data for response
    let sessionData;
    
    // Try to load existing session if sessionId was provided
    if (sessionId) {
      try {
        sessionData = await FirestoreService.getUnifiedSession(currentSessionId);
      } catch (error) {
        console.error(`❌ Failed to load session ${currentSessionId}:`, error);
        sessionData = null;
      }
    }
    
    // Load session data for response
    if (!sessionData) {
      try {
        sessionData = await FirestoreService.getUnifiedSession(currentSessionId);
      } catch (error) {
        console.error(`❌ Failed to load session ${currentSessionId}:`, error);
        return res.status(500).json({
          success: false,
          error: 'Failed to load session data'
        });
      }
    }
    
    res.json({
      success: true,
      session: sessionData,
      sessionId: currentSessionId,
      sessionTitle: sessionTitle,
      response: aiResponse,
      apiUsed: apiUsed,
      context: {
        sessionId: currentSessionId,
        messageCount: 2,
        hasImage: !!imageData,
        hasContext: false,
        usingSummary: false,
        summaryLength: 0
      }
    });

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
router.post('/', requireAuth, async (req, res) => {
  try {
    const messageData = req.body;
    
    // Use authenticated user ID
    const userId = req.user.uid;
    
    // Validate required fields
    if (!messageData.id || !messageData.sessionId || !messageData.role || !messageData.content) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: id, sessionId, role, content'
      });
    }

    // For individual message creation, we'll create a single-message session
    const sessionId = messageData.sessionId || `single-msg-${Date.now()}`;
    
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
router.get('/session/:sessionId', requireAuth, async (req, res) => {
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
        error: 'Access denied - can only access your own sessions'
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
router.post('/batch', requireAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array is required'
      });
    }

    // Use authenticated user ID
    const userId = req.user.uid;
    
    // Create session with all messages using batch creation
    const sessionId = messages[0]?.sessionId || `batch-session-${Date.now()}`;
    
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
