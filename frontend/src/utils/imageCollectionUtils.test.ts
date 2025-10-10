/**
 * Tests for Image Collection Utilities
 */

import { getSessionImages, findImageIndex, hasImage } from './imageCollectionUtils';
import type { UnifiedSession, UnifiedMessage } from '../types';

describe('imageCollectionUtils', () => {
  const mockSession: UnifiedSession = {
    id: 'test-session',
    title: 'Test Session',
    messages: [
      {
        id: 'msg1',
        messageId: 'msg1',
        role: 'user',
        content: 'Hello',
        imageData: 'data:image/jpeg;base64,test1',
        fileName: 'user-image.jpg',
        timestamp: '2024-01-01T00:00:00Z',
        userId: 'user1',
        sessionId: 'test-session'
      },
      {
        id: 'msg2',
        messageId: 'msg2',
        role: 'assistant',
        content: 'Response',
        timestamp: '2024-01-01T00:01:00Z',
        userId: 'user1',
        sessionId: 'test-session'
      },
      {
        id: 'msg3',
        messageId: 'msg3',
        role: 'assistant',
        content: 'Annotated response',
        imageLink: 'https://example.com/annotated.jpg',
        fileName: 'annotated-image.jpg',
        type: 'marking_annotated',
        timestamp: '2024-01-01T00:02:00Z',
        userId: 'user1',
        sessionId: 'test-session'
      }
    ],
    userId: 'user1',
    messageType: 'Marking',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:02:00Z'
  };

  describe('hasImage', () => {
    it('should return true for messages with imageData', () => {
      const message: UnifiedMessage = {
        id: 'test',
        messageId: 'test',
        role: 'user',
        content: 'test',
        imageData: 'data:image/jpeg;base64,test',
        timestamp: '2024-01-01T00:00:00Z',
        userId: 'user1',
        sessionId: 'session1'
      };
      expect(hasImage(message)).toBe(true);
    });

    it('should return true for messages with imageLink', () => {
      const message: UnifiedMessage = {
        id: 'test',
        messageId: 'test',
        role: 'user',
        content: 'test',
        imageLink: 'https://example.com/image.jpg',
        timestamp: '2024-01-01T00:00:00Z',
        userId: 'user1',
        sessionId: 'session1'
      };
      expect(hasImage(message)).toBe(true);
    });

    it('should return false for messages without images', () => {
      const message: UnifiedMessage = {
        id: 'test',
        messageId: 'test',
        role: 'user',
        content: 'test',
        timestamp: '2024-01-01T00:00:00Z',
        userId: 'user1',
        sessionId: 'session1'
      };
      expect(hasImage(message)).toBe(false);
    });
  });

  describe('getSessionImages', () => {
    it('should extract all images from session messages', () => {
      const images = getSessionImages(mockSession);
      
      expect(images).toHaveLength(2);
      expect(images[0]).toEqual({
        id: 'img-msg1',
        src: 'data:image/jpeg;base64,test1',
        filename: 'user-image.jpg',
        messageId: 'msg1',
        messageRole: 'user',
        messageType: 'unknown',
        alt: 'Image from user message'
      });
      expect(images[1]).toEqual({
        id: 'img-msg3',
        src: 'https://example.com/annotated.jpg',
        filename: 'annotated-image.jpg',
        messageId: 'msg3',
        messageRole: 'assistant',
        messageType: 'marking_annotated',
        alt: 'Image from assistant message'
      });
    });

    it('should return empty array for session without messages', () => {
      const emptySession: UnifiedSession = {
        id: 'empty',
        title: 'Empty',
        messages: [],
        userId: 'user1',
        messageType: 'Chat',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
      };
      
      expect(getSessionImages(emptySession)).toEqual([]);
    });

    it('should return empty array for null session', () => {
      expect(getSessionImages(null)).toEqual([]);
    });
  });

  describe('findImageIndex', () => {
    it('should find correct index for existing message', () => {
      const images = getSessionImages(mockSession);
      expect(findImageIndex(images, 'msg1')).toBe(0);
      expect(findImageIndex(images, 'msg3')).toBe(1);
    });

    it('should return -1 for non-existent message', () => {
      const images = getSessionImages(mockSession);
      expect(findImageIndex(images, 'nonexistent')).toBe(-1);
    });
  });
});
