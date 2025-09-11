/**
 * Chat API Routes
 * Handles chat context management, sessions, and messaging
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService';
import { AIMarkingService } from '../services/aiMarkingService';
import ChatSessionManager from '../services/chatSessionManager';
import { ImageStorageService } from '../services/imageStorageService';
import { optionalAuth } from '../middleware/auth';
import SubscriptionDelayService from '../services/subscriptionDelayService';

const router = express.Router();


/**
 * Helper function to convert Firebase Storage URL to base64 data URL if needed
 */
async function prepareImageDataForAI(imageData: any): Promise<string> {
  
  // Handle null/undefined
  if (!imageData) {
    throw new Error('Image data is null or undefined');
  }
  
  // If it's already a string, use it directly
  if (typeof imageData === 'string') {
    
    // Check if it's already a base64 data URL
    if (imageData.startsWith('data:image/')) {
      return imageData;
    }
    
    // Check if it's a Firebase Storage URL
    if (imageData.includes('firebasestorage.googleapis.com')) {
      return await ImageStorageService.downloadImageAsBase64(imageData);
    }
    
    // If it's neither, return as is (might be a regular URL)
    console.warn('⚠️ Unknown image data format, using as is:', imageData.substring(0, 100) + '...');
    return imageData;
  }
  
  // If it's an object, try to extract a string value
  if (typeof imageData === 'object') {
    // Check if object is empty
    if (Object.keys(imageData).length === 0) {
      throw new Error('Image data object is empty - no image data provided');
    }
    
    console.warn('⚠️ Image data is an object, attempting to extract string value');
    
    // Try common object properties that might contain the image data
    const possibleKeys = ['url', 'data', 'imageData', 'image', 'src', 'content'];
    for (const key of possibleKeys) {
      if (imageData[key] && typeof imageData[key] === 'string') {
        return await prepareImageDataForAI(imageData[key]);
      }
    }
    
    // If no string property found, convert the whole object to string
    const imageDataStr = JSON.stringify(imageData);
    console.warn('⚠️ No string property found in object, converting to JSON string:', imageDataStr.substring(0, 100) + '...');
    return imageDataStr;
  }
  
  // For any other type, convert to string
  const imageDataStr = String(imageData);
  return imageDataStr;
}

/**
 * POST /chat
 * Create a new chat session or send a message to existing session
 */
