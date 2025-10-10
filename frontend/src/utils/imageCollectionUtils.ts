/**
 * Image Collection Utilities
 * 
 * Utilities for collecting and managing images from session messages
 */

import type { UnifiedMessage, UnifiedSession } from '../types';
import { getImageSrc } from './imageSourceManager';

export interface SessionImage {
  id: string;
  src: string;
  filename: string | null;
  messageId: string;
  messageRole: 'user' | 'assistant' | 'system';
  messageType: string;
  alt: string;
}

/**
 * Check if a message has an image
 * @param message - UnifiedMessage to check
 * @returns boolean - True if message has image
 */
export const hasImage = (message: UnifiedMessage): boolean => {
  return !!(message.imageData || message.imageLink);
};

/**
 * Get all images from a session
 * @param session - UnifiedSession to extract images from
 * @returns SessionImage[] - Array of session images
 */
export const getSessionImages = (session: UnifiedSession | null): SessionImage[] => {
  if (!session?.messages) {
    return [];
  }

  const images: SessionImage[] = [];
  
  session.messages.forEach((message) => {
    if (hasImage(message)) {
      try {
        const src = getImageSrc(message);
        const filename = message.fileName || `image-${message.id}`;
        
        images.push({
          id: `img-${message.id}`,
          src,
          filename,
          messageId: message.id,
          messageRole: message.role,
          messageType: message.type || 'unknown',
          alt: `Image from ${message.role} message`
        });
      } catch (error) {
        console.warn('Failed to get image source for message:', message.id, error);
        // Skip this image but continue processing others
      }
    }
  });

  return images;
};

/**
 * Find the index of an image in the session images array
 * @param images - Array of session images
 * @param messageId - Message ID to find
 * @returns number - Index of the image, or -1 if not found
 */
export const findImageIndex = (images: SessionImage[], messageId: string): number => {
  return images.findIndex(img => img.messageId === messageId);
};

