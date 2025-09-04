/**
 * Chat API Routes
 * Handles chat context management, sessions, and messaging
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService';
import { AIMarkingService } from '../services/aiMarkingService';
import ChatSessionManager from '../services/chatSessionManager';

const router = express.Router();

console.log('🚀 CHAT ROUTE MODULE LOADED SUCCESSFULLY');

/**
 * POST /chat
 * Create a new chat session or send a message to existing session
 */
router.post('/', async (req, res) => {
  console.log('🚀 ===== CHAT ROUTE CALLED =====');
  
  try {
    const { message, imageData, model = 'chatgpt-4o', sessionId, userId, mode } = req.body;
    
    console.log('🔍 Request data:', { 
      hasMessage: !!message, 
      hasImage: !!imageData, 
      model, 
      sessionId, 
      userId,
      mode
    });

    // Validate request
    if (!message && !imageData) {
      return res.status(400).json({
        success: false,
        error: 'Message or image data is required'
      });
    }

    let currentSessionId = sessionId;
    const sessionManager = ChatSessionManager.getInstance();

    // Create or use existing session
    if (!currentSessionId) {
      console.log('📝 Creating new chat session');
      currentSessionId = await sessionManager.createSession({
        title: imageData ? 'Image-based Chat' : 'Text Chat',
        messages: [],
        userId: userId || 'anonymous'
      });
      console.log('📝 Created new session:', currentSessionId);
    } else {
      // Verify session exists
      const existingSession = await sessionManager.getSession(currentSessionId);
      if (!existingSession) {
        console.log('📝 Session not found, creating new one');
        currentSessionId = await sessionManager.createSession({
          title: imageData ? 'Image-based Chat' : 'Text Chat',
          messages: [],
          userId: userId || 'anonymous'
        });
      }
    }

    // Get chat history for context
    const chatHistory = await sessionManager.getChatHistory(currentSessionId, 20);
    console.log('📝 Retrieved chat history:', chatHistory.length, 'messages');

    // Add user message to session
    await sessionManager.addMessage(currentSessionId, {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: message || 'I have a question that I need help with. Can you assist me?',
      imageData: imageData
    });

    // Generate context summary if needed (for conversations with multiple messages)
    let contextSummary: string | null = null;
    if (chatHistory.length > 0) {
      console.log('🔍 Checking if context summary is needed...');
      contextSummary = await sessionManager.generateContextSummaryIfNeeded(currentSessionId);
      if (contextSummary) {
        console.log('📝 Using context summary for response');
      } else {
        console.log('📝 No summary needed, using recent messages');
      }
    }

    // Generate AI response using context
    let aiResponse: string;
    let apiUsed = model === 'gemini-2.5-pro' ? 'Google Gemini 2.5 Pro' : 
                  model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni';
    try {
      if (imageData && chatHistory.length === 0) {
        // First message with image - use image-specific response
        console.log('🔍 Processing initial image with AI for chat response');
        const chatResponse = await AIMarkingService.generateChatResponse(
          imageData, 
          message || 'I have a question that I need help with. Can you assist me?', 
          model, 
          mode === 'qa' ? false : true // allow QA mode to indicate question+answer image
        );
        aiResponse = chatResponse.response;
        apiUsed = chatResponse.apiUsed; // Store the API used for the response
        console.log('✅ AI chat response generated successfully');
      } else {
        // Follow-up messages or text-only - use contextual response with image context
        console.log('🔍 Processing follow-up message with context');
        const contextualMessage = imageData 
          ? `${message}\n\n[Image context available for reference]`
          : message;
        aiResponse = await AIMarkingService.generateContextualResponse(contextualMessage, chatHistory, model, contextSummary || undefined);
        console.log('✅ AI contextual response generated successfully');
      }
    } catch (error) {
      console.error('❌ Failed to generate AI response:', error);
      aiResponse = 'I apologize, but I encountered an error processing your request. Please try again.';
    }

    // Add AI response to session
    await sessionManager.addMessage(currentSessionId, {
      id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'assistant',
      content: aiResponse
    });
    console.log('📝 Added AI response to session');

    // Return success response
    return res.json({
      success: true,
      sessionId: currentSessionId,
      response: aiResponse,
      apiUsed: apiUsed,
      context: {
        sessionId: currentSessionId,
        messageCount: chatHistory.length + 2, // +2 for user and AI messages
        hasImage: !!imageData,
        hasContext: chatHistory.length > 0,
        usingSummary: !!contextSummary,
        summaryLength: contextSummary ? contextSummary.length : 0
      }
    });

  } catch (error) {
    console.error('Chat route error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /chat/sessions/:userId
 * Get all chat sessions for a user
 */
router.get('/sessions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('🔍 Getting chat sessions for user:', userId);

    const sessions = await FirestoreService.getChatSessions(userId);
    
    return res.json({
      success: true,
      sessions: sessions || []
    });
  } catch (error) {
    console.error('Failed to get chat sessions:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat sessions'
    });
  }
});

/**
 * GET /chat/session/:sessionId
 * Get a specific chat session
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('🔍 Getting chat session:', sessionId);

    const session = await FirestoreService.getChatSession(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    return res.json({
      success: true,
      session
    });
  } catch (error) {
    console.error('Failed to get chat session:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve chat session'
    });
  }
});

/**
 * PUT /chat/session/:sessionId
 * Update a chat session (e.g., title)
 */
router.put('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const updates = req.body;
    console.log('🔍 Updating chat session:', sessionId, updates);

    await FirestoreService.updateChatSession(sessionId, updates);
    
    return res.json({
      success: true,
      message: 'Session updated successfully'
    });
  } catch (error) {
    console.error('Failed to update chat session:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update chat session'
    });
  }
});

