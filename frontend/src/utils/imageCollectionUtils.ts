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
  
  // For marking sessions OR mixed sessions (which can contain marking content), ONLY include annotated images (final output)
  // Find the marking_annotated message which contains the final results
  if (session.messageType === 'Marking' || session.messageType === 'Mixed') {
    // Try to find marking_annotated message first
    let annotatedMessage = session.messages.find(
      m => m.type === 'marking_annotated' && hasImage(m)
    );
    
    // Fallback: if no marking_annotated found, look for any assistant message with images
    if (!annotatedMessage) {
      annotatedMessage = session.messages.find(
        m => m.role === 'assistant' && hasImage(m) && m.type !== 'marking_original'
      );
    }
    
    if (!annotatedMessage) {
      return images; // Return empty if no annotated message found
    }
    
    // Store in const so TypeScript knows it's defined in callbacks
    const message = annotatedMessage;
    
    // Only process the annotated message
    if (message.imageDataArray && message.imageDataArray.length > 0) {
      message.imageDataArray.forEach((imageItem: any, index: number) => {
        try {
          // Handle both string (base64) and object formats
          let imageData: string;
          let originalFileName: string | null = null;
          
          if (typeof imageItem === 'string') {
            // Direct base64 string
            imageData = imageItem;
          } else if (imageItem && typeof imageItem === 'object') {
            // Object with url, imageData, or other properties
            imageData = imageItem.imageData || imageItem.url || imageItem.imageLink || '';
            originalFileName = imageItem.originalFileName || imageItem.filename || null;
          } else {
            return; // Skip invalid format
          }
          
          if (!imageData || typeof imageData !== 'string') {
            return; // Skip invalid image data
          }
          
          // Create a temporary message object with this single image for getImageSrc
          const tempMessage = {
            ...message,
            imageData: imageData,
            imageLink: undefined,
            imageDataArray: undefined
          };
          const src = getImageSrc(tempMessage);
          
          // Ensure src is a string and not a duplicate
          if (typeof src !== 'string' || seenImageSrcs.has(src)) {
            return; // Skip if not string or duplicate
          }
          seenImageSrcs.add(src);
          
          // Use originalFileName from item, or fallback to message or generate
          const finalFileName = originalFileName || 
                               (message as any)?.originalFileName || 
                               `image-${message.id}-${index}`;
          const filename = `annotated-${finalFileName}`;
          
          images.push({
            id: `img-${message.id}-${index}`,
            src,
            filename,
            messageId: message.id,
            messageRole: message.role,
            messageType: message.type || 'unknown',
            alt: `Image ${index + 1} from ${message.role} message`
          });
        } catch (error) {
          console.warn('Failed to get image source for annotated message array item:', message.id, index, error);
        }
      });
    } else if (message.imageData || message.imageLink) {
      // Handle single annotated image
      try {
        const src = getImageSrc(message);
        if (typeof src === 'string' && !seenImageSrcs.has(src)) {
          seenImageSrcs.add(src);
          const originalFileName = (message as any)?.originalFileName || 
                                  `image-${message.id}`;
          const filename = `annotated-${originalFileName}`;
          
          images.push({
            id: `img-${message.id}`,
            src,
            filename,
            messageId: message.id,
            messageRole: message.role,
            messageType: message.type || 'unknown',
            alt: `Image from ${message.role} message`
          });
        }
      } catch (error) {
        console.warn('Failed to get image source for annotated message:', message.id, error);
      }
    }
    // Return early for marking sessions - only annotated images
    return images;
  }
  
  // For non-marking sessions, process all messages
  session.messages.forEach((message) => {
    if (hasImage(message)) {
      
      // Handle imageDataArray (multiple images in one message)
      if (message.imageDataArray && message.imageDataArray.length > 0) {
        message.imageDataArray.forEach((imageItem: any, index: number) => {
          try {
            // Handle both string (base64) and object formats
            let imageData: string;
            let originalFileName: string | null = null;
            
            if (typeof imageItem === 'string') {
              // Direct base64 string
              imageData = imageItem;
            } else if (imageItem && typeof imageItem === 'object') {
              // Object with url, imageData, or other properties
              imageData = imageItem.imageData || imageItem.url || imageItem.imageLink || '';
              originalFileName = imageItem.originalFileName || imageItem.filename || null;
            } else {
              console.warn('Invalid imageDataArray item format:', imageItem);
              return; // Skip this item
            }
            
            if (!imageData) {
              console.warn('No image data found in imageDataArray item:', imageItem);
              return; // Skip this item
            }
            
            // Ensure imageData is a string
            if (typeof imageData !== 'string') {
              console.warn('imageData is not a string:', typeof imageData, imageData);
              return; // Skip this item
            }
            
            // Check for duplicate by src (actual image content)
            const tempMessageForSrc = {
              ...message,
              imageData: imageData,
              imageLink: undefined,
              imageDataArray: undefined
            };
            let src: string;
            try {
              src = getImageSrc(tempMessageForSrc);
            } catch {
              return; // Skip if can't get src
            }
            
            if (typeof src !== 'string' || seenImageSrcs.has(src)) {
              return; // Skip if not string or duplicate
            }
            seenImageSrcs.add(src);
            
            
            // Use originalFileName from item, or fallback to message or generate
            const finalFileName = originalFileName || 
                                 (message as any)?.originalFileName || 
                                 `image-${message.id}-${index}`;
            const filename = `annotated-${finalFileName}`;
            
            images.push({
              id: `img-${message.id}-${index}`,
              src,
              filename,
              messageId: message.id,
              messageRole: message.role,
              messageType: message.type || 'unknown',
              alt: `Image ${index + 1} from ${message.role} message`
            });
          } catch (error) {
            console.warn('Failed to get image source for message array item:', message.id, index, error);
            // Skip this image but continue processing others
          }
        });
      } else {
        // Handle single image (imageData or imageLink)
        try {
          const src = getImageSrc(message);
          if (typeof src !== 'string' || seenImageSrcs.has(src)) {
            return; // Skip if not string or duplicate
          }
          seenImageSrcs.add(src);
          
          // Generate proper annotated filename with prefix
          const originalFileName = (message as any)?.originalFileName || 
                                  `image-${message.id}`;
          const filename = `annotated-${originalFileName}`;
          
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

