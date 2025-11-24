import sharp from 'sharp';

/**
 * ImageUtils - Enhanced image processing for better AI classification
 */
export class ImageUtils {

  /**
   * Normalizes the image orientation based on EXIF data and optimizes encoding.
   * (Implementation remains the same as previous successful turns)
   */
  static async normalizeOrientation(imageData: string): Promise<string> {
    try {
      const startTime = Date.now();
      let imageBuffer: Buffer;
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL format');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        imageBuffer = Buffer.from(imageData, 'base64');
      }

      const normalizedBuffer = await sharp(imageBuffer)
        .rotate()
        .jpeg({ quality: 95, progressive: true })
        .toBuffer();

      const normalizedBase64 = normalizedBuffer.toString('base64');
      const normalizedDataUrl = `data:image/jpeg;base64,${normalizedBase64}`;

      return normalizedDataUrl;

    } catch (error) {
      console.error('❌ [IMAGE UTILS] Error normalizing orientation, returning original:', error);
      return imageData;
    }
  }

  /**
   * Preprocess image quality using techniques optimized for handwriting recognition.
   * Aims to remove shadows and normalize background without making handwriting look like print.
   * Assumes input image orientation is already normalized.
   * @param imageData Base64 image data (Normalized orientation, Color JPEG)
   * @returns Preprocessed base64 image data (Color JPEG)
   */
  static async preProcess(imageData: string): Promise<string> {
    try {
      const startTime = Date.now();
      let imageBuffer: Buffer;
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL format');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        imageBuffer = Buffer.from(imageData, 'base64');
      }

      // Strategy: Gentle background normalization and contrast enhancement.
      // We avoid CLAHE and aggressive Grayscaling which caused Mathpix misclassification.

      // 1. Normalize: Stretches the histogram to use the full dynamic range.
      // 2. Gamma Correction: Adjust mid-tones (values > 1 lighten mid-tones), helpful for shadows.
      // 3. Modulate: Slightly increase brightness and saturation.

      const processedBuffer = await sharp(imageBuffer)
        .normalize()
        .gamma(1.1) // Lighten mid-tones slightly (e.g., 1.1 to 1.2)
        .modulate({
          brightness: 1.05, // Slight brightness boost
          saturation: 1.1   // Slight saturation boost (preserves ink color characteristics)
        })
        .toBuffer();

      // 4. Final optimization
      const finalBuffer = await sharp(processedBuffer)
        // Light sharpening
        .sharpen()
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      const enhancedBase64 = finalBuffer.toString('base64');
      const enhancedDataUrl = `data:image/jpeg;base64,${enhancedBase64}`;

      // Updated logging message to reflect the new strategy
      return enhancedDataUrl;

    } catch (error) {
      console.error('❌ [IMAGE UTILS] Error enhancing image, returning original:', error);
      // Fallback to original image if processing fails
      return imageData;
    }
  }
  /**
   * Rotates an image by a specified angle.
   * @param imageData Base64 image data (Data URL or raw base64)
   * @param angle Angle in degrees (90, 180, 270)
   * @returns Rotated image buffer
   */
  static async rotateImage(imageData: string, angle: number): Promise<Buffer> {
    try {
      let imageBuffer: Buffer;
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL format');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        imageBuffer = Buffer.from(imageData, 'base64');
      }

      return await sharp(imageBuffer)
        .rotate(angle)
        .toBuffer();
    } catch (error) {
      console.error(`❌ [IMAGE UTILS] Error rotating image by ${angle} degrees:`, error);
      throw error;
    }
  }
}