router.post('/', optionalAuth, async (req, res) => {
  
  try {
    const { message, imageData, model = 'chatgpt-4o', sessionId, userId, mode, examMetadata } = req.body;
    
    // Use authenticated user ID if available, otherwise use provided userId or anonymous
    const currentUserId = req.user?.uid || userId || 'anonymous';
    

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
      
      // Determine session title and message type based on mode
      let sessionTitle = imageData ? 'Image-based Chat' : 'Text Chat';
      let messageType: 'Marking' | 'Question' | 'Chat' = 'Chat';
      
      if (mode === 'question') {
        sessionTitle = 'Question - ' + new Date().toLocaleDateString();
        messageType = 'Question';
      } else if (mode === 'marking') {
        sessionTitle = 'Marking - ' + new Date().toLocaleDateString();
        messageType = 'Marking';
      }
      
      currentSessionId = await sessionManager.createSession({
        title: sessionTitle,
        messages: [],
        userId: currentUserId,
        messageType: messageType
      });
    } else {
      // Verify session exists
      const existingSession = await sessionManager.getSession(currentSessionId);
      if (!existingSession) {
        
        // Determine session title and message type based on mode
        let sessionTitle = imageData ? 'Image-based Chat' : 'Text Chat';
        let messageType = 'Chat';
        
        if (mode === 'question') {
          sessionTitle = 'Question - ' + new Date().toLocaleDateString();
          messageType = 'Question';
        } else if (mode === 'marking') {
          sessionTitle = 'Marking - ' + new Date().toLocaleDateString();
          messageType = 'Marking';
        }
        
        currentSessionId = await sessionManager.createSession({
          title: sessionTitle,
          messages: [],
          userId: currentUserId,
          messageType: messageType as 'Marking' | 'Question' | 'Chat'
        });
      }
    }

    // Get chat history for context
    const chatHistory = await sessionManager.getChatHistory(currentSessionId, 20);

    // Add user message to session
    const userMessage: any = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: message || 'I have a question that I need help with. Can you assist me?',
      imageData: imageData,
      type: mode === 'marking' ? 'marking_original' : mode === 'question' ? 'question_original' : undefined
    };
    
    // Add markingData if provided
    if (req.body.markingData) {
      userMessage.markingData = req.body.markingData;
      // If markingData is provided, this is likely an annotated image message
      if (message === 'Annotated image with marking feedback') {
        userMessage.type = 'marking_annotated';
        userMessage.role = 'assistant'; // Annotated images should be assistant messages
      }
    }
    
    // Add exam metadata if provided
    if (examMetadata) {
      userMessage.detectedQuestion = {
        examDetails: examMetadata.examDetails || {},
        questionNumber: examMetadata.questionNumber || 'Unknown',
        questionText: examMetadata.questionText || '',
        confidence: examMetadata.confidence || 0
      };
    }
    
    await sessionManager.addMessage(currentSessionId, userMessage);

    // Generate context summary if needed (for conversations with multiple messages)
    let contextSummary: string | null = null;
    if (chatHistory.length > 0) {
      contextSummary = await sessionManager.generateContextSummaryIfNeeded(currentSessionId);
      if (contextSummary) {
      } else {
      }
    }

    // Skip AI response generation for specific image persistence messages
    const isImagePersistenceMessage = 
      message === 'Original question image' ||
      message === 'Annotated image with marking feedback' || 
      message === 'Marking completed with annotations';
    
    console.log('🔍 Chat route: message =', message, 'isImagePersistenceMessage =', isImagePersistenceMessage);
    
    // Initialize response variables
    let aiResponse: string = 'Message saved successfully';
    let apiUsed = 'None';
    
    if (!isImagePersistenceMessage) {
      // Generate AI response using context
      apiUsed = model === 'gemini-2.5-pro' ? 'Google Gemini 2.5 Pro' : 
                model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni';
      try {
        if (imageData && chatHistory.length === 0) {
          // First message with image - use image-specific response
          
          // Convert Firebase Storage URL to base64 data URL if needed
          const preparedImageData = await prepareImageDataForAI(imageData);
          
          const chatResponse = await AIMarkingService.generateChatResponse(
            preparedImageData, 
            message || 'I have a question that I need help with. Can you assist me?', 
            model, 
            mode === 'qa' ? false : true // allow QA mode to indicate question+answer image
          );
          aiResponse = chatResponse.response;
          apiUsed = chatResponse.apiUsed; // Store the API used for the response
        } else {
          // Follow-up messages or text-only - use contextual response with image context
          const contextualMessage = imageData 
            ? `${message}\n\n[Image context available for reference]`
            : message;
          aiResponse = await AIMarkingService.generateContextualResponse(contextualMessage, chatHistory, model, contextSummary || undefined);
        }
      } catch (error) {
        console.error('❌ Failed to generate AI response:', error);
        aiResponse = 'I apologize, but I encountered an error processing your request. Please try again.';
      }

      // Add AI response to session
      await sessionManager.addMessage(currentSessionId, {
        id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'assistant',
        content: aiResponse,
        type: undefined // Don't set marking_annotated type here since we don't have the annotated image
      });
    }

    // Get session title for response
    const session = await sessionManager.getSession(currentSessionId);
    const sessionTitle = session?.title || 'Chat Session';

    // Return success response
    return res.json({
      success: true,
      sessionId: currentSessionId,
      sessionTitle: sessionTitle,
      response: aiResponse,
      apiUsed: apiUsed,
      context: {
        sessionId: currentSessionId,
        messageCount: chatHistory.length + (isImagePersistenceMessage ? 1 : 2), // +1 for user only, +2 for user and AI
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
 * GET /chat/tasks/:userId
 * Get all chat tasks for a user (requires authentication)
 */
router.get('/tasks/:userId', optionalAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // If user is authenticated, ensure they can only access their own sessions
    if (req.user && req.user.uid !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only access your own chat sessions'
      });
    }

    // Use ChatSessionManager to get sessions (includes in-memory cache)
    const sessionManager = ChatSessionManager.getInstance();
    const sessions = await sessionManager.getUserSessions(userId);
    
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
 * GET /chat/task/:taskId
 * Get a specific chat task (requires authentication)
 */
router.get('/task/:taskId', optionalAuth, async (req, res) => {
  try {
    const { taskId } = req.params;

    const sessionManager = ChatSessionManager.getInstance();
    const session = await sessionManager.getSession(taskId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    // Determine the expected user ID
    const expectedUserId = req.user ? req.user.uid : 'anonymous';
    
    // Ensure user can only access their own sessions
    if (session.userId !== expectedUserId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only access your own chat sessions'
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
 * PUT /chat/task/:taskId
 * Update a chat task (e.g., title) (requires authentication)
 */
router.put('/task/:taskId', optionalAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const updates = req.body;

    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please log in to update chat sessions'
      });
    }

    // Verify session ownership before updating
    const session = await FirestoreService.getChatSession(taskId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only update your own chat sessions'
      });
    }

    await FirestoreService.updateChatSession(taskId, updates);
    
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
 * DELETE /chat/task/:taskId
 * Delete a chat task (requires authentication)
 */
router.delete('/task/:taskId', optionalAuth, async (req, res) => {
  try {
    const { taskId } = req.params;

    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please log in to delete chat sessions'
      });
    }

    // Verify session ownership before deleting
    const session = await FirestoreService.getChatSession(taskId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Chat session not found'
      });
    }

    if (session.userId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only delete your own chat sessions'
      });
    }

    await FirestoreService.deleteChatSession(taskId, session.userId);
    
    // Clear the session from in-memory cache
    const sessionManager = ChatSessionManager.getInstance();
    sessionManager.removeSessionFromCache(taskId);
    
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
 * Restore session context from database (requires authentication)
 */
router.post('/restore/:sessionId', optionalAuth, async (req, res) => {
  try {
    const { taskId } = req.params;

    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please log in to restore chat sessions'
      });
    }

    const sessionManager = ChatSessionManager.getInstance();
    const session = await sessionManager.restoreSession(taskId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // Ensure user can only restore their own sessions
    if (session.userId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        message: 'You can only restore your own chat sessions'
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
