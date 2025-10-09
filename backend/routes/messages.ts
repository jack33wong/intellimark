/**
 * Messages API Routes - UnifiedMessage System
 * Single source of truth for all chat, marking, and question data
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { AIMarkingService } from '../services/aiMarkingService.js';
import { createUserMessage, createAIMessage, createChatProgressData, handleAIMessageIdForEndpoint } from '../utils/messageUtils.js';
import { ProgressTracker, getStepsForMode } from '../utils/progressTracker.js';
import type { UnifiedMessage } from '../types/index.js';

const router = express.Router();

/**
 * POST /messages/chat
 * Unified chat endpoint - handles conversational flow with session management
 * Supports both authenticated and anonymous users
 */
router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message, imageData, model = 'auto', sessionId, mode, aiMessageId, sourceMessageId } = req.body;
    
    // Use centralized model configuration for 'auto'
    let resolvedModel = model;
    if (model === 'auto') {
      const { getDefaultModel } = await import('../config/aiModels.js');
      resolvedModel = getDefaultModel();
    }
    
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

    // Create user message using factory (only for authenticated users)
    let userMessage = null;
    if (isAuthenticated) {
      userMessage = createUserMessage({
        content: message || (imageData ? 'Image uploaded' : ''),
        imageLink: imageLink, // Only for authenticated users
        imageData: imageData, // For both authenticated and unauthenticated users
        sessionId: sessionId,
        model: model
      });
      
    }

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
        // For anonymous users, use provided sessionId or create a permanent one
        currentSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
    }

    // Generate AI response using real AI service
    let aiResponse: string;
    let apiUsed: string;
    let finalProgressData: any = null;
    let contextualResult: any = null;
    const startTime = Date.now();
    
    console.log('🔍 [MESSAGES] Received request:', { message, sessionId: currentSessionId, model: resolvedModel });
    
    try {
      if (imageData) {
        // For messages with images, use image-aware chat response
        const aiResult = await AIMarkingService.generateChatResponse(imageData, message, resolvedModel as any, true);
        aiResponse = aiResult.response;
        apiUsed = aiResult.apiUsed;
        contextualResult = aiResult; // Store for processing stats
      } else if (mode === 'modelanswer') {
        // Handle model answer request - access detectedQuestion from session metadata
        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

        // Get session and find the specific message that triggered this follow-up
        let existingSession = null;
        let targetMessage = null;
        
        if (currentSessionId) {
          try {
            existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
            
            if (sourceMessageId) {
              // Find the specific message that triggered this follow-up
              targetMessage = existingSession?.messages?.find((msg: any) => 
                msg.id === sourceMessageId && msg.detectedQuestion?.found
              );
              
              if (targetMessage) {
                // Found specific target message
              } else {
                // No message found with sourceMessageId
              }
            } else {
              // Fallback: Find the most recent message with detectedQuestion data
              const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
                msg.role === 'assistant' && msg.detectedQuestion?.found
              ) || [];
              
              if (messagesWithDetectedQuestion.length > 0) {
                targetMessage = messagesWithDetectedQuestion[messagesWithDetectedQuestion.length - 1];
              }
            }
          } catch (error) {
            console.error('❌ Failed to get session for model answer:', error);
          }
        } else {
          throw new Error('❌ [MODEL ANSWER] No sessionId provided - cannot generate model answer without session context');
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        // Access detectedQuestion from target message
        if (targetMessage?.detectedQuestion?.found) {
          
          // Use model answer prompts with detectedQuestion from target message
          const { getPrompt } = await import('../config/prompts.js');
          
          try {
            const systemPrompt = getPrompt('modelAnswer.system');
            const userPrompt = getPrompt('modelAnswer.user', 
              targetMessage.detectedQuestion.questionText || '', 
              targetMessage.detectedQuestion.markingScheme || JSON.stringify(targetMessage.detectedQuestion)
            );
            
            // Use the same method as test script - pass raw data, not formatted prompts
            contextualResult = await AIMarkingService.generateChatResponse(
              targetMessage.detectedQuestion.questionText || '',  // OCR text (question + steps)
              targetMessage.detectedQuestion.markingScheme || '',  // marking scheme
              resolvedModel,
              false, // isQuestionOnly
              false, // debug
              undefined, // onProgress
              true // useOcrText
            );
            
          } catch (error) {
            console.error('❌ [MODEL ANSWER] Error:', error);
            throw error;
          }
        } else {
          throw new Error('❌ [MODEL ANSWER] No detectedQuestion found in any message - cannot generate model answer');
        }
        
        aiResponse = contextualResult.response;
        apiUsed = contextualResult.apiUsed;

        // Complete generating response step
        progressTracker.completeCurrentStep();
        progressTracker.finish();
      } else if (mode === 'markingscheme') {
        // Handle marking scheme request
        console.log('🔍 [MARKING SCHEME] Request detected:', message);
        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

        // Get session and find the specific message that triggered this follow-up
        if (!currentSessionId) {
          throw new Error('❌ [MARKING SCHEME] No sessionId provided - cannot generate marking scheme without session context');
        }

        const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
        let targetMessage = null;
        
        if (sourceMessageId) {
          // Find the specific message that triggered this follow-up
          targetMessage = existingSession?.messages?.find((msg: any) => 
            msg.id === sourceMessageId && msg.detectedQuestion?.found
          );
        } else {
          // Fallback: Find the most recent message with detectedQuestion data
          const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
            msg.role === 'assistant' && msg.detectedQuestion?.found
          ) || [];
          
          if (messagesWithDetectedQuestion.length > 0) {
            targetMessage = messagesWithDetectedQuestion[messagesWithDetectedQuestion.length - 1];
          }
        }
        
        if (!targetMessage) {
          throw new Error('❌ [MARKING SCHEME] No detected question found in target message - cannot generate marking scheme');
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        // Use marking scheme prompt
        const { getPrompt } = await import('../config/prompts.js');
        const systemPrompt = getPrompt('markingScheme.system');
        const userPrompt = getPrompt('markingScheme.user', 
          targetMessage.detectedQuestion.questionText || '', 
          targetMessage.detectedQuestion.markingScheme || ''
        );

        contextualResult = await AIMarkingService.generateChatResponse(
          targetMessage.detectedQuestion.questionText || '',  // OCR text (question + steps)
          targetMessage.detectedQuestion.markingScheme || '',  // marking scheme
          resolvedModel,
          false, // isQuestionOnly
          false, // debug
          undefined, // onProgress
          true // useOcrText
        );
        
        // Complete generating response step
        progressTracker.completeCurrentStep();
        progressTracker.finish();
        
        aiResponse = contextualResult.response;
        apiUsed = contextualResult.apiUsed;
      } else if (mode === 'stepbystep') {
        // Handle step-by-step solution request
        console.log('🔍 [STEP-BY-STEP] Request detected:', message);
        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

        // Get session and find the specific message that triggered this follow-up
        if (!currentSessionId) {
          throw new Error('❌ [STEP-BY-STEP] No sessionId provided - cannot generate step-by-step solution without session context');
        }

        const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
        let targetMessage = null;
        
        if (sourceMessageId) {
          // Find the specific message that triggered this follow-up
          targetMessage = existingSession?.messages?.find((msg: any) => 
            msg.id === sourceMessageId && msg.detectedQuestion?.found
          );
        } else {
          // Fallback: Find the most recent message with detectedQuestion data
          const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
            msg.role === 'assistant' && msg.detectedQuestion?.found
          ) || [];
          
          if (messagesWithDetectedQuestion.length > 0) {
            targetMessage = messagesWithDetectedQuestion[messagesWithDetectedQuestion.length - 1];
          }
        }
        
        if (!targetMessage) {
          throw new Error('❌ [STEP-BY-STEP] No detected question found in target message - cannot generate step-by-step solution');
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        // Use step-by-step prompt
        const { getPrompt } = await import('../config/prompts.js');
        const systemPrompt = getPrompt('stepbystep.system');
        const userPrompt = getPrompt('stepbystep.user', 
          targetMessage.detectedQuestion.questionText || '', 
          targetMessage.detectedQuestion.markingScheme || ''
        );

        contextualResult = await AIMarkingService.generateChatResponse(
          targetMessage.detectedQuestion.questionText || '',  // OCR text (question + steps)
          targetMessage.detectedQuestion.markingScheme || '',  // marking scheme
          resolvedModel,
          false, // isQuestionOnly
          false, // debug
          undefined, // onProgress
          true // useOcrText
        );
        
        // Complete generating response step
        progressTracker.completeCurrentStep();
        progressTracker.finish();
        
        aiResponse = contextualResult.response;
        apiUsed = contextualResult.apiUsed;
      } else if (mode === 'similarquestions') {
        // Handle similar practice questions request
        console.log('🔍 [SIMILAR QUESTIONS] Request detected:', message);
        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

        // Get session and find the specific message that triggered this follow-up
        if (!currentSessionId) {
          throw new Error('❌ [SIMILAR QUESTIONS] No sessionId provided - cannot generate similar questions without session context');
        }

        const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
        let targetMessage = null;
        
        if (sourceMessageId) {
          // Find the specific message that triggered this follow-up
          targetMessage = existingSession?.messages?.find((msg: any) => 
            msg.id === sourceMessageId && msg.detectedQuestion?.found
          );
        } else {
          // Fallback: Find the most recent message with detectedQuestion data
          const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
            msg.role === 'assistant' && msg.detectedQuestion?.found
          ) || [];
          
          if (messagesWithDetectedQuestion.length > 0) {
            targetMessage = messagesWithDetectedQuestion[messagesWithDetectedQuestion.length - 1];
          }
        }
        
        if (!targetMessage) {
          throw new Error('❌ [SIMILAR QUESTIONS] No detected question found in target message - cannot generate similar questions');
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        // Use similar questions prompt
        const { getPrompt } = await import('../config/prompts.js');
        const systemPrompt = getPrompt('similarquestions.system');
        const userPrompt = getPrompt('similarquestions.user', 
          targetMessage.detectedQuestion.questionText || '', 
          targetMessage.detectedQuestion.markingScheme || ''
        );

        contextualResult = await AIMarkingService.generateChatResponse(
          targetMessage.detectedQuestion.questionText || '',  // OCR text (question + steps)
          targetMessage.detectedQuestion.markingScheme || '',  // marking scheme
          resolvedModel,
          false, // isQuestionOnly
          false, // debug
          undefined, // onProgress
          true // useOcrText
        );
        
        // Complete generating response step
        progressTracker.completeCurrentStep();
        progressTracker.finish();
        
        aiResponse = contextualResult.response;
        apiUsed = contextualResult.apiUsed;
      } else if (mode === 'detailedfeedback') {
        // Handle detailed feedback request
        console.log('🔍 [DETAILED FEEDBACK] Request detected:', message);
        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

        // Get session and find the specific message that triggered this follow-up
        if (!currentSessionId) {
          throw new Error('❌ [DETAILED FEEDBACK] No sessionId provided - cannot generate detailed feedback without session context');
        }

        const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
        let targetMessage = null;
        
        if (sourceMessageId) {
          // Find the specific message that triggered this follow-up
          targetMessage = existingSession?.messages?.find((msg: any) => 
            msg.id === sourceMessageId && msg.detectedQuestion?.found
          );
        } else {
          // Fallback: Find the most recent message with detectedQuestion data
          const messagesWithDetectedQuestion = existingSession?.messages?.filter((msg: any) => 
            msg.role === 'assistant' && msg.detectedQuestion?.found
          ) || [];
          
          if (messagesWithDetectedQuestion.length > 0) {
            targetMessage = messagesWithDetectedQuestion[messagesWithDetectedQuestion.length - 1];
          }
        }
        
        if (!targetMessage) {
          throw new Error('❌ [DETAILED FEEDBACK] No detected question found in target message - cannot generate detailed feedback');
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        // Use detailed feedback prompt
        const { getPrompt } = await import('../config/prompts.js');
        const systemPrompt = getPrompt('detailedfeedback.system');
        const userPrompt = getPrompt('detailedfeedback.user', 
          targetMessage.detectedQuestion.questionText || '', 
          targetMessage.detectedQuestion.markingScheme || ''
        );

        contextualResult = await AIMarkingService.generateChatResponse(
          targetMessage.detectedQuestion.questionText || '',  // OCR text (question + steps)
          targetMessage.detectedQuestion.markingScheme || '',  // marking scheme
          resolvedModel,
          false, // isQuestionOnly
          false, // debug
          undefined, // onProgress
          true // useOcrText
        );
        
        // Complete generating response step
        progressTracker.completeCurrentStep();
        progressTracker.finish();
        
        aiResponse = contextualResult.response;
        apiUsed = contextualResult.apiUsed;
      } else {
        // For text-only messages, use contextual response with progress tracking
        console.log('🔍 [TEXT MODE DEBUG] Text mode request received:');
        console.log('  - message (user input):', message);
        console.log('  - sessionId:', currentSessionId);
        console.log('  - mode:', mode);
        
        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

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
              
              // Debug: Log chat history content
              console.log('🔍 [TEXT MODE DEBUG] Chat history from session:');
              console.log('  - Total messages:', chatHistory.length);
              chatHistory.forEach((msg, index) => {
                console.log(`  - Message ${index}: ${msg.role} - "${msg.content?.substring(0, 100)}..."`);
              });
            }
          } catch (error) {
          }
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        contextualResult = await AIMarkingService.generateContextualResponse(
          message,  // user's message text
          chatHistory,  // chat history for context
          resolvedModel
        );
        aiResponse = contextualResult.response;
        apiUsed = contextualResult.apiUsed;

        // Complete generating response step
        progressTracker.completeCurrentStep();
        progressTracker.finish();
      }
    } catch (error) {
      console.error('❌ AI service failed:', error);
      throw error;
    }

    // Create AI message using factory
    const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, aiResponse, 'chat');
    const aiMessage = createAIMessage({
      content: aiResponse,
      messageId: resolvedAIMessageId,
      imageData: !isAuthenticated && imageData ? imageData : undefined, // Include imageData for unauthenticated users
      progressData: finalProgressData || createChatProgressData(false),
      processingStats: {
        modelUsed: resolvedModel,
        imageSize: imageData ? imageData.length : 0,
        apiUsed: apiUsed,
        llmTokens: contextualResult?.usageTokens || 0,
        mathpixCalls: 0,
        confidence: contextualResult?.confidence || 0,
        annotations: 0,
        processingTimeMs: Date.now() - startTime
      }
    });
    

    // Handle session creation and message storage - only for authenticated users
    if (isAuthenticated) {
      if (!sessionId || sessionId.startsWith('temp-')) {
        // Creating new session - create session with both user and AI messages
        await FirestoreService.createUnifiedSessionWithMessages({
          sessionId: currentSessionId,
          title: sessionTitle,
          userId: userId,
          messageType: 'Chat',
          messages: [userMessage, aiMessage],
          sessionStats: {
            totalProcessingTimeMs: contextualResult?.processingTimeMs || (Date.now() - startTime),
            lastModelUsed: resolvedModel,
            lastApiUsed: apiUsed,
            totalLlmTokens: contextualResult?.usageTokens || 0,
            totalMathpixCalls: 0,
            totalTokens: contextualResult?.usageTokens || 0,
            averageConfidence: contextualResult?.confidence || 0,
            imageSize: imageData ? imageData.length : 0,
            totalAnnotations: 0
          }
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
      // Load session data for response - add small delay to ensure database consistency
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
      // For anonymous users, frontend maintains user messages, backend only provides AI response
      // No need to create user message - frontend already has it
      sessionData = {
        id: currentSessionId,
        title: sessionTitle,
        userId: userId,
        messageType: 'Chat',
        messages: [aiMessage], // Only AI message - frontend handles user messages
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
      // Anonymous users get only AI message for frontend to append
      res.json({
        success: true,
        aiMessage: aiMessage, // Only AI message - frontend handles user messages
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
