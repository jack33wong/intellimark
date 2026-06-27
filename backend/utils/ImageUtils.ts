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

  /**
   * Splits a wide image exactly down the middle vertically into two separate images (Left and Right).
   * @param imageData Base64 image data (Data URL or raw base64)
   * @returns Array of two Base64 Data URLs [LeftHalf, RightHalf]
   */
  static async splitImageVertically(imageData: string): Promise<string[]> {
    try {
      let imageBuffer: Buffer;
      const isDataUrl = imageData.startsWith('data:');
      const mimeType = isDataUrl ? imageData.split(';')[0].split(':')[1] || 'image/jpeg' : 'image/jpeg';
      
      if (isDataUrl) {
        const base64Data = imageData.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL format');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        imageBuffer = Buffer.from(imageData, 'base64');
      }

      const image = sharp(imageBuffer);
      const metadata = await image.metadata();

      if (!metadata.width || !metadata.height) {
        throw new Error('Unable to extract dimensions for splitting.');
      }

      const halfWidth = Math.floor(metadata.width / 2);

      // Extract left half
      const leftBuffer = await sharp(imageBuffer)
        .extract({ left: 0, top: 0, width: halfWidth, height: metadata.height })
        .toBuffer();

      // Extract right half
      const rightBuffer = await sharp(imageBuffer)
        .extract({ left: halfWidth, top: 0, width: metadata.width - halfWidth, height: metadata.height })
        .toBuffer();

      return [
        `data:${mimeType};base64,${leftBuffer.toString('base64')}`,
        `data:${mimeType};base64,${rightBuffer.toString('base64')}`
      ];
    } catch (error) {
      console.error(`❌ [IMAGE UTILS] Error splitting image vertically:`, error);
      throw error;
    }
  }

  /**
   * Creates a lightweight down-sampled copy of the image for fast AI classification.
   * Maintains aspect ratio while restricting maximum width to save token bandwidth.
   * @param imageData Base64 image data
   * @param maxWidth Maximum width in pixels (default: 800)
   * @returns Down-sampled base64 image data
   */
  static async createLightweightCopy(imageData: string, maxWidth: number = 800): Promise<string> {
    try {
      let imageBuffer: Buffer;
      let mimeType = 'image/jpeg';

      if (imageData.startsWith('data:')) {
        const matches = imageData.match(/^data:(image\/\w+);base64,/);
        if (matches) mimeType = matches[1];
        const base64Data = imageData.split(',')[1];
        if (!base64Data) throw new Error('Invalid data URL format');
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else {
        imageBuffer = Buffer.from(imageData, 'base64');
      }

      // 🛑 THE FIX: We MUST always compress to JPEG (quality: 80) even if the image is narrow!
      // Otherwise, an 800px wide 5MB raw PNG bypasses compression and kills network performance.
      const resizedBuffer = await sharp(imageBuffer)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality: 80 }) // Compress aggressively for vision model
        .toBuffer();
        
      return `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`;
    } catch (error) {
      console.error(`❌ [IMAGE UTILS] Error creating lightweight copy, falling back to original:`, error);
      return imageData;
    }
  }
}