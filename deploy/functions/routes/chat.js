"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firestoreService_1 = require("../services/firestoreService");
const aiMarkingService_1 = require("../services/aiMarkingService");
const chatSessionManager_1 = __importDefault(require("../services/chatSessionManager"));
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
console.log('🚀 CHAT ROUTE MODULE LOADED SUCCESSFULLY');
router.post('/', auth_1.optionalAuth, async (req, res) => {
    console.log('🚀 ===== CHAT ROUTE CALLED =====');
    try {
        const { message, imageData, model = 'chatgpt-4o', sessionId, userId, mode } = req.body;
        const currentUserId = req.user?.uid || userId || 'anonymous';
        console.log('🔍 Request data:', {
            hasMessage: !!message,
            hasImage: !!imageData,
            model,
            sessionId,
            userId: currentUserId,
            isAuthenticated: !!req.user,
            mode
        });
        if (!message && !imageData) {
            return res.status(400).json({
                success: false,
                error: 'Message or image data is required'
            });
        }
        let currentSessionId = sessionId;
        const sessionManager = chatSessionManager_1.default.getInstance();
        if (!currentSessionId) {
            console.log('📝 Creating new chat session');
            currentSessionId = await sessionManager.createSession({
                title: imageData ? 'Image-based Chat' : 'Text Chat',
                messages: [],
                userId: currentUserId
            });
            console.log('📝 Created new session:', currentSessionId);
        }
        else {
            const existingSession = await sessionManager.getSession(currentSessionId);
            if (!existingSession) {
                console.log('📝 Session not found, creating new one');
                currentSessionId = await sessionManager.createSession({
                    title: imageData ? 'Image-based Chat' : 'Text Chat',
                    messages: [],
                    userId: currentUserId
                });
            }
        }
        const chatHistory = await sessionManager.getChatHistory(currentSessionId, 20);
        console.log('📝 Retrieved chat history:', chatHistory.length, 'messages');
        await sessionManager.addMessage(currentSessionId, {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            role: 'user',
            content: message || 'I have a question that I need help with. Can you assist me?',
            imageData: imageData
        });
        let contextSummary = null;
        if (chatHistory.length > 0) {
            console.log('🔍 Checking if context summary is needed...');
            contextSummary = await sessionManager.generateContextSummaryIfNeeded(currentSessionId);
            if (contextSummary) {
                console.log('📝 Using context summary for response');
            }
            else {
                console.log('📝 No summary needed, using recent messages');
            }
        }
        let aiResponse;
        let apiUsed = model === 'gemini-2.5-pro' ? 'Google Gemini 2.5 Pro' :
            model === 'chatgpt-5' ? 'OpenAI GPT-5' : 'OpenAI GPT-4 Omni';
        try {
            if (imageData && chatHistory.length === 0) {
                console.log('🔍 Processing initial image with AI for chat response');
                const chatResponse = await aiMarkingService_1.AIMarkingService.generateChatResponse(imageData, message || 'I have a question that I need help with. Can you assist me?', model, mode === 'qa' ? false : true);
                aiResponse = chatResponse.response;
                apiUsed = chatResponse.apiUsed;
                console.log('✅ AI chat response generated successfully');
            }
            else {
                console.log('🔍 Processing follow-up message with context');
                const contextualMessage = imageData
                    ? `${message}\n\n[Image context available for reference]`
                    : message;
                aiResponse = await aiMarkingService_1.AIMarkingService.generateContextualResponse(contextualMessage, chatHistory, model, contextSummary || undefined);
                console.log('✅ AI contextual response generated successfully');
            }
        }
        catch (error) {
            console.error('❌ Failed to generate AI response:', error);
            aiResponse = 'I apologize, but I encountered an error processing your request. Please try again.';
        }
        await sessionManager.addMessage(currentSessionId, {
            id: `msg-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`,
            role: 'assistant',
            content: aiResponse
        });
        console.log('📝 Added AI response to session');
        return res.json({
            success: true,
            sessionId: currentSessionId,
            response: aiResponse,
            apiUsed: apiUsed,
            context: {
                sessionId: currentSessionId,
                messageCount: chatHistory.length + 2,
                hasImage: !!imageData,
                hasContext: chatHistory.length > 0,
                usingSummary: !!contextSummary,
                summaryLength: contextSummary ? contextSummary.length : 0
            }
        });
    }
    catch (error) {
        console.error('Chat route error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
router.get('/sessions/:userId', auth_1.optionalAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        console.log('🔍 Getting chat sessions for user:', userId);
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to access your chat history'
            });
        }
        if (req.user.uid !== userId) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You can only access your own chat sessions'
            });
        }
        const sessions = await firestoreService_1.FirestoreService.getChatSessions(userId);
        return res.json({
            success: true,
            sessions: sessions || []
        });
    }
    catch (error) {
        console.error('Failed to get chat sessions:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to retrieve chat sessions'
        });
    }
});
router.get('/session/:sessionId', auth_1.optionalAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;
        console.log('🔍 Getting chat session:', sessionId);
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to access chat sessions'
            });
        }
        const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
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
                message: 'You can only access your own chat sessions'
            });
        }
        return res.json({
            success: true,
            session
        });
    }
    catch (error) {
        console.error('Failed to get chat session:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to retrieve chat session'
        });
    }
});
router.put('/session/:sessionId', auth_1.optionalAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;
        const updates = req.body;
        console.log('🔍 Updating chat session:', sessionId, updates);
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to update chat sessions'
            });
        }
        const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
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
        await firestoreService_1.FirestoreService.updateChatSession(sessionId, updates);
        return res.json({
            success: true,
            message: 'Session updated successfully'
        });
    }
    catch (error) {
        console.error('Failed to update chat session:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update chat session'
        });
    }
});
router.delete('/session/:sessionId', auth_1.optionalAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;
        console.log('🔍 Deleting chat session:', sessionId);
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to delete chat sessions'
            });
        }
        const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
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
        await firestoreService_1.FirestoreService.deleteChatSession(sessionId);
        return res.json({
            success: true,
            message: 'Session deleted successfully'
        });
    }
    catch (error) {
        console.error('Failed to delete chat session:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete chat session'
        });
    }
});
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
    }
    catch (error) {
        res.status(500).json({
            service: 'Chat Context API',
            status: 'error',
            error: 'Failed to get status'
        });
    }
});
router.post('/restore/:sessionId', auth_1.optionalAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;
        console.log('🔄 Restoring session context:', sessionId);
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                message: 'Please log in to restore chat sessions'
            });
        }
        const sessionManager = chatSessionManager_1.default.getInstance();
        const session = await sessionManager.restoreSession(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
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
    }
    catch (error) {
        console.error('Failed to restore session:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to restore session context'
        });
    }
});
router.get('/cache/stats', (_req, res) => {
    try {
        const sessionManager = chatSessionManager_1.default.getInstance();
        const stats = sessionManager.getCacheStats();
        res.json({
            success: true,
            stats: {
                ...stats,
                timestamp: new Date().toISOString()
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get cache statistics'
        });
    }
});
router.post('/cache/clear', (_req, res) => {
    try {
        const sessionManager = chatSessionManager_1.default.getInstance();
        sessionManager.cleanup();
        res.json({
            success: true,
            message: 'Cache cleared successfully'
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to clear cache'
        });
    }
});
exports.default = router;
