import sharp from 'sharp';

/**
 * ImageUtils - Enhanced image processing for better AI classification
 */
export class ImageUtils {
  /**
   * Preprocess image quality by programmatically removing shadows, enhancing contrast, and optimizing for AI processing.
   * @param imageData Base64 image data
   * @returns Preprocessed base64 image data
   */
  static async preProcess(imageData: string): Promise<string> {
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
          brightness: 1.0,
          saturation: 1.0,
          hue: 0
        })
        .sharpen()
        .jpeg({ quality: 90, progressive: true })
        .toBuffer();

      const enhancedBase64 = finalBuffer.toString('base64');
      const enhancedDataUrl = `data:image/jpeg;base64,${enhancedBase64}`;
      
      return enhancedDataUrl;
      
    } catch (error) {
      console.error('❌ [IMAGE UTILS] Error enhancing image:', error);
      return imageData;
    }
  }

}


