/**
 * Image Storage Configuration
 * Configurable settings for image uploads, compression, and size limits
 */

export interface ImageStorageConfig {
  // Size limits
  maxFileSizeMB: number;
  maxWidth: number;
  maxHeight: number;

  // Compression settings
  compressionQuality: number;
  enableCompression: boolean;

  // Storage settings
  bucketName: string;
  defaultContentType: string;

  // File naming
  filenamePrefix: string;
  filenameSuffix: string;
}

export const IMAGE_STORAGE_CONFIG: ImageStorageConfig = {
  // Size limits (in MB)
  maxFileSizeMB: 50, // 50MB max file size

  // Image dimensions (pixels) - 2560x2560 to preserve crisp A4 portrait detail
  maxWidth: 2560,
  maxHeight: 2560,

  // Compression settings (1-100)
  compressionQuality: 88,
  enableCompression: true,

  // Storage settings
  bucketName: 'intellimark-6649e.firebasestorage.app', // Correct bucket name
  defaultContentType: 'image/jpeg',

  // File naming
  filenamePrefix: 'marking-images',
  filenameSuffix: '.jpg'
};

/**
 * Get image storage configuration
 */
export const getImageStorageConfig = (): ImageStorageConfig => {
  return IMAGE_STORAGE_CONFIG;
};

/**
 * Validate file size against configured limits
 */
export const validateFileSize = (buffer: Buffer, config: ImageStorageConfig = IMAGE_STORAGE_CONFIG): boolean => {
  const sizeMB = buffer.length / (1024 * 1024);
  return sizeMB <= config.maxFileSizeMB;
};

/**
 * Get file size in MB
 */
export const getFileSizeMB = (buffer: Buffer): number => {
  return buffer.length / (1024 * 1024);
};
