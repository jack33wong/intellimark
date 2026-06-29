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

      // Strategy: Grayscale Hack + Normalize for Mathpix.
      // This drops the file size by 60%+ while making the text pure black on white.
      const finalBuffer = await sharp(imageBuffer)
        .resize({ width: 2000, withoutEnlargement: true }) // The ~240 DPI sweet spot for Mathpix
        .grayscale() // CRITICAL: Drops file size by 66% (1 channel instead of 3 RGB channels)
        .normalize() // CRITICAL: Forces background to pure white and text to pure black
        .sharpen() // Hardens the edges of faint decimal points
        .webp({ quality: 90 }) // Avoids JPEG blurring artifacts
        .toBuffer();

      const enhancedBase64 = finalBuffer.toString('base64');
      const enhancedDataUrl = `data:image/webp;base64,${enhancedBase64}`;

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

      // Tier 2 (Low-Res): Extremely lightweight copy for Gemini
      const resizedBuffer = await sharp(imageBuffer)
        .resize({ width: maxWidth, withoutEnlargement: true })
        .webp({ quality: 70 }) // Extremely lightweight
        .toBuffer();
        
      return `data:image/webp;base64,${resizedBuffer.toString('base64')}`;
    } catch (error) {
      console.error(`❌ [IMAGE UTILS] Error creating lightweight copy, falling back to original:`, error);
      return imageData;
    }
  }
}