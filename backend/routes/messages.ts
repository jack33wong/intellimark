/**
 * Messages API Routes - UnifiedMessage System
 * Single source of truth for all chat, marking, and question data
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { MarkingServiceLocator } from '../services/marking/MarkingServiceLocator.js';
import { createUserMessage, createAIMessage, createChatProgressData, handleAIMessageIdForEndpoint } from '../utils/messageUtils.js';
import { ProgressTracker, getStepsForMode } from '../utils/progressTracker.js';
import type { UnifiedMessage, QuestionPart } from '../types/index.js';
import { isValidSuggestedFollowUpMode as isFollowUpMode } from '../config/suggestedFollowUpConfig.js';
import { checkCredits, deductCredits } from '../services/creditService.js';
import { UsageTracker } from '../utils/usageTracker.js';

const router = express.Router();

/**
 * Format "Your Work" section from marking context using clean nested structure
 */
function formatYourWorkSection(parts: QuestionPart[], questionNumber: string): string {
  if (!parts || parts.length === 0) return '';

  // Helper to convert LaTeX to HTML entities
  const convertLatexToHtml = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/\$\\times\$/g, '×')
      .replace(/\\times/g, '×')
      .replace(/\^{([^}]+)}/g, '<sup>$1</sup>')
      .replace(/\^(\d)/g, '<sup>$1</sup>')
      .replace(/_{([^}]+)}/g, '<sub>$1</sub>')
      .replace(/_(\d)/g, '<sub>$1</sub>')
      .replace(/\$/g, ''); // Remove remaining $ symbols
  };

  let output = `:::your-work\n`;
  output += `YOUR WORK:\n`;
  output += `\t${questionNumber}\n`;

  // Group parts by parent letter for nesting
  const grouped: { [key: string]: { label: string; children: { label: string; marks: any[] }[] } } = {};

  parts.forEach(part => {
    // Display each mark with its work on same line
    part.marks.forEach(mark => {
      const cleanWork = mark.work ? convertLatexToHtml(mark.work) : '';

      // Format: part) work -- marks - reasoning
      if (part.part) {
        output += `\t\t${part.part}) ${cleanWork} -- ${mark.code} - ${mark.reasoning}\n`;
      } else {
        // Main question (no part label)
        output += `\t\t${cleanWork} -- ${mark.code} - ${mark.reasoning}\n`;
      }
    });
  });

  output += `:::\n\n`;
  return output;
}


export function formatYourWork(
  markingContext: any,
  questionNumber: string
): string {
  if (!markingContext || !markingContext.questionResults) {
    return '';
  }

  // Find question result
  const questionResult = markingContext.questionResults.find(
    (q: any) => String(q.number) === String(questionNumber)
  );

  if (!questionResult || !questionResult.parts || questionResult.parts.length === 0) {
    return '';
  }

  return formatYourWorkSection(questionResult.parts, questionNumber);
}


/**
 * POST /messages/chat
 * Unified chat endpoint - handles conversational flow with session management
 * Supports both authenticated and anonymous users
 */
