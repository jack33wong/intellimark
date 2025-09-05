"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatSessionManager = void 0;
const firestoreService_1 = require("./firestoreService");
const aiMarkingService_1 = require("./aiMarkingService");
class ChatSessionManager {
    constructor() {
        this.activeSessions = new Map();
        this.persistenceInterval = null;
        this.cleanupInterval = null;
        this.BATCH_SIZE = 5;
        this.MAX_IN_MEMORY_SESSIONS = 50;
        this.SESSION_TIMEOUT = 30 * 60 * 1000;
        this.PERSISTENCE_INTERVAL = 60 * 1000;
        try {
            this.startPeriodicPersistence();
            this.startSessionCleanup();
            console.log('✅ ChatSessionManager background processes started successfully');
        }
        catch (error) {
            console.error('❌ Failed to start ChatSessionManager background processes:', error);
        }
    }
    static getInstance() {
        if (!ChatSessionManager.instance) {
            ChatSessionManager.instance = new ChatSessionManager();
        }
        return ChatSessionManager.instance;
    }
    async generateContextSummaryIfNeeded(sessionId) {
        try {
            const sessionCache = this.activeSessions.get(sessionId);
            if (!sessionCache) {
                return null;
            }
            const session = sessionCache.session;
            const messageCount = session.messages.length;
            if (messageCount < 4) {
                return null;
            }
            const lastSummaryUpdate = session.lastSummaryUpdate;
            const now = new Date();
            const timeSinceLastSummary = lastSummaryUpdate
                ? now.getTime() - lastSummaryUpdate.getTime()
                : Infinity;
            const shouldGenerateSummary = !session.contextSummary ||
                timeSinceLastSummary > 10 * 60 * 1000 ||
                (messageCount >= 4 && !session.contextSummary) ||
                (session.contextSummary && messageCount % 6 === 0);
            if (!shouldGenerateSummary) {
                return session.contextSummary || null;
            }
            console.log('🔍 Generating context summary for session:', sessionId);
            const messagesForSummary = session.messages.slice(0, -1);
            const summary = await aiMarkingService_1.AIMarkingService.generateContextSummary(messagesForSummary);
            if (summary) {
                session.contextSummary = summary;
                session.lastSummaryUpdate = new Date();
                sessionCache.isDirty = true;
                console.log('✅ Context summary updated for session:', sessionId);
                return summary;
            }
            return session.contextSummary || null;
        }
        catch (error) {
            console.error('❌ Failed to generate context summary:', error);
            return null;
        }
    }
    async getSession(sessionId) {
        try {
            const cached = this.activeSessions.get(sessionId);
            if (cached) {
                cached.lastAccessed = new Date();
                return cached.session;
            }
            if (typeof firestoreService_1.FirestoreService.getChatSession === 'function') {
                const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
                if (session) {
                    this.cacheSession(session);
                    return session;
                }
            }
            else {
                console.warn('FirestoreService.getChatSession not available, returning null');
            }
            return null;
        }
        catch (error) {
            console.error('Failed to get session:', error);
            return null;
        }
    }
    async createSession(sessionData) {
        try {
            if (typeof firestoreService_1.FirestoreService.createChatSession !== 'function') {
                console.warn('FirestoreService.createChatSession not available, using fallback');
                const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const newSession = {
                    id: sessionId,
                    title: sessionData.title,
                    messages: sessionData.messages,
                    timestamp: new Date(),
                    userId: sessionData.userId || 'anonymous'
                };
                this.cacheSession(newSession);
                return sessionId;
            }
            const sessionId = await firestoreService_1.FirestoreService.createChatSession(sessionData);
            const newSession = {
                id: sessionId,
                title: sessionData.title,
                messages: sessionData.messages,
                timestamp: new Date(),
                userId: sessionData.userId || 'anonymous'
            };
            this.cacheSession(newSession);
            return sessionId;
        }
        catch (error) {
            console.error('Failed to create session:', error);
            throw error;
        }
    }
    async addMessage(sessionId, message) {
        try {
            const cached = this.activeSessions.get(sessionId);
            if (!cached) {
                const session = await this.getSession(sessionId);
                if (!session) {
                    throw new Error('Session not found');
                }
            }
            const cachedSession = this.activeSessions.get(sessionId);
            const newMessage = {
                ...message,
                timestamp: new Date()
            };
            cachedSession.session.messages.push(newMessage);
            cachedSession.pendingMessages.push(newMessage);
            cachedSession.isDirty = true;
            cachedSession.lastAccessed = new Date();
            if (cachedSession.pendingMessages.length >= this.BATCH_SIZE) {
                await this.persistSession(sessionId);
            }
            return true;
        }
        catch (error) {
            console.error('Failed to add message:', error);
            return false;
        }
    }
    async getChatHistory(sessionId, limit = 50) {
        try {
            const cached = this.activeSessions.get(sessionId);
            if (cached) {
                return cached.session.messages.slice(-limit);
            }
            if (typeof firestoreService_1.FirestoreService.getChatSession === 'function') {
                const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
                if (session) {
                    this.cacheSession(session);
                    return session.messages.slice(-limit);
                }
            }
            else {
                console.warn('FirestoreService.getChatHistory: getChatSession not available, returning empty array');
            }
            return [];
        }
        catch (error) {
            console.error('Failed to get chat history:', error);
            return [];
        }
    }
    async restoreSession(sessionId) {
        try {
            const [summary, recentHistory] = await Promise.all([
                this.getSessionSummary(sessionId),
                this.getRecentMessages(sessionId, 20)
            ]);
            if (!summary) {
                return null;
            }
            const session = {
                id: sessionId,
                title: summary.title,
                messages: recentHistory,
                timestamp: summary.lastMessageAt,
                userId: 'anonymous'
            };
            this.cacheSession(session);
            console.log(`✅ Session ${sessionId} restored with ${recentHistory.length} recent messages`);
            return session;
        }
        catch (error) {
            console.error('Failed to restore session:', error);
            return null;
        }
    }
    async getSessionSummary(sessionId) {
        try {
            const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
            if (!session)
                return null;
            const recentMessages = session.messages.slice(-10);
            const keyTopics = this.extractKeyTopics(recentMessages);
            const contextSummary = this.generateContextSummary(recentMessages);
            return {
                sessionId,
                title: session.title,
                messageCount: session.messages.length,
                lastMessageAt: session.timestamp,
                keyTopics,
                contextSummary
            };
        }
        catch (error) {
            console.error('Failed to generate session summary:', error);
            return null;
        }
    }
    async getRecentMessages(sessionId, limit) {
        try {
            const session = await firestoreService_1.FirestoreService.getChatSession(sessionId);
            if (!session)
                return [];
            return session.messages.slice(-limit);
        }
        catch (error) {
            console.error('Failed to get recent messages:', error);
            return [];
        }
    }
    extractKeyTopics(messages) {
        const topics = new Set();
        messages.forEach(message => {
            const content = message.content.toLowerCase();
            if (content.includes('math') || content.includes('algebra') || content.includes('calculus')) {
                topics.add('Mathematics');
            }
            if (content.includes('science') || content.includes('physics') || content.includes('chemistry')) {
                topics.add('Science');
            }
            if (content.includes('english') || content.includes('literature') || content.includes('writing')) {
                topics.add('English');
            }
            if (content.includes('history') || content.includes('social studies')) {
                topics.add('History');
            }
        });
        return Array.from(topics);
    }
    generateContextSummary(messages) {
        if (messages.length === 0)
            return 'New conversation started';
        const userMessages = messages.filter(m => m.role === 'user');
        const assistantMessages = messages.filter(m => m.role === 'assistant');
        const lastUserMessage = userMessages[userMessages.length - 1];
        const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
        let summary = `Conversation with ${messages.length} messages. `;
        if (lastUserMessage) {
            summary += `Last user question: "${lastUserMessage.content.substring(0, 100)}...". `;
        }
        if (lastAssistantMessage) {
            summary += `Last AI response: "${lastAssistantMessage.content.substring(0, 100)}...". `;
        }
        return summary;
    }
    cacheSession(session) {
        if (this.activeSessions.size >= this.MAX_IN_MEMORY_SESSIONS) {
            this.evictOldestSession();
        }
        this.activeSessions.set(session.id, {
            session,
            lastAccessed: new Date(),
            pendingMessages: [],
            isDirty: false
        });
    }
    evictOldestSession() {
        let oldestSessionId = null;
        let oldestAccess = new Date();
        this.activeSessions.forEach((cache, sessionId) => {
            if (cache.lastAccessed < oldestAccess) {
                oldestAccess = cache.lastAccessed;
                oldestSessionId = sessionId;
            }
        });
        if (oldestSessionId) {
            this.persistSession(oldestSessionId).then(() => {
                this.activeSessions.delete(oldestSessionId);
                console.log(`🗑️ Evicted session ${oldestSessionId} from cache`);
            });
        }
    }
    async persistSession(sessionId) {
        try {
            const cached = this.activeSessions.get(sessionId);
            if (!cached || !cached.isDirty)
                return;
            for (const message of cached.pendingMessages) {
                await firestoreService_1.FirestoreService.addMessageToSession(sessionId, message);
            }
            cached.pendingMessages = [];
            cached.isDirty = false;
            console.log(`💾 Persisted ${cached.pendingMessages.length} messages for session ${sessionId}`);
        }
        catch (error) {
            console.error('Failed to persist session:', error);
        }
    }
    startPeriodicPersistence() {
        this.persistenceInterval = setInterval(async () => {
            try {
                const persistPromises = Array.from(this.activeSessions.keys()).map(sessionId => this.persistSession(sessionId));
                await Promise.all(persistPromises);
                console.log(`💾 Periodic persistence completed for ${this.activeSessions.size} sessions`);
            }
            catch (error) {
                console.error('Periodic persistence failed:', error);
            }
        }, this.PERSISTENCE_INTERVAL);
    }
    startSessionCleanup() {
        this.cleanupInterval = setInterval(() => {
            const now = new Date();
            const timeoutThreshold = new Date(now.getTime() - this.SESSION_TIMEOUT);
            this.activeSessions.forEach((cache, sessionId) => {
                if (cache.lastAccessed < timeoutThreshold) {
                    this.persistSession(sessionId).then(() => {
                        this.activeSessions.delete(sessionId);
                        console.log(`⏰ Evicted timed-out session ${sessionId}`);
                    });
                }
            });
        }, 5 * 60 * 1000);
    }
    getCacheStats() {
        let totalPending = 0;
        this.activeSessions.forEach(cache => {
            totalPending += cache.pendingMessages.length;
        });
        return {
            activeSessions: this.activeSessions.size,
            totalPendingMessages: totalPending,
            memoryUsage: this.activeSessions.size * 1024
        };
    }
    stopBackgroundProcesses() {
        if (this.persistenceInterval) {
            clearInterval(this.persistenceInterval);
            this.persistenceInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    cleanup() {
        if (this.persistenceInterval) {
            clearInterval(this.persistenceInterval);
            this.persistenceInterval = null;
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        const persistPromises = Array.from(this.activeSessions.keys()).map(sessionId => this.persistSession(sessionId));
        Promise.all(persistPromises).then(() => {
            this.activeSessions.clear();
            console.log('🧹 ChatSessionManager cleanup completed');
        });
    }
}
exports.ChatSessionManager = ChatSessionManager;
exports.default = ChatSessionManager;
