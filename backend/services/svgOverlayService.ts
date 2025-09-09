/**
 * SVG Overlay Service for burning SVG annotations into images
 * Converts SVG overlays to permanent image annotations
 */

import sharp from 'sharp';
import { Annotation, ImageDimensions } from '../types/index';

/**
 * SVG Overlay Service class
 */
export class SVGOverlayService {




  /**
   * Alternative method using server-side image processing with Sharp
   * This version works in Node.js environment without DOM
   */
  static async burnSVGOverlayServerSide(
    originalImageData: string,
    annotations: Annotation[],
    imageDimensions: ImageDimensions
  ): Promise<string> {
    try {
      if (!annotations || annotations.length === 0) {
        return originalImageData;
      }

      // Remove data URL prefix if present
      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Get image metadata to ensure we have correct dimensions
      const imageMetadata = await sharp(imageBuffer).metadata();
      const originalWidth = imageMetadata.width || imageDimensions.width;
      const originalHeight = imageMetadata.height || imageDimensions.height;
      

      // Use the original image dimensions for burning to maintain quality
      // The frontend will handle the final display scaling
      const burnWidth = originalWidth;
      const burnHeight = originalHeight;
      

      // Create SVG overlay with display dimensions
      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, imageDimensions);
      
      // Create SVG buffer
      const svgBuffer = Buffer.from(svgOverlay);

      // Composite the SVG overlay onto the original image
      const burnedImageBuffer = await sharp(imageBuffer)
        .composite([
          {
            input: svgBuffer,
            top: 0,
            left: 0
          }
        ])
        .png()
        .toBuffer();

      // Convert back to base64 data URL
      const burnedImageData = `data:image/png;base64,${burnedImageBuffer.toString('base64')}`;
      
      
      return burnedImageData;
      
    } catch (error) {
      console.error('❌ Failed to burn SVG overlay server-side:', error);
      throw new Error(`Failed to burn SVG overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create SVG overlay for burning into image
   */
  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions): string {
    if (!annotations || annotations.length === 0) {
      return '';
    }

    // Calculate scaling factors from provided dimensions to actual burn dimensions
    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;
    
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;
    
    annotations.forEach((annotation, index) => {
      svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY);
    });

    return svg + '</svg>';
  }

  /**
   * Create annotation SVG element based on type
   */
  private static createAnnotationSVG(annotation: Annotation, index: number, scaleX: number, scaleY: number): string {
    const [x, y, width, height] = annotation.bbox;
    const action = annotation.action || 'comment';
    const comment = annotation.comment || '';
    
    // Scale the bounding box coordinates
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;
    
    
    let svg = '';
    
    // Create annotation based on type
    switch (action) {
      case 'tick':
        svg += this.createTickAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
        break;
      case 'cross':
        svg += this.createCrossAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
        break;
      case 'circle':
        svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
        break;
      case 'underline':
        svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
        break;
      case 'comment':
      default:
        svg += this.createCommentAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, comment, scaleX, scaleY);
        break;
    }
    
    return svg;
  }

  /**
   * Create tick annotation using random tick symbols with natural variations
   */
  private static createTickAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const baseFontSize = Math.max(12, Math.min(width, height) * 1.04);
    
    // Add small random variations for natural look
    const positionVariation = 3; // ±3 pixels
    const sizeVariation = 0.2; // ±20% size variation
    const rotationVariation = 15; // ±15 degrees rotation
    
    const randomX = centerX + (Math.random() - 0.5) * positionVariation;
    const randomY = centerY + baseFontSize/3 + (Math.random() - 0.5) * positionVariation;
    const randomSize = baseFontSize * (1 + (Math.random() - 0.5) * sizeVariation);
    const randomRotation = (Math.random() - 0.5) * rotationVariation;
    
    // Randomly choose from different tick symbols
    const tickSymbols = ['✓', '🗸'];
    const randomTick = tickSymbols[Math.floor(Math.random() * tickSymbols.length)];
    
    return `
      <text x="${randomX}" y="${randomY}" text-anchor="middle" fill="#ff0000" 
            font-family="Arial, sans-serif" font-size="${randomSize}" font-weight="bold"
            transform="rotate(${randomRotation} ${randomX} ${randomY})">${randomTick}</text>`;
  }

  /**
   * Create cross annotation using random cross symbols with natural variations
   */
  private static createCrossAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const baseFontSize = Math.max(12, Math.min(width, height) * 1.04);
    
    // Add small random variations for natural look
    const positionVariation = 3; // ±3 pixels
    const sizeVariation = 0.2; // ±20% size variation
    const rotationVariation = 15; // ±15 degrees rotation
    
    const randomX = centerX + (Math.random() - 0.5) * positionVariation;
    const randomY = centerY + baseFontSize/3 + (Math.random() - 0.5) * positionVariation;
    const randomSize = baseFontSize * (1 + (Math.random() - 0.5) * sizeVariation);
    const randomRotation = (Math.random() - 0.5) * rotationVariation;
    
    // Randomly choose from different cross symbols
    const crossSymbols = ['✗', '✘', '🗴'];
    const randomCross = crossSymbols[Math.floor(Math.random() * crossSymbols.length)];
    
    return `
      <text x="${randomX}" y="${randomY}" text-anchor="middle" fill="#ff0000" 
            font-family="Arial, sans-serif" font-size="${randomSize}" font-weight="bold"
            transform="rotate(${randomRotation} ${randomX} ${randomY})">${randomCross}</text>`;
  }

  /**
   * Create circle annotation
   */
  private static createCircleAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.min(width, height) * 0.4;
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    
    return `<circle cx="${centerX}" cy="${centerY}" r="${radius}" 
            fill="none" stroke="#ffaa00" stroke-width="${strokeWidth}" opacity="0.8"/>`;
  }

  /**
   * Create underline annotation
   */
  private static createUnderlineAnnotation(x: number, y: number, width: number, height: number): string {
    const underlineY = y + height - Math.max(3, height * 0.1);
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    
    return `<line x1="${x}" y1="${underlineY}" x2="${x + width}" y2="${underlineY}" 
            stroke="#0066ff" stroke-width="${strokeWidth}" opacity="0.8" stroke-linecap="round"/>`;
  }

  /**
   * Create comment annotation without background or red rectangle
   */
  private static createCommentAnnotation(x: number, y: number, width: number, height: number, comment: string, scaleX: number, scaleY: number): string {
    if (!comment) return '';
    
    // Calculate comment position (above the bounding box)
    const commentX = x;
    const commentY = Math.max(25 * scaleY, y - 10 * scaleY);
    
    // Comment text only (scaled) - no background or rectangle
    // Using Discipuli Britannica font for comments
    const textFontSize = 18 * Math.min(scaleX, scaleY) * 2.1; // 2.1x larger for better visibility
    return `<text x="${commentX}" y="${commentY - 4 * scaleY}" fill="#ff4444" 
            font-family="'Lucida Handwriting', cursive, Arial, sans-serif" 
            font-size="${textFontSize}" font-weight="bold" 
            opacity="0.9">${comment}</text>`;
  }
}