router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message, imageData, model = 'auto', sessionId, mode, aiMessageId, sourceMessageId } = req.body;

    // Instantiate UsageTracker for this request
    const usageTracker = new UsageTracker();

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
          messages: [userMessage], // Include user message in database
          usageMode: 'chat'
        });
      } else {
        // For anonymous users, use provided sessionId or create a permanent one
        currentSessionId = sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
    }

    // Check credits before processing (skip for anonymous users)
    let creditWarning: string | undefined;
    if (isAuthenticated && userId !== 'anonymous') {
      try {
        // Estimate cost based on message length and image size
        const estimatedCost = ((imageData ? imageData.length / 1000 : 0) + (message?.length || 0) / 100) * 0.001;
        const creditCheck = await checkCredits(userId, estimatedCost);
        creditWarning = creditCheck.warning;

        if (creditWarning) {
          console.log(`💳 Credit warning for user ${userId}: ${creditWarning}`);
        }
      } catch (error) {
        console.error('❌ Credit check failed:', error);
        // Continue anyway - don't block user on credit check failure
      }
    }

    // Generate AI response using real AI service
    let aiResponse: string;
    let apiUsed = 'Unknown API';
    let finalProgressData: any = null;
    let contextualResult: any = null;
    let contextSummary: string | undefined = undefined; // Declare at function scope
    const startTime = Date.now();

    try {
      if (imageData) {
        // For messages with images, use image-aware chat response
        // Note: passing usageTracker as the 8th argument
        const aiResult = await MarkingServiceLocator.generateChatResponse(
          imageData,
          message,
          resolvedModel as any,
          "questionAnswer",
          false,         // debug
          undefined,     // onProgress
          false,         // useOcrText
          usageTracker   // tracker
        );
        aiResponse = aiResult.response;
        apiUsed = aiResult.apiUsed;
        contextualResult = aiResult; // Store for processing stats
      } else if (isFollowUpMode(mode)) {
        // Handle all follow-up requests using the centralized service
        const { SuggestedFollowUpService } = await import('../services/marking/suggestedFollowUpService.js');

        const followUpResult = await SuggestedFollowUpService.handleSuggestedFollowUp({
          mode,
          sessionId: currentSessionId,
          sourceMessageId,
          model: resolvedModel,
          detectedQuestion: req.body.detectedQuestion  // Pass detectedQuestion from request (for unauthenticated users)
        });

        aiResponse = followUpResult.response;
        apiUsed = followUpResult.apiUsed;
        finalProgressData = followUpResult.progressData;
        // Store usageTokens for processingStats
        contextualResult = {
          response: followUpResult.response,
          apiUsed: followUpResult.apiUsed,
          usageTokens: followUpResult.usageTokens || 0
        };
      } else {
        // For text-only messages, use contextual response with progress tracking

        const progressTracker = new ProgressTracker(getStepsForMode('text'), (data) => {
          finalProgressData = data;
        });

        // Start with AI thinking step
        progressTracker.startStep('ai_thinking');

        // First get existing session messages for context
        let chatHistory: any[] = [];
        contextSummary = undefined; // Reset for this block

        if (currentSessionId) {
          try {
            const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
            if (existingSession?.messages) {
              chatHistory = existingSession.messages.map(msg => ({
                role: msg.role,
                content: msg.content
              }));

              // INJECT: Find rich marking context from the assistant's marking result
              // Look for the last message that has markingContext (usually the initial marking response)
              const lastMarkingMessage = [...existingSession.messages].reverse().find(msg => (msg as any).markingContext);

              if (lastMarkingMessage && (lastMarkingMessage as any).markingContext) {
                const { ChatContextBuilder } = await import('../services/marking/ChatContextBuilder.js');
                const markingContext = (lastMarkingMessage as any).markingContext;

                // Populate followUpHistory from the recent chat history
                // We pair User -> Assistant messages to create coherent history entries
                const followUpHistory = [];
                const msgs = existingSession.messages;

                for (let i = 0; i < msgs.length - 1; i++) {
                  if (msgs[i].role === 'user' && msgs[i + 1]?.role === 'assistant') {
                    followUpHistory.push({
                      userMessage: msgs[i].content,
                      aiResponse: msgs[i + 1].content,
                      timestamp: Date.parse(msgs[i].timestamp || new Date().toISOString())
                    });
                  }
                }

                // Update the context object (in memory only) with recent history
                markingContext.followUpHistory = followUpHistory;

                // Generate the full prompt including marking details + history
                contextSummary = ChatContextBuilder.formatContextAsPrompt(markingContext);

                console.log('\n🤖 [AI CONTEXT PROMPT] Sending to AI:');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(contextSummary.substring(0, 800) + '\n...[truncated]...');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                console.log(`[CONTEXT FLOW] 🔍 Found marking context in session history (Qs: ${markingContext.totalQuestionsMarked})`);
                console.log(`[CONTEXT FLOW] 📝 Generated context prompt (Length: ${contextSummary.length} chars)`);

                // Update progress tracker to indicate context mode
                progressTracker.updateStepDescription('generating_response', 'Thinking with marking context...');
              }
            }
          } catch (error) {
            console.error('Failed to load chat/marking context:', error);
          }
        }

        // Complete AI thinking step and start generating response step
        progressTracker.completeCurrentStep();
        progressTracker.startStep('generating_response');

        // Simulate processing time for "Generating response..." step
        await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 seconds

        contextualResult = await MarkingServiceLocator.generateContextualResponse(
          message,  // user's message text
          chatHistory,  // chat history for context (fallback if contextSummary used, or ignored)
          resolvedModel,
          contextSummary, // Pass the rich context summary
          usageTracker    // Pass usage tracker
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

    // Prepend "Your Work" section if applicable
    let finalResponse = aiResponse;
    if (aiResponse && contextSummary) {
      // Detect question number from AI response
      const qMatch = aiResponse.match(/(?:question|q)\s*(\d+)/i);
      if (qMatch && qMatch[1]) {
        const questionNumber = qMatch[1];
        // Get marking context from last marking message
        const existingSession = await FirestoreService.getUnifiedSession(currentSessionId);
        const lastMarkingMsg = [...(existingSession?.messages || [])].reverse().find(m => (m as any).markingContext);


        if (lastMarkingMsg) {
          const yourWorkSection = formatYourWork((lastMarkingMsg as any).markingContext, questionNumber);

          // Check if AI response already contains :::your-work (prevent duplicates)
          if (yourWorkSection && !aiResponse.includes(':::your-work')) {
            console.log('\n📝 [YOUR WORK SECTION] Generated:');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(yourWorkSection);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Find where to insert Your Work section (after first paragraph/question header)
            // Look for first double newline which usually separates header from content
            const firstParagraphEnd = aiResponse.indexOf('\n\n');

            if (firstParagraphEnd !== -1) {
              // Insert Your Work right after the question header paragraph
              const beforeYourWork = aiResponse.substring(0, firstParagraphEnd + 2);
              const afterYourWork = aiResponse.substring(firstParagraphEnd + 2);
              finalResponse = beforeYourWork + yourWorkSection + '\n' + afterYourWork;
            } else {
              // Fallback: prepend if no double newline found
              finalResponse = yourWorkSection + '\n' + aiResponse;
            }

            console.log(`✅ Prepended Your Work for Q${questionNumber}`);
          } else if (aiResponse.includes(':::your-work')) {
            console.log(`⚠️  AI response already contains :::your-work, skipping duplicate insertion`);
            finalResponse = aiResponse; // Use AI response as-is
          }
        }
      }
    }


    console.log('[FINAL RESPONSE] Length:', finalResponse?.length, 'chars');
    console.log('[FINAL RESPONSE] First 200 chars:', finalResponse?.substring(0, 200));

    // Create AI message using factory
    const resolvedAIMessageId = handleAIMessageIdForEndpoint(req.body, aiResponse, 'chat');
    const aiMessage = createAIMessage({
      content: finalResponse, // Use finalResponse here
      messageId: resolvedAIMessageId,
      imageData: !isAuthenticated && imageData ? imageData : undefined, // Include imageData for unauthenticated users
      progressData: finalProgressData || createChatProgressData(false),
      processingStats: {
        modelUsed: resolvedModel,
        imageSize: imageData ? imageData.length : 0,
        apiUsed: apiUsed,
        llmTokens: contextualResult?.usageTokens || 0,
        mathpixCalls: usageTracker.getMathpixPages() || 0,
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
            totalMathpixCalls: usageTracker.getMathpixPages() || 0,
            totalTokens: contextualResult?.usageTokens || 0,
            averageConfidence: contextualResult?.confidence || 0,
            imageSize: imageData ? imageData.length : 0,
            totalAnnotations: 0,
            apiRequests: 1, // Initialize API requests count
            // Add cost breakdown to enable usageRecord creation
            costBreakdown: await (async () => {
              try {
                // Use UsageTracker for accurate cost calculation
                const cost = usageTracker.calculateCost(resolvedModel);
                return {
                  llmCost: cost.total - cost.mathpix, // Total includes Mathpix, so subtract it
                  mathpixCost: cost.mathpix,
                  total: cost.total
                };
              } catch (error) {
                console.error('Cost calculation error:', error);
                return { llmCost: 0, mathpixCost: 0, total: 0 };
              }
            })(),
            totalCost: await (async () => {
              // Use UsageTracker total
              return usageTracker.calculateCost(resolvedModel).total;
            })()
          },
          usageMode: mode || 'chat'
        });
      } else {
        // Adding to existing session - add both user and AI messages
        // User message needs to be persisted for follow-up messages
        try {
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, userMessage, mode || 'chat');
          await FirestoreService.addMessageToUnifiedSession(currentSessionId, aiMessage, mode || 'chat');
        } catch (error) {
          console.error(`❌ Failed to add messages to session ${currentSessionId}:`, error);
          // This is a critical error - the session should exist but doesn't
          throw error; // Re-throw to prevent silent failures
        }
      }
    }

    // Deduct credits after processing (skip for anonymous users)
    if (isAuthenticated && userId !== 'anonymous') {
      try {
        // Wait briefly to ensure usageRecord is created
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get usage cost from usageRecords collection
        const { getFirestore } = await import('../config/firebase.js');
        const db = getFirestore();
        if (db) {
          const usageDoc = await db.collection('usageRecords').doc(currentSessionId).get();
          if (usageDoc.exists) {
            const usageData = usageDoc.data();
            const actualCost = usageData?.totalCost || 0;

            if (actualCost > 0) {
              await deductCredits(userId, actualCost, currentSessionId);
              console.log(`💳 Deducted ${actualCost} cost (session: ${currentSessionId}) from user ${userId}`);
            }
          }
        }
      } catch (error) {
        console.error('❌ Credit deduction failed:', error);
        // Don't fail the request if credit deduction fails
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
      // Authenticated users get only AI message (like marking/question modes)
      res.json({
        success: true,
        aiMessage: aiMessage,
        sessionId: currentSessionId,
        sessionTitle: sessionTitle
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
