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
  badgeText?: string;
  badgeColor?: string;
}

/**
 * Check if a message has an image
 * @param message - UnifiedMessage to check
 * @returns boolean - True if message has image
 */
export const hasImage = (message: UnifiedMessage): boolean => {
  return !!(message.imageData || message.imageLink || (message.imageDataArray && message.imageDataArray.length > 0));
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
  const seenImageSrcs = new Set<string>(); // Track by src to avoid duplicates


  // Process all messages to collect images
  session.messages.forEach((message) => {
    if (hasImage(message)) {
      // Determine if this message should be treated as annotated (primary markers)
      const isAnnotated = message.type === 'marking_annotated' || message.role === 'assistant';

      // Handle imageDataArray (multiple images in one message)
      if (message.imageDataArray && message.imageDataArray.length > 0) {
        message.imageDataArray.forEach((imageItem: any, index: number) => {
          try {
            let imageData: string;
            let originalFileName: string | null = null;

            if (typeof imageItem === 'string') {
              imageData = imageItem;
            } else if (imageItem && typeof imageItem === 'object') {
              imageData = imageItem.imageData || imageItem.url || imageItem.imageLink || '';
              originalFileName = imageItem.originalFileName || imageItem.filename || null;
            } else {
              return;
            }

            if (!imageData || typeof imageData !== 'string') return;

            const tempMessage = {
              ...message,
              imageData: imageData,
              imageLink: undefined,
              imageDataArray: undefined
            };
            const src = getImageSrc(tempMessage);

            if (typeof src !== 'string' || seenImageSrcs.has(src)) {
              return;
            }
            seenImageSrcs.add(src);

            const finalFileName = originalFileName ||
              (message as any)?.originalFileName ||
              `image-${message.id}-${index}`;

            // Only prefix 'annotated-' if it's an assistant result
            const filename = isAnnotated ? `annotated-${finalFileName}` : finalFileName;

            images.push({
              id: `img-${message.id}-${index}`,
              src,
              filename,
              messageId: message.id,
              messageRole: message.role,
              messageType: message.type || 'unknown',
              alt: `${isAnnotated ? 'Annotated' : 'Original'} image ${index + 1} from ${message.role}`
            });
          } catch (error) {
            console.warn('Failed to get image source for message array item:', message.id, index, error);
          }
        });
      } else if (message.imageData || message.imageLink) {
        // Handle single image
        try {
          const src = getImageSrc(message);
          if (typeof src === 'string' && !seenImageSrcs.has(src)) {
            seenImageSrcs.add(src);
            const originalFileName = (message as any)?.originalFileName || `image-${message.id}`;
            const filename = isAnnotated ? `annotated-${originalFileName}` : originalFileName;

            images.push({
              id: `img-${message.id}`,
              src,
              filename,
              messageId: message.id,
              messageRole: message.role,
              messageType: message.type || 'unknown',
              alt: `${isAnnotated ? 'Annotated' : 'Original'} image from ${message.role}`
            });
          }
        } catch (error) {
          console.warn('Failed to get image source for message:', message.id, error);
        }
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

