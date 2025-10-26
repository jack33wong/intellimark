/**
 * Message Factory for clean separation of database and response objects
 * Prevents object reuse issues and ensures maintainability
 */

import { FilenameService } from './filenameService.js';

/**
 * Message Factory for creating database and response messages
 */
export class MessageFactory {
  /**
   * Create messages for database storage (Firebase URLs only)
   * @param userMessage - User message object
   * @param aiMessage - AI message object
   * @returns Deep copy of messages with Firebase URLs
   */
  static createForDatabase(userMessage: any, aiMessage: any): any[] {
    return [
      this.deepCopyMessage(userMessage),
      this.deepCopyMessage(aiMessage)
    ];
  }

  /**
   * Create messages for frontend response (Base64 URLs)
   * @param dbMessages - Database messages with Firebase URLs
   * @returns New messages with Base64 URLs for immediate display
   */
  static createForResponse(dbMessages: any[]): any[] {
    return dbMessages.map(msg => this.convertToResponseFormat(msg));
  }

  /**
   * Convert database message to response format
   * FIXED: Follows design - User messages get Base64, Assistant messages keep Firebase URLs
   * @param dbMessage - Database message with Firebase URLs
   * @returns Response message with appropriate format
   */
  private static convertToResponseFormat(dbMessage: any): any {
    const responseMessage = this.deepCopyMessage(dbMessage);
    
    // FIXED: Only convert User messages to Base64, keep Assistant messages as Firebase URLs
    if (responseMessage.role === 'user' && responseMessage.imageDataArray) {
      responseMessage.imageDataArray = responseMessage.imageDataArray.map((img: any) => ({
        ...img,
        url: this.convertFirebaseUrlToBase64(img.url)
      }));
    }
    // Assistant messages keep Firebase URLs (no conversion needed)

    // Convert pdfContexts URLs from Firebase to Base64 (for user messages only)
    if (responseMessage.role === 'user' && responseMessage.pdfContexts) {
      responseMessage.pdfContexts = responseMessage.pdfContexts.map((pdf: any) => ({
        ...pdf,
        url: this.convertFirebaseUrlToBase64(pdf.url)
      }));
    }
    // Assistant messages keep Firebase URLs for pdfContexts too

    return responseMessage;
  }

  /**
   * Convert Firebase URL to Base64
   * @param firebaseUrl - Firebase storage URL
   * @returns Base64 data URL
   */
  private static async convertFirebaseUrlToBase64(firebaseUrl: string): Promise<string> {
    try {
      // For now, return Firebase URL as-is to prevent breaking
      // TODO: Implement actual Firebase URL to Base64 conversion
      // This would involve downloading the image from Firebase and converting to base64
      return firebaseUrl;
    } catch (error) {
      console.error('❌ Failed to convert Firebase URL to Base64:', error);
      return firebaseUrl; // Fallback to Firebase URL
    }
  }

  /**
   * Deep copy message object to prevent side effects
   * @param message - Message object to copy
   * @returns Deep copy of message
   */
  private static deepCopyMessage(message: any): any {
    return JSON.parse(JSON.stringify(message));
  }

  /**
   * Update message filenames with proper patterns
   * @param message - Message object
   * @param isAnnotated - Whether this is an annotated image
   * @returns Message with updated filenames
   */
  static updateFilenames(message: any, isAnnotated: boolean = false): any {
    const updatedMessage = this.deepCopyMessage(message);
    
    if (updatedMessage.imageDataArray) {
      updatedMessage.imageDataArray = updatedMessage.imageDataArray.map((img: any) => ({
        ...img,
        originalFileName: isAnnotated 
          ? FilenameService.generateAnnotatedFilename(img.originalFileName)
          : FilenameService.generateOriginalFilename(img.originalFileName)
      }));
    }

    return updatedMessage;
  }
}
