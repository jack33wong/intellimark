/**
 * Chat Context Integration Tests
 * Tests the new chat context management system
 */

const { FirestoreService } = require('../services/firestoreService');

describe('Chat Context Integration', () => {
  beforeEach(() => {
    // Reset any mock state if needed
  });

  describe('Session Management', () => {
    test('should create a new chat session', async () => {
      const sessionData = {
        title: 'Test Session',
        messages: [],
        userId: 'test-user'
      };

      const sessionId = await FirestoreService.createChatSession(sessionData);
      
      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId).toContain('session-');
    });

    test('should retrieve chat sessions for a user', async () => {
      const sessions = await FirestoreService.getChatSessions('test-user');
      
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBeGreaterThan(0);
      
      const session = sessions[0];
      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('title');
      expect(session).toHaveProperty('messages');
      expect(session).toHaveProperty('timestamp');
      expect(session).toHaveProperty('userId');
    });

    test('should retrieve a specific chat session', async () => {
      const sessions = await FirestoreService.getChatSessions('test-user');
      const firstSession = sessions[0];
      
      const session = await FirestoreService.getChatSession(firstSession.id);
      
      expect(session).toBeDefined();
      expect(session.id).toBe(firstSession.id);
      expect(session.title).toBe(firstSession.title);
    });

    test('should add message to session', async () => {
      const sessions = await FirestoreService.getChatSessions('test-user');
      const firstSession = sessions[0];
      
      const message = {
        role: 'user',
        content: 'Test message'
      };

      const success = await FirestoreService.addMessageToSession(firstSession.id, message);
      
      expect(success).toBe(true);
    });

    test('should update chat session', async () => {
      const sessions = await FirestoreService.getChatSessions('test-user');
      const firstSession = sessions[0];
      
      const updates = {
        title: 'Updated Title'
      };

      const success = await FirestoreService.updateChatSession(firstSession.id, updates);
      
      expect(success).toBe(true);
    });

    test('should clear all sessions for a user', async () => {
      const success = await FirestoreService.clearAllSessions('test-user');
      
      expect(success).toBe(true);
    });
  });

  describe('Message Handling', () => {
    test('should handle messages with image data', async () => {
      const sessions = await FirestoreService.getChatSessions('test-user');
      const firstSession = sessions[0];
      
      const message = {
        role: 'user',
        content: 'Message with image',
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        imageName: 'test-image.png'
      };

      const success = await FirestoreService.addMessageToSession(firstSession.id, message);
      
      expect(success).toBe(true);
    });

    test('should handle messages with API usage info', async () => {
      const sessions = await FirestoreService.getChatSessions('test-user');
      const firstSession = sessions[0];
      
      const message = {
        role: 'assistant',
        content: 'AI response',
        apiUsed: 'OpenAI GPT-4'
      };

      const success = await FirestoreService.addMessageToSession(firstSession.id, message);
      
      expect(success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle non-existent session gracefully', async () => {
      const session = await FirestoreService.getChatSession('non-existent-id');
      
      expect(session).toBeNull();
    });

    test('should handle message addition to non-existent session', async () => {
      const message = {
        role: 'user',
        content: 'Test message'
      };

      const success = await FirestoreService.addMessageToSession('non-existent-id', message);
      
      expect(success).toBe(false);
    });
  });
});
