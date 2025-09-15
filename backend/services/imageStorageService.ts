import { getStorage } from 'firebase-admin/storage';
import { getFirebaseAdmin } from '../config/firebase';
import { getImageStorageConfig, validateFileSize, getFileSizeMB } from '../config/imageStorage';
import sharp from 'sharp';

/**
 * Service for managing image storage in Firebase Storage
 * Handles upload, download, and cleanup of marking images
 */
export class ImageStorageService {
  private static getStorage() {
    const app = getFirebaseAdmin();
    if (!app) {
      throw new Error('Firebase Admin not initialized');
    }
    return getStorage(app);
  }

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
      
      // Get configuration
      const config = getImageStorageConfig();
      
      // Generate unique filename
      const timestamp = Date.now();
      const random = Math.random().toString(36).substr(2, 9);
      const filename = `${imageType}-${timestamp}-${random}${config.filenameSuffix}`;
      
      // Create storage reference
      const storageRef = this.getStorage().bucket(config.bucketName).file(`${config.filenamePrefix}/${userId}/${sessionId}/${filename}`);
      
      // Convert base64 to buffer
      const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const originalBuffer = Buffer.from(base64Data, 'base64');
      
      // Validate original file size
      if (!validateFileSize(originalBuffer, config)) {
        const sizeMB = getFileSizeMB(originalBuffer);
        throw new Error(`Image too large: ${sizeMB.toFixed(2)}MB (max: ${config.maxFileSizeMB}MB)`);
      }
      
      console.log(`📊 Original image size: ${getFileSizeMB(originalBuffer).toFixed(2)}MB`);
      
      // Process image (compress and resize if enabled)
      let processedBuffer: Buffer = originalBuffer;
      let compressionApplied = false;
      
      if (config.enableCompression) {
        try {
          processedBuffer = await sharp(originalBuffer as any)
            .resize(config.maxWidth, config.maxHeight, {
              fit: 'inside',
              withoutEnlargement: true
            })
            .jpeg({ 
              quality: config.compressionQuality,
              progressive: true 
            })
            .toBuffer();
          
          compressionApplied = true;
          console.log(`📊 Compressed image size: ${getFileSizeMB(processedBuffer).toFixed(2)}MB`);
          console.log(`📊 Compression ratio: ${((1 - processedBuffer.length / originalBuffer.length) * 100).toFixed(1)}%`);
        } catch (compressionError) {
          console.warn(`⚠️ Compression failed, using original image:`, compressionError);
          processedBuffer = originalBuffer;
        }
      }
      
      // Final size validation
      if (!validateFileSize(processedBuffer, config)) {
        const sizeMB = getFileSizeMB(processedBuffer);
        throw new Error(`Processed image still too large: ${sizeMB.toFixed(2)}MB (max: ${config.maxFileSizeMB}MB)`);
      }
      
      // Upload image
      await storageRef.save(processedBuffer, {
        metadata: {
          contentType: config.defaultContentType,
          metadata: {
            userId,
            sessionId,
            imageType,
            uploadedAt: new Date().toISOString(),
            originalSizeMB: getFileSizeMB(originalBuffer).toFixed(2),
            processedSizeMB: getFileSizeMB(processedBuffer).toFixed(2),
            compressionApplied: compressionApplied.toString(),
            compressionQuality: config.compressionQuality.toString(),
            maxDimensions: `${config.maxWidth}x${config.maxHeight}`
          }
        }
      });
      
      // Get download URL
      const downloadURL = await storageRef.getSignedUrl({
        action: 'read',
        expires: '03-01-2500' // Far future date
      }).then(urls => urls[0]);
      
      console.log(`📊 Final size: ${getFileSizeMB(processedBuffer).toFixed(2)}MB`);
      
      return downloadURL;
    } catch (error) {
      console.error(`❌ Failed to upload ${imageType} image to Firebase Storage:`, error);
      throw new Error(`Image upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download an image from Firebase Storage and convert to base64 data URL
   */
  static async downloadImageAsBase64(firebaseStorageURL: string): Promise<string> {
    try {
      
      // Extract the file path from the Firebase Storage URL
      const url = new URL(firebaseStorageURL);
      const pathMatch = url.pathname.match(/\/o\/(.+?)\?/);
      if (!pathMatch) {
        throw new Error('Invalid Firebase Storage URL format');
      }
      
      const filePath = decodeURIComponent(pathMatch[1]);
      
      // Get storage reference
      const config = getImageStorageConfig();
      const storageRef = this.getStorage().bucket(config.bucketName).file(filePath);
      
      // Download the file
      const [fileBuffer] = await storageRef.download();
      
      // Convert to base64
      const base64Data = fileBuffer.toString('base64');
      
      // Determine content type from file extension or use default
      const contentType = filePath.toLowerCase().includes('.png') ? 'image/png' : 
                         filePath.toLowerCase().includes('.webp') ? 'image/webp' : 
                         filePath.toLowerCase().includes('.jpg') || filePath.toLowerCase().includes('.jpeg') ? 'image/jpeg' :
                         'image/jpeg'; // default
      
      const dataURL = `data:${contentType};base64,${base64Data}`;
      console.log('✅ Image downloaded and converted to base64 data URL');
      
      return dataURL;
    } catch (error) {
      console.error('❌ Failed to download image from Firebase Storage:', error);
      throw new Error(`Image download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete all images for a specific session
   */
  static async deleteSessionImages(userId: string, sessionId: string): Promise<void> {
    try {
      
      const config = getImageStorageConfig();
      const bucket = this.getStorage().bucket(config.bucketName);
      const prefix = `${config.filenamePrefix}/${userId}/${sessionId}/`;
      
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
      
      const config = getImageStorageConfig();
      const bucket = this.getStorage().bucket(config.bucketName);
      const prefix = `${config.filenamePrefix}/${userId}/`;
      
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
      const config = getImageStorageConfig();
      const file = this.getStorage().bucket(config.bucketName).file(imagePath);
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
