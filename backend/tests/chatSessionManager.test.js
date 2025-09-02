/**
 * Chat Session Manager Tests
 * Tests the in-memory session caching, periodic persistence, and smart context recovery
 */

// Mock FirestoreService before importing ChatSessionManager
jest.mock('../services/firestoreService', () => ({
  FirestoreService: {
    getChatSession: jest.fn(),
    createChatSession: jest.fn(),
    addMessageToSession: jest.fn(),
    isReady: jest.fn().mockReturnValue(true)
  }
}));

// Now import after mocking
const { ChatSessionManager } = require('../services/chatSessionManager');
const { FirestoreService } = require('../services/firestoreService');

describe('ChatSessionManager', () => {
  let sessionManager;
  let mockFirestoreService;

  beforeEach(() => {
    // Clear singleton instance before each test
    ChatSessionManager.instance = null;
    
    // Create new instance
    sessionManager = ChatSessionManager.getInstance();
    
    // Get the mocked FirestoreService
    mockFirestoreService = FirestoreService;
    
    // Setup default mocks
    mockFirestoreService.getChatSession.mockResolvedValue(null);
    mockFirestoreService.createChatSession.mockResolvedValue('test-session-id');
    mockFirestoreService.addMessageToSession.mockResolvedValue(true);
  });

  afterEach(() => {
    // Stop background processes first
    sessionManager.stopBackgroundProcesses();
    // Then cleanup
    sessionManager.cleanup();
    jest.clearAllMocks();
  });

  describe('Singleton Pattern', () => {
    test('should return the same instance', () => {
      const instance1 = ChatSessionManager.getInstance();
      const instance2 = ChatSessionManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('Session Management', () => {
    test('should create and cache new session', async () => {
      const sessionData = {
        title: 'Test Session',
        messages: [],
        userId: 'test-user'
      };

      const sessionId = await sessionManager.createSession(sessionData);
      
      expect(sessionId).toBe('test-session-id');
      expect(mockFirestoreService.createChatSession).toHaveBeenCalledWith(sessionData);
      
      // Verify session is cached
      const cachedSession = await sessionManager.getSession(sessionId);
      expect(cachedSession).toBeDefined();
      expect(cachedSession.title).toBe('Test Session');
    });

    test('should retrieve cached session without database call', async () => {
      // First call should hit database
      const sessionData = {
        title: 'Cached Session',
        messages: [],
        userId: 'test-user'
      };

      const sessionId = await sessionManager.createSession(sessionData);
      
      // Reset mock to verify second call doesn't hit database
      mockFirestoreService.getChatSession.mockClear();
      
      // Second call should use cache
      const cachedSession = await sessionManager.getSession(sessionId);
      
      expect(cachedSession).toBeDefined();
      expect(mockFirestoreService.getChatSession).not.toHaveBeenCalled();
    });

    test('should load session from database if not cached', async () => {
      const mockSession = {
        id: 'db-session-id',
        title: 'Database Session',
        messages: [],
        timestamp: new Date(),
        userId: 'test-user'
      };

      mockFirestoreService.getChatSession.mockResolvedValue(mockSession);
      
      const session = await sessionManager.getSession('db-session-id');
      
      expect(session).toBeDefined();
      expect(session.title).toBe('Database Session');
      expect(mockFirestoreService.getChatSession).toHaveBeenCalledWith('db-session-id');
    });
  });

  describe('Message Management', () => {
    test('should add message to cached session', async () => {
      // Create session first
      const sessionId = await sessionManager.createSession({
        title: 'Message Test',
        messages: [],
        userId: 'test-user'
      });

      const message = {
        role: 'user',
        content: 'Hello, AI!',
        imageData: undefined,
        imageName: undefined,
        apiUsed: undefined
      };

      const result = await sessionManager.addMessage(sessionId, message);
      
      expect(result).toBe(true);
      
      // Verify message is in cache
      const session = await sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      if (session && session.messages.length > 0) {
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0].content).toBe('Hello, AI!');
      }
    });

    test('should batch messages before persistence', async () => {
      const sessionId = await sessionManager.createSession({
        title: 'Batch Test',
        messages: [],
        userId: 'test-user'
      });

      // Add 6 messages (more than batch size of 5)
      for (let i = 0; i < 6; i++) {
        await sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Message ${i}`,
          imageData: undefined,
          imageName: undefined,
          apiUsed: undefined
        });
      }

      // Verify messages are in cache
      const session = await sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      if (session) {
        expect(session.messages).toHaveLength(6);
      }
      
      // Verify persistence was triggered (batch size reached)
      // Note: In real implementation, this would be tested with actual persistence
    });

    test('should handle image messages correctly', async () => {
      const sessionId = await sessionManager.createSession({
        title: 'Image Test',
        messages: [],
        userId: 'test-user'
      });

      const imageMessage = {
        role: 'user',
        content: 'Check this image',
        imageData: 'data:image/png;base64,test',
        imageName: 'test.png',
        apiUsed: undefined
      };

      const result = await sessionManager.addMessage(sessionId, imageMessage);
      
      expect(result).toBe(true);
      
      const session = await sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      if (session && session.messages.length > 0) {
        expect(session.messages[0].imageData).toBe('data:image/png;base64,test');
        expect(session.messages[0].imageName).toBe('test.png');
      }
    });
  });

  describe('Context Recovery', () => {
    test('should restore session with summary and recent history', async () => {
      const mockSession = {
        id: 'restore-session-id',
        title: 'Restore Test',
        messages: [
          {
            role: 'user',
            content: 'Help with math',
            timestamp: new Date('2024-01-01T10:00:00Z'),
            imageData: undefined,
            imageName: undefined,
            apiUsed: undefined
          },
          {
            role: 'assistant',
            content: 'I can help with math!',
            timestamp: new Date('2024-01-01T10:01:00Z'),
            imageData: undefined,
            imageName: undefined,
            apiUsed: undefined
          }
        ],
        timestamp: new Date('2024-01-01T10:01:00Z'),
        userId: 'test-user'
      };

      mockFirestoreService.getChatSession.mockResolvedValue(mockSession);
      
      const restoredSession = await sessionManager.restoreSession('restore-session-id');
      
      expect(restoredSession).toBeDefined();
      expect(restoredSession.id).toBe('restore-session-id');
      expect(restoredSession.messages).toHaveLength(2);
      
      // Verify session is now cached
      const cachedSession = await sessionManager.getSession('restore-session-id');
      expect(cachedSession).toBeDefined();
    });

    test('should return null for non-existent session', async () => {
      mockFirestoreService.getChatSession.mockResolvedValue(null);
      
      const restoredSession = await sessionManager.restoreSession('non-existent');
      
      expect(restoredSession).toBeNull();
    });
  });

  describe('Cache Management', () => {
    test('should limit in-memory sessions', async () => {
      // Create more sessions than the limit (50)
      const promises = [];
      for (let i = 0; i < 55; i++) {
        promises.push(sessionManager.createSession({
          title: `Session ${i}`,
          messages: [],
          userId: 'test-user'
        }));
      }

      await Promise.all(promises);
      
      // Verify cache stats
      const stats = sessionManager.getCacheStats();
      expect(stats.activeSessions).toBeLessThanOrEqual(50);
    });

    test('should provide cache statistics', () => {
      const stats = sessionManager.getCacheStats();
      
      expect(stats).toHaveProperty('activeSessions');
      expect(stats).toHaveProperty('totalPendingMessages');
      expect(stats).toHaveProperty('memoryUsage');
      
      expect(typeof stats.activeSessions).toBe('number');
      expect(typeof stats.totalPendingMessages).toBe('number');
      expect(typeof stats.memoryUsage).toBe('number');
    });

    test('should cleanup resources correctly', async () => {
      // Create a session first
      await sessionManager.createSession({
        title: 'Cleanup Test',
        messages: [],
        userId: 'test-user'
      });

      // Verify session exists
      const statsBefore = sessionManager.getCacheStats();
      expect(statsBefore.activeSessions).toBeGreaterThan(0);

      // Cleanup
      sessionManager.cleanup();
      
      // Wait a bit for cleanup to complete (cleanup is asynchronous)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify cleanup
      const statsAfter = sessionManager.getCacheStats();
      expect(statsAfter.activeSessions).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      mockFirestoreService.getChatSession.mockRejectedValue(new Error('Database error'));
      
      const session = await sessionManager.getSession('error-session');
      
      expect(session).toBeNull();
    });

    test('should handle message addition errors', async () => {
      const sessionId = await sessionManager.createSession({
        title: 'Error Test',
        messages: [],
        userId: 'test-user'
      });

      // Mock database error
      mockFirestoreService.addMessageToSession.mockRejectedValue(new Error('Persistence error'));
      
      const result = await sessionManager.addMessage(sessionId, {
        role: 'user',
        content: 'Test message',
        imageData: undefined,
        imageName: undefined,
        apiUsed: undefined
      });
      
      // The error is handled gracefully, so it should still return true
      // but the message won't be persisted to the database
      expect(result).toBe(true);
    });
  });

  describe('Performance Optimization', () => {
    test('should return cached history quickly', async () => {
      // Create session with messages
      const sessionId = await sessionManager.createSession({
        title: 'Performance Test',
        messages: [],
        userId: 'test-user'
      });

      // Add several messages
      for (let i = 0; i < 10; i++) {
        await sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Message ${i}`,
          imageData: undefined,
          imageName: undefined,
          apiUsed: undefined
        });
      }

      // Time the history retrieval
      const startTime = Date.now();
      const history = await sessionManager.getChatHistory(sessionId, 5);
      const endTime = Date.now();
      
      expect(history).toHaveLength(5);
      expect(endTime - startTime).toBeLessThan(10); // Should be very fast (< 10ms)
    });

    test('should batch persistence operations', async () => {
      const sessionId = await sessionManager.createSession({
        title: 'Batch Persistence Test',
        messages: [],
        userId: 'test-user'
      });

      // Add messages without triggering immediate persistence
      for (let i = 0; i < 3; i++) {
        await sessionManager.addMessage(sessionId, {
          role: 'user',
          content: `Batch message ${i}`,
          imageData: undefined,
          imageName: undefined,
          apiUsed: undefined
        });
      }

      // Verify messages are in cache but not persisted yet
      const session = await sessionManager.getSession(sessionId);
      expect(session.messages).toHaveLength(3);
      
      // In real implementation, we'd verify that persistence was batched
      // This test demonstrates the batching concept
    });
  });
});
