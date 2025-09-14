/**
 * Chat Session Manager Service
 * Implements in-memory session caching with periodic persistence and smart context recovery
 */

import { ChatSession, ChatMessage, CreateChatSessionData } from '../types';
import { FirestoreService } from './firestoreService';
import { AIMarkingService } from './aiMarkingService';

interface SessionCache {
  session: ChatSession;
  lastAccessed: Date;
  pendingMessages: ChatMessage[];
  isDirty: boolean;
}

interface SessionSummary {
  sessionId: string;
  title: string;
  messageCount: number;
  lastMessageAt: Date;
  keyTopics: string[];
  contextSummary: string;
}

export class ChatSessionManager {
  private static instance: ChatSessionManager;
  private activeSessions = new Map<string, SessionCache>();
  private persistenceInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 5; // Persist every 5 messages
  private readonly MAX_IN_MEMORY_SESSIONS = 50; // Limit active sessions in memory
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly PERSISTENCE_INTERVAL = 60 * 1000; // Persist every minute

  private constructor() {
    try {
      this.startPeriodicPersistence();
      this.startSessionCleanup();
    } catch (error) {
      console.error('❌ Failed to start ChatSessionManager background processes:', error);
      // Continue without background processes
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ChatSessionManager {
    if (!ChatSessionManager.instance) {
      ChatSessionManager.instance = new ChatSessionManager();
    }
    return ChatSessionManager.instance;
  }

  /**
   * Generate context summary for a session if needed
   */
  async generateContextSummaryIfNeeded(sessionId: string): Promise<string | null> {
    try {
      const sessionCache = this.activeSessions.get(sessionId);
      if (!sessionCache) {
        return null;
      }

      const session = sessionCache.session;
      const messageCount = session.messages.length;

      // Only generate summary if we have enough messages and no recent summary
      if (messageCount < 4) {
        return null;
      }

      const lastSummaryUpdate = session.lastSummaryUpdate;
      const now = new Date();
      const timeSinceLastSummary = lastSummaryUpdate 
        ? now.getTime() - lastSummaryUpdate.getTime() 
        : Infinity;

      // Generate summary if:
      // 1. No summary exists, OR
      // 2. More than 10 minutes since last summary, OR
      // 3. More than 4 messages and no summary exists, OR
      // 4. Every 6 messages after the first summary
      const shouldGenerateSummary = !session.contextSummary || 
        timeSinceLastSummary > 10 * 60 * 1000 || 
        (messageCount >= 4 && !session.contextSummary) ||
        (session.contextSummary && messageCount % 6 === 0);

      if (!shouldGenerateSummary) {
        return session.contextSummary || null;
      }

      
      // Get all messages except the last one (current user message)
      const messagesForSummary = session.messages.slice(0, -1);
      const summary = await AIMarkingService.generateContextSummary(messagesForSummary);

      if (summary) {
        // Update session with new summary
        session.contextSummary = summary;
        session.lastSummaryUpdate = new Date();
        
        // Mark session as dirty for persistence
        sessionCache.isDirty = true;
        
        return summary;
      }

      return session.contextSummary || null;
    } catch (error) {
      console.error('❌ Failed to generate context summary:', error);
      return null;
    }
  }

  /**
   * Get or create session from cache
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    try {
      // Check in-memory cache first
      const cached = this.activeSessions.get(sessionId);
      if (cached) {
        cached.lastAccessed = new Date();
        return cached.session;
      }

      // Load from database if not in cache
      if (typeof FirestoreService.getChatSession === 'function') {
        const session = await FirestoreService.getChatSession(sessionId);
        if (session) {
          // Cache the session
          this.cacheSession(session);
          return session;
        }
      } else {
        console.warn('FirestoreService.getChatSession not available, returning null');
      }

      return null;
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Create new session and cache it
   */
  async createSession(sessionData: CreateChatSessionData): Promise<string> {
    try {
      
      // Always use Firestore for session creation
      const sessionId = await FirestoreService.createChatSession(sessionData);
      
      const newSession: ChatSession = {
        id: sessionId,
        title: sessionData.title,
        messages: sessionData.messages,
        timestamp: new Date(),
        userId: sessionData.userId || 'anonymous',
        messageType: sessionData.messageType || 'Chat',
        favorite: (sessionData as any).favorite || false,
        rating: (sessionData as any).rating || 0
      };

      // Cache the new session
      this.cacheSession(newSession);
      
      return sessionId;
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
    }
  }

  /**
   * Add message to session (in-memory first, then persist)
   */
  async addMessage(sessionId: string, message: Omit<ChatMessage, 'timestamp'>): Promise<boolean> {
    try {
      const cached = this.activeSessions.get(sessionId);
      if (!cached) {
        // Session not in cache, load it first
        const session = await this.getSession(sessionId);
        if (!session) {
          throw new Error('Session not found');
        }
        
        // Double-check that the session is now in cache
        const reloadedCached = this.activeSessions.get(sessionId);
        if (!reloadedCached) {
          throw new Error('Failed to load session into cache');
        }
      } else {
      }

      const cachedSession = this.activeSessions.get(sessionId)!;
      const newMessage: ChatMessage = {
        ...message,
        timestamp: new Date()
      };

      // Add to in-memory session
      cachedSession.session.messages.push(newMessage);
      cachedSession.pendingMessages.push(newMessage);
      cachedSession.isDirty = true;
      cachedSession.lastAccessed = new Date();

      // Check if we should persist this batch
      // Force immediate persistence for question-only sessions, marking sessions, or when batch size is reached
      const isQuestionOnlySession = cachedSession.session.title?.includes('Question -') || 
                                   cachedSession.session.title?.includes('Marking -');
      const isMarkingSession = cachedSession.session.messageType === 'Marking' || 
                              cachedSession.session.messageType === 'Question';
      
      if (cachedSession.pendingMessages.length >= this.BATCH_SIZE || isQuestionOnlySession || isMarkingSession) {
        await this.persistSession(sessionId);
      }

      return true;
    } catch (error) {
      console.error('Failed to add message:', error);
      return false;
    }
  }

  /**
   * Get chat history with smart context recovery
   */
  async getChatHistory(sessionId: string, limit: number = 50): Promise<ChatMessage[]> {
    try {
      const cached = this.activeSessions.get(sessionId);
      if (cached) {
        // Return from cache with limit
        return cached.session.messages.slice(-limit);
      }

      // Load from database
      if (typeof FirestoreService.getChatSession === 'function') {
        const session = await FirestoreService.getChatSession(sessionId);
        if (session) {
          this.cacheSession(session);
          return session.messages.slice(-limit);
        }
      } else {
        console.warn('FirestoreService.getChatHistory: getChatSession not available, returning empty array');
      }

      return [];
    } catch (error) {
      console.error('Failed to get chat history:', error);
      return [];
    }
  }

  /**
   * Restore session context on restart
   */
  async restoreSession(sessionId: string): Promise<ChatSession | null> {
    try {
      // Get session summary and recent history
      const [summary, recentHistory] = await Promise.all([
        this.getSessionSummary(sessionId),
        this.getRecentMessages(sessionId, 20)
      ]);

      if (!summary) {
        return null;
      }

      // Reconstruct context
      const session: ChatSession = {
        id: sessionId,
        title: summary.title,
        messages: recentHistory,
        timestamp: summary.lastMessageAt,
        userId: 'anonymous' // Default value for restored sessions
      };

      // Cache the restored session
      this.cacheSession(session);
      
      return session;
    } catch (error) {
      console.error('Failed to restore session:', error);
      return null;
    }
  }

  /**
   * Generate session summary for long-term recall
   */
  private async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    try {
      const session = await FirestoreService.getChatSession(sessionId);
      if (!session) return null;

      // Extract key topics from recent messages
      const recentMessages = session.messages.slice(-10);
      const keyTopics = this.extractKeyTopics(recentMessages);
      
      // Generate context summary
      const contextSummary = this.generateContextSummary(recentMessages);

      return {
        sessionId,
        title: session.title,
        messageCount: session.messages.length,
        lastMessageAt: session.timestamp,
        keyTopics,
        contextSummary
      };
    } catch (error) {
      console.error('Failed to generate session summary:', error);
      return null;
    }
  }

  /**
   * Get recent messages for context recovery
   */
  private async getRecentMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
    try {
      const session = await FirestoreService.getChatSession(sessionId);
      if (!session) return [];

      return session.messages.slice(-limit);
    } catch (error) {
      console.error('Failed to get recent messages:', error);
      return [];
    }
  }

