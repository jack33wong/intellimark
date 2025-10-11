import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ImageUtils - Enhanced image processing for better AI classification
 */
export class ImageUtils {
  /**
   * Enhance image quality by programmatically removing shadows.
   * @param imageData Base64 image data
   * @returns Enhanced base64 image data
   */
  static async compressImage(imageData: string): Promise<string> {
    try {
      const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // STEP 1: Create a more precise and less intense shadow mask.
      const shadowMask = await sharp(imageBuffer)
        .greyscale()
        .negate()
        // Tweak 1: Reduce the blur for a tighter, more accurate mask.
        .blur(20) 
        // Tweak 2: Use a gentler linear adjustment to avoid over-brightening.
        .linear(1.2, -20) 
        .toBuffer();

      // STEP 2: Composite the mask onto the original image.
      const shadowRemovedBuffer = await sharp(imageBuffer)
        .composite([{
          input: shadowMask,
          blend: 'screen'
        }])
        .toBuffer();
        
      // STEP 3: Final adjustments for clarity and contrast.
      const finalBuffer = await sharp(shadowRemovedBuffer)
        // Tweak 3: Add normalize to restore natural contrast across the whole image.
        .normalize() 
        .modulate({
          contrast: 1.05 // A very slight contrast boost
        })
        .sharpen()
        .jpeg({ quality: 90, progressive: true })
        .toBuffer();

      const enhancedBase64 = finalBuffer.toString('base64');
      const enhancedDataUrl = `data:image/jpeg;base64,${enhancedBase64}`;
      
      await this.saveProcessedImage(finalBuffer, 'enhanced-final-v2');
      
      return enhancedDataUrl;
      
    } catch (error) {
      console.error('❌ [IMAGE UTILS] Error enhancing image:', error);
      return imageData;
    }
  }

  /**
   * Save processed image to backend for debugging
   * @param imageBuffer Processed image buffer
   * @param prefix Filename prefix
   */
  private static async saveProcessedImage(imageBuffer: Buffer, prefix: string): Promise<void> {
    try {
      // Create debug directory if it doesn't exist
      const debugDir = path.join(process.cwd(), 'debug-images');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      
      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${prefix}-${timestamp}.jpg`;
      const filepath = path.join(debugDir, filename);
      
      // Save the image
      fs.writeFileSync(filepath, imageBuffer);
      
      console.log(`🔍 [IMAGE UTILS] Saved processed image: ${filepath}`);
      
    } catch (error) {
      console.error('❌ [IMAGE UTILS] Error saving processed image:', error);
    }
  }
}


