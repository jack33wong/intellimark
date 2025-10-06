/**
 * SVG Overlay Service for burning SVG annotations into images
 * Converts SVG overlays to permanent image annotations
 */

import sharp from 'sharp';
import { Annotation, ImageDimensions } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

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
    const action = annotation.action;
    if (!action) {
      console.error(`❌ [SVG ERROR] Annotation ${index} missing action field:`, annotation);
      throw new Error(`Annotation ${index} missing required action field`);
    }
    const comment = annotation.comment || '';
    const text = annotation.text || '';
    
    // Scale the bounding box coordinates
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;
    
    
    let svg = '';
    
    // Create annotation based on type
    switch (action) {
      case 'tick':
        svg += this.createTickAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text);
        break;
      case 'cross':
        svg += this.createCrossAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text);
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
   * Create tick annotation with symbol and text
   */
  private static createTickAnnotation(x: number, y: number, width: number, height: number, text?: string): string {
    // Position at the end of the bounding box
    const symbolX = x + width;
    const textY = y + height - 4; // Bottom of the box
    
    const symbolSize = Math.max(12, Math.min(width, height) * 0.8);
    const textSize = Math.max(10, symbolSize * 0.8);
    
    let svg = `
      <text x="${symbolX}" y="${textY}" text-anchor="start" fill="#ff0000" 
            font-family="Arial, sans-serif" font-size="${symbolSize}" font-weight="bold">✓</text>`;
    
    // Add text after the symbol if provided
    if (text && text !== 'comment text') {
      const textX = symbolX + symbolSize + 5; // 5px spacing after symbol
      svg += `
        <text x="${textX}" y="${textY}" text-anchor="start" fill="#ff0000" 
              font-family="Arial, sans-serif" font-size="${textSize}" font-weight="bold">${text}</text>`;
    }
    
    return svg;
  }

  /**

   * Create cross annotation using random cross symbols with natural variations
   */
  private static createCrossAnnotation(
    x: number,
    y: number,
    width: number,
    height: number,
    text?: string
  ): string {
    // Position at the end of the bounding box
    const symbolX = x + width;
    const textY = y + height - 4; // Bottom of the box
    
    const symbolSize = Math.max(12, Math.min(width, height) * 0.8);
    const textSize = Math.max(10, symbolSize * 0.8);
    
    let svg = `
      <text x="${symbolX}" y="${textY}" text-anchor="start" fill="#ff0000" 
            font-family="Arial, sans-serif" font-size="${symbolSize}" font-weight="bold">✗</text>`;
    
    // Add text after the symbol if provided
    if (text && text.trim() && text !== 'comment text') {
      const textX = symbolX + symbolSize + 5; // 5px spacing after symbol
      svg += `
        <text x="${textX}" y="${textY}" text-anchor="start" fill="#ff0000" 
              font-family="Arial, sans-serif" font-size="${textSize}" font-weight="bold">${text}</text>`;
    }
  
    return svg;
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
    
    // Calculate comment position (use bottom-right of bbox as text start)
    const commentX = x + width; // Position text at the END of the bounding box
    const commentY = y + height - 4; // Use bottom-right positioning for text baseline
    
    // Comment text only (scaled) - no background or rectangle
    // Using Discipuli Britannica font for comments
    const textFontSize = 18 * Math.min(scaleX, scaleY) * 2.1; // 2.1x larger for better visibility
    return `<text x="${commentX}" y="${commentY - 4 * scaleY}" text-anchor="start" fill="#ff4444" 
            font-family="'Lucida Handwriting', 'Lucida Calligraphy', 'Brush Script MT', 'Comic Sans MS', cursive, Arial, sans-serif" 
            font-size="${textFontSize}" font-weight="bold" 
            opacity="0.9">${comment}</text>`;
  }

  /**
   * Create debug visualization of math blocks detected by Google Vision
   * Draws red rectangles around each detected math block and saves to temp folder
   */
  static async createMathBlocksDebugImage(
    imageBuffer: Buffer,
    mathBlocks: any[],
    filename: string
  ): Promise<string> {
    try {
      if (!mathBlocks || mathBlocks.length === 0) {
        return '';
      }

      const imageMetadata = await sharp(imageBuffer).metadata();
      const imageWidth = imageMetadata.width || 800;
      const imageHeight = imageMetadata.height || 600;

      // Create SVG overlay with red rectangles for each math block
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" style="position: absolute; top: 0; left: 0;">`;
      
      mathBlocks.forEach((block, index) => {
        const coords = block.coordinates;
        if (coords && coords.x !== undefined && coords.y !== undefined && coords.width && coords.height) {
          // Red rectangle around math block
          svg += `<rect x="${coords.x}" y="${coords.y}" width="${coords.width}" height="${coords.height}" 
                   fill="none" stroke="red" stroke-width="3" opacity="0.8"/>`;
          
          // Block number label
          svg += `<text x="${coords.x + 5}" y="${coords.y + 20}" fill="red" 
                   font-family="Arial, sans-serif" font-size="16" font-weight="bold">${index + 1}</text>`;
          
          // Confidence score
          const confidence = block.confidence || 0;
          svg += `<text x="${coords.x + 5}" y="${coords.y + 40}" fill="red" 
                   font-family="Arial, sans-serif" font-size="12" opacity="0.8">${(confidence * 100).toFixed(1)}%</text>`;
        }
      });
      
      svg += '</svg>';

      // Create SVG buffer
      const svgBuffer = Buffer.from(svg);

      // Composite the SVG overlay onto the original image
      const debugImageBuffer = await sharp(imageBuffer)
        .composite([
          {
            input: svgBuffer,
            top: 0,
            left: 0
          }
        ])
        .png()
        .toBuffer();

      // Ensure temp directory exists
      const tempDir = path.join(process.cwd(), 'backend', 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const filePath = path.join(tempDir, filename);
      fs.writeFileSync(filePath, debugImageBuffer);
      return filePath;
    } catch (error) {
      console.error('❌ Failed to create math blocks debug image:', error);
      return '';
    }
  }
}