  /**
   * Extract key topics from messages
   */
  private extractKeyTopics(messages: ChatMessage[]): string[] {
    const topics = new Set<string>();
    
    messages.forEach(message => {
      const content = message.content.toLowerCase();
      
      // Simple topic extraction (can be enhanced with NLP)
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

  /**
   * Generate context summary for conversation
   */
  private generateContextSummary(messages: ChatMessage[]): string {
    if (messages.length === 0) return 'New conversation started';
    
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

  /**
   * Cache session in memory
   */
  private cacheSession(session: ChatSession): void {
    // Check if we need to evict old sessions
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

  /**
   * Evict oldest session from cache
   */
  private evictOldestSession(): void {
    let oldestSessionId: string | null = null;
    let oldestAccess = new Date();

    this.activeSessions.forEach((cache, sessionId) => {
      if (cache.lastAccessed < oldestAccess) {
        oldestAccess = cache.lastAccessed;
        oldestSessionId = sessionId;
      }
    });

    if (oldestSessionId) {
      // Persist any pending messages before eviction
      this.persistSession(oldestSessionId).then(() => {
        this.activeSessions.delete(oldestSessionId!);
      });
    }
  }

  /**
   * Persist session to database
   */
  private async persistSession(sessionId: string): Promise<void> {
    try {
      const cached = this.activeSessions.get(sessionId);
      if (!cached || !cached.isDirty) return;

      // Persist pending messages
      const messageCount = cached.pendingMessages.length;
      for (const message of cached.pendingMessages) {
        await FirestoreService.addMessageToSession(sessionId, message);
      }

      // Update session metadata (messageType if needed)
      if (cached.session.messageType) {
        await FirestoreService.updateChatSession(sessionId, {
          messageType: cached.session.messageType
        });
      }

      // Clear pending messages and mark as clean
      cached.pendingMessages = [];
      cached.isDirty = false;
      
    } catch (error) {
      console.error('Failed to persist session:', error);
    }
  }

  /**
   * Start periodic persistence
   */
  private startPeriodicPersistence(): void {
    this.persistenceInterval = setInterval(async () => {
      try {
        const persistPromises = Array.from(this.activeSessions.keys()).map(sessionId => 
          this.persistSession(sessionId)
        );
        
        await Promise.all(persistPromises);
      } catch (error) {
        console.error('Periodic persistence failed:', error);
      }
    }, this.PERSISTENCE_INTERVAL);
  }

  /**
   * Start session cleanup
   */
  private startSessionCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const timeoutThreshold = new Date(now.getTime() - this.SESSION_TIMEOUT);

      this.activeSessions.forEach((cache, sessionId) => {
        if (cache.lastAccessed < timeoutThreshold) {
          // Persist and evict timed-out session
          this.persistSession(sessionId).then(() => {
            this.activeSessions.delete(sessionId);
          });
        }
      });
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    activeSessions: number;
    totalPendingMessages: number;
    memoryUsage: number;
  } {
    let totalPending = 0;
    this.activeSessions.forEach(cache => {
      totalPending += cache.pendingMessages.length;
    });

    return {
      activeSessions: this.activeSessions.size,
      totalPendingMessages: totalPending,
      memoryUsage: this.activeSessions.size * 1024 // Rough estimate in bytes
    };
  }

  /**
   * Stop background processes (for testing)
   */
  stopBackgroundProcesses(): void {
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    // Clear all intervals
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Persist all sessions before cleanup
    const persistPromises = Array.from(this.activeSessions.keys()).map(sessionId => 
      this.persistSession(sessionId)
    );
    
    Promise.all(persistPromises).then(() => {
      this.activeSessions.clear();
    });
  }

  /**
   * Remove a session from the in-memory cache
   */
  removeSessionFromCache(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    console.log(`🗑️ ChatSessionManager: Removed session ${sessionId} from cache`);
  }

  /**
   * Clear all sessions from cache for a specific user
   */
  clearUserSessionsFromCache(userId: string): void {
    const sessionsToRemove = Array.from(this.activeSessions.keys())
      .filter(sessionId => {
        const cached = this.activeSessions.get(sessionId);
        return cached && cached.session.userId === userId;
      });
    
    sessionsToRemove.forEach(sessionId => {
      this.activeSessions.delete(sessionId);
    });
    
    console.log(`🗑️ ChatSessionManager: Cleared ${sessionsToRemove.length} sessions from cache for user ${userId}`);
  }

  /**
   * Clear all sessions from cache
   */
  clearAllSessionsFromCache(): void {
    const count = this.activeSessions.size;
    this.activeSessions.clear();
    console.log(`🗑️ ChatSessionManager: Cleared all ${count} sessions from cache`);
  }

  /**
   * Get all sessions for a specific user (from cache and Firestore)
   */
  async getUserSessions(userId: string): Promise<any[]> {
    try {
      // Get sessions from Firestore first
      const firestoreSessions = await FirestoreService.getChatSessions(userId);
      
      // Merge with in-memory sessions that might not be persisted yet
      const inMemorySessions = Array.from(this.activeSessions.values())
        .filter(cached => cached.session.userId === userId)
        .map(cached => cached.session);
      
      // Create a map of session IDs to avoid duplicates
      const sessionMap = new Map();
      
      // Add Firestore sessions first
      firestoreSessions.forEach(session => {
        sessionMap.set(session.id, session);
      });
      
      // Add in-memory sessions (these will override Firestore if they have more recent data)
      inMemorySessions.forEach(session => {
        const existing = sessionMap.get(session.id);
        if (!existing) {
          // No existing session, add the in-memory one
          sessionMap.set(session.id, session);
        } else {
          // Compare timestamps to determine which is more recent
          const existingTime = existing.timestamp || new Date(0);
          const inMemoryTime = session.timestamp || new Date(0);
          
          const existingDate = existingTime instanceof Date ? existingTime : new Date(existingTime);
          const inMemoryDate = inMemoryTime instanceof Date ? inMemoryTime : new Date(inMemoryTime);
          
          // Use the more recent session
          if (inMemoryDate.getTime() > existingDate.getTime()) {
            sessionMap.set(session.id, session);
          }
        }
      });
      
      // Convert back to array and sort by updatedAt
      const allSessions = Array.from(sessionMap.values());
      allSessions.sort((a, b) => {
        const aTime = a.updatedAt || a.createdAt || new Date(0);
        const bTime = b.updatedAt || b.createdAt || new Date(0);
        const aDate = aTime instanceof Date ? aTime : new Date(aTime);
        const bDate = bTime instanceof Date ? bTime : new Date(bTime);
        return bDate.getTime() - aDate.getTime();
      });
      
      
      return allSessions;
    } catch (error) {
      console.error('ChatSessionManager: Failed to get user sessions:', error);
      return [];
    }
  }
}

export default ChatSessionManager;
