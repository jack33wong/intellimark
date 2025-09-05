import { getStorage } from 'firebase-admin/storage';

/**
 * Service for managing image storage in Firebase Storage
 * Handles upload, download, and cleanup of marking images
 */
export class ImageStorageService {
  private static storage = getStorage();

  /**
   * Upload an image to Firebase Storage
   */
  static async uploadImage(
    imageData: string, 
    userId: string, 
    sessionId: string, 
    imageType: 'original' | 'annotated'
  ): Promise<string> {
    try {
      console.log(`🔍 Uploading ${imageType} image for user ${userId}, session ${sessionId}`);
      
      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substr(2, 9);
      const filename = `${imageType}-${timestamp}-${random}.jpg`;
      
      // Create storage reference
      const storageRef = this.storage.bucket().file(`marking-images/${userId}/${sessionId}/${filename}`);
      
      // Convert base64 to buffer
      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Upload image
      await storageRef.save(buffer, {
        metadata: {
          contentType: 'image/jpeg',
          metadata: {
            userId,
            sessionId,
            imageType,
            uploadedAt: new Date().toISOString()
          }
        }
      });
      
      // Get download URL
      const downloadURL = await storageRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500' // Far future date
      }).then(urls => urls[0]);
      console.log(`✅ ${imageType} image uploaded to Firebase Storage:`, downloadURL);
      
      return downloadURL;
    } catch (error) {
      console.error(`❌ Failed to upload ${imageType} image to Firebase Storage:`, error);
      throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete all images for a specific session
   */
  static async deleteSessionImages(userId: string, sessionId: string): Promise<void> {
    try {
      console.log(`🔍 Deleting images for session ${sessionId}, user ${userId}`);
      
      const bucket = this.storage.bucket();
      const prefix = `marking-images/${userId}/${sessionId}/`;
      
      // List all files with the prefix
      const [files] = await bucket.getFiles({ prefix });
      
      if (files.length === 0) {
        console.log('ℹ️ No images found for session:', sessionId);
        return;
      }
      
      // Delete each file
      const deletePromises = files.map(file => {
        console.log(`🗑️ Deleting image: ${file.name}`);
        return file.delete();
      });
      
      await Promise.all(deletePromises);
      
      console.log(`✅ Deleted ${files.length} images for session:`, sessionId);
    } catch (error) {
      console.error('❌ Failed to delete session images:', error);
      // Don't throw - cleanup should not fail the main operation
    }
  }

  /**
   * Delete all images for a specific user
   */
  static async deleteUserImages(userId: string): Promise<void> {
    try {
      console.log(`🔍 Deleting all images for user ${userId}`);
      
      const bucket = this.storage.bucket();
      const prefix = `marking-images/${userId}/`;
      
      // List all files with the prefix
      const [files] = await bucket.getFiles({ prefix });
      
      if (files.length === 0) {
        console.log('ℹ️ No images found for user:', userId);
        return;
      }
      
      // Delete each file
      const deletePromises = files.map(file => {
        console.log(`🗑️ Deleting image: ${file.name}`);
        return file.delete();
      });
      
      await Promise.all(deletePromises);
      
      console.log(`✅ Deleted ${files.length} images for user: ${userId}`);
    } catch (error) {
      console.error('❌ Failed to delete user images:', error);
    }
  }

  /**
   * Get image download URL by path
   */
  static async getImageUrl(imagePath: string): Promise<string> {
    try {
      const file = this.storage.bucket().file(imagePath);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-01-2500' // Far future date
      });
      return url;
    } catch (error) {
      console.error('❌ Failed to get image URL:', error);
      throw new Error(`Failed to get image URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
