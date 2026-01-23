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
  if (!session?.messages || session.messages.length === 0) {
    if (session?.imagesPreview && Array.isArray(session.imagesPreview)) {
      const sessionId = session.id || `unknown-${Date.now()}`;
      return session.imagesPreview.map((img: any, index: number) => ({
        id: `preview-${sessionId}-${index}`,
        src: img.src,
        filename: `preview-${index}`,
        messageId: 'preview',
        messageRole: img.role || 'assistant',
        messageType: 'preview',
        alt: 'Session preview image'
      }));
    }
    return [];
  }

  const annotatedImages: SessionImage[] = [];
  const originalImages: SessionImage[] = [];
  const seenImageSrcs = new Set<string>(); // Track by src to avoid duplicates


  // Process all messages to collect images
  session.messages.forEach((message) => {
    // Filter out potential placeholder ghost messages
    // Note: Assistant messages with no text content often have "ai-empty" in their ID.

    if (hasImage(message)) {
      // Determine if this message should be treated as annotated (primary markers)
      // Check type for 'marking_annotated' OR role for 'assistant'
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

            const imgObj = {
              id: `img-${message.id}-${index}`,
              src,
              filename,
              messageId: message.id,
              messageRole: message.role,
              messageType: message.type || 'unknown',
              alt: `${isAnnotated ? 'Annotated' : 'Original'} image ${index + 1} from ${message.role}`
            };

            if (isAnnotated) {
              annotatedImages.push(imgObj);
            } else {
              originalImages.push(imgObj);
            }
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

            const imgObj = {
              id: `img-${message.id}`,
              src,
              filename,
              messageId: message.id,
              messageRole: message.role,
              messageType: message.type || 'unknown',
              alt: `${isAnnotated ? 'Annotated' : 'Original'} image from ${message.role}`
            };

            if (isAnnotated) {
              annotatedImages.push(imgObj);
            } else {
              originalImages.push(imgObj);
            }
          }
        } catch (error) {
          console.warn('Failed to get image source for message:', message.id, error);
        }
      }
    }
  });

  // 👇 Deduplicate: If an annotated version of a filename exists, hide the original
  const annotatedBasenames = new Set(annotatedImages.map(img => img.filename?.replace(/^annotated-/, '')));
  const filteredOriginals = originalImages.filter(img => !annotatedBasenames.has(img.filename as string));

  return [...annotatedImages, ...filteredOriginals];
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