/**
 * DELETE /chat/session/:sessionId
 * Delete a chat session
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('🔍 Deleting chat session:', sessionId);

    await FirestoreService.deleteChatSession(sessionId);
    
    return res.json({
      success: true,
      message: 'Session deleted successfully'
    });
  } catch (error) {
    console.error('Failed to delete chat session:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete chat session'
    });
  }
});

/**
 * GET /chat/status
 * Get chat service status
 */
router.get('/status', (_req, res) => {
  try {
    const status = {
      service: 'Chat Context API',
      status: 'operational (full context mode)',
      timestamp: new Date().toISOString(),
      features: [
        'Full conversation context management',
        'Image and text message support',
        'Multi-model AI integration',
        'Persistent session management',
        'Smart context recovery',
        'In-memory caching with periodic persistence'
      ],
      supportedModels: ['chatgpt-4o', 'chatgpt-5', 'gemini-2.5-pro'],
      cache: {
        activeSessions: 0,
        pendingMessages: 0,
        memoryUsage: '0 KB'
      }
    };
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ 
      service: 'Chat Context API',
      status: 'error',
      error: 'Failed to get status' 
    });
  }
});

/**
 * POST /chat/restore/:sessionId
 * Restore session context from database
 */
router.post('/restore/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log('🔄 Restoring session context:', sessionId);

    const sessionManager = ChatSessionManager.getInstance();
    const session = await sessionManager.restoreSession(sessionId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    return res.json({
      success: true,
      session: session
    });
  } catch (error) {
    console.error('Failed to restore session:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to restore session context'
    });
  }
});

/**
 * GET /chat/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', (_req, res) => {
  try {
    const sessionManager = ChatSessionManager.getInstance();
    const stats = sessionManager.getCacheStats();
    
    res.json({
      success: true,
      stats: {
        ...stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache statistics'
    });
  }
});

/**
 * POST /chat/cache/clear
 * Clear all cached sessions (admin only)
 */
router.post('/cache/clear', (_req, res) => {
  try {
    const sessionManager = ChatSessionManager.getInstance();
    sessionManager.cleanup();
    
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache'
    });
  }
});

export default router;
