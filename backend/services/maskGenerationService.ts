/**
 * Mask Generation Service
 * Creates masks for DALL·E Edit API to specify which areas can be modified
 */

import { Annotation } from '../types/index';

export interface MaskGenerationResult {
  maskDataUrl: string;
  maskBuffer: Buffer;
  dimensions: {
    width: number;
    height: number;
  };
}

export class MaskGenerationService {
  /**
   * Generate a mask for DALL·E Edit API based on annotation bounding boxes
   * @param originalImageDimensions - Dimensions of the original image
   * @param annotations - Array of annotations with bounding boxes
   * @param padding - Extra padding around annotation boxes (default: 10px)
   * @returns Base64 encoded PNG mask data URL
   */
  static async generateMask(
    originalImageDimensions: { width: number; height: number },
    annotations: Annotation[],
    padding: number = 10
  ): Promise<MaskGenerationResult> {
    try {
      console.log('🎭 Generating mask for DALL·E Edit API...');
      console.log(`📐 Image dimensions: ${originalImageDimensions.width}x${originalImageDimensions.height}`);
      console.log(`📝 Annotations count: ${annotations.length}`);

      // Create a canvas to draw the mask
      const { createCanvas } = await import('canvas');
      const canvas = createCanvas(originalImageDimensions.width, originalImageDimensions.height);
      const ctx = canvas.getContext('2d');

      // Fill entire canvas with black (areas to preserve)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, originalImageDimensions.width, originalImageDimensions.height);

      // For DALL·E Edit API, we need WHITE areas for editing
      // Set fill style to white for editable areas
      ctx.fillStyle = '#FFFFFF';
      ctx.globalCompositeOperation = 'source-over';
      
      for (const annotation of annotations) {
        if (!annotation) continue;
        const [x, y, width, height] = annotation.bbox;
        
        // Add padding around the annotation box
        const paddedX = Math.max(0, x - padding);
        const paddedY = Math.max(0, y - padding);
        const paddedWidth = Math.min(originalImageDimensions.width - paddedX, width + (padding * 2));
        const paddedHeight = Math.min(originalImageDimensions.height - paddedY, height + (padding * 2));
        
        // Double the height of the mask rectangle for better DALL·E editing
        const doubledHeight = Math.min(originalImageDimensions.height - paddedY, paddedHeight * 2);
        
        console.log(`🎯 Drawing mask for annotation: [${paddedX}, ${paddedY}, ${paddedWidth}, ${doubledHeight}] (height doubled)`);
      
        // Draw WHITE rectangles for editable areas
        ctx.fillRect(paddedX, paddedY, paddedWidth, doubledHeight);
        
        // Debug: Log the actual pixel values
        const imageData = ctx.getImageData(paddedX, paddedY, Math.min(10, paddedWidth), Math.min(10, doubledHeight));
        const pixelValues = Array.from(imageData.data.slice(0, 40)); // First 10 pixels
        console.log(`🔍 Sample mask pixels at [${paddedX}, ${paddedY}]:`, pixelValues);
      }

      // Convert canvas to PNG buffer
      const maskBuffer = canvas.toBuffer('image/png');
      
      // Create data URL
      const maskDataUrl = `data:image/png;base64,${maskBuffer.toString('base64')}`;

      console.log(`✅ Mask generated successfully: ${maskBuffer.length} bytes`);
      
      // Debug: Check if mask has transparent areas
      const imageData = ctx.getImageData(0, 0, originalImageDimensions.width, originalImageDimensions.height);
      const pixelData = imageData.data;
      let transparentPixels = 0;
      let blackPixels = 0;
      
      for (let i = 0; i < pixelData.length; i += 4) {
        const r = pixelData[i];
        const g = pixelData[i + 1];
        const b = pixelData[i + 2];
        const a = pixelData[i + 3]; // Alpha channel
        
        if (a === 0) {
          transparentPixels++;
        } else if (r === 0 && g === 0 && b === 0 && a === 255) {
          blackPixels++;
        }
      }
      
      console.log(`🔍 Mask analysis: ${transparentPixels} transparent pixels, ${blackPixels} black pixels`);
      console.log(`🔍 Transparent areas: ${transparentPixels > 0 ? '✅ Found' : '❌ None - mask will not work!'}`);

      return {
        maskDataUrl,
        maskBuffer,
        dimensions: originalImageDimensions
      };

    } catch (error) {
      console.error('❌ Error generating mask:', error);
      throw new Error(`Mask generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate a mask with transparent areas instead of white
   * Some APIs prefer transparent masks over white masks
   */
  static async generateTransparentMask(
    originalImageDimensions: { width: number; height: number },
    annotations: Annotation[],
    padding: number = 10
  ): Promise<MaskGenerationResult> {
    try {
      console.log('🎭 Generating transparent mask for DALL·E Edit API...');
      
      const { createCanvas } = await import('canvas');
      const canvas = createCanvas(originalImageDimensions.width, originalImageDimensions.height);
      const ctx = canvas.getContext('2d');

      // Fill entire canvas with black (areas to preserve)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, originalImageDimensions.width, originalImageDimensions.height);

      // For DALL·E Edit API, we need TRANSPARENT areas for editing
      ctx.globalCompositeOperation = 'destination-out';
      
      for (const annotation of annotations) {
        if (!annotation) continue;
        const [x, y, width, height] = annotation.bbox;
        
        // Add padding around the annotation box
        const paddedX = Math.max(0, x - padding);
        const paddedY = Math.max(0, y - padding);
        const paddedWidth = Math.min(originalImageDimensions.width - paddedX, width + (padding * 2));
        const paddedHeight = Math.min(originalImageDimensions.height - paddedY, height + (padding * 2));
        
        // Clear this area (make transparent for DALL·E Edit API)
        ctx.fillRect(paddedX, paddedY, paddedWidth, paddedHeight);
      }

      const maskBuffer = canvas.toBuffer('image/png');
      const maskDataUrl = `data:image/png;base64,${maskBuffer.toString('base64')}`;

      console.log(`✅ Transparent mask generated successfully: ${maskBuffer.length} bytes`);

      return {
        maskDataUrl,
        maskBuffer,
        dimensions: originalImageDimensions
      };

    } catch (error) {
      console.error('❌ Error generating transparent mask:', error);
      throw new Error(`Transparent mask generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that annotations fit within image dimensions
   */
  static validateAnnotations(
    annotations: Annotation[],
    imageDimensions: { width: number; height: number }
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (let i = 0; i < annotations.length; i++) {
      const annotation = annotations[i];
      const [x, y, width, height] = annotation.bbox;

      if (x < 0 || y < 0) {
        errors.push(`Annotation ${i}: Position (${x}, ${y}) is negative`);
      }

      if (x + width > imageDimensions.width) {
        errors.push(`Annotation ${i}: Right edge (${x + width}) exceeds image width (${imageDimensions.width})`);
      }

      if (y + height > imageDimensions.height) {
        errors.push(`Annotation ${i}: Bottom edge (${y + height}) exceeds image height (${imageDimensions.height})`);
      }

      if (width <= 0 || height <= 0) {
        errors.push(`Annotation ${i}: Invalid dimensions (${width}x${height})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
