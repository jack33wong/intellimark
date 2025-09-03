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
      console.log('🔥 Burning SVG overlay server-side with Sharp...');
      console.log('🔍 Image dimensions:', imageDimensions);
      console.log('🔍 Annotations count:', annotations.length);
      console.log('🔍 First annotation bbox:', annotations[0]?.bbox);
      
      if (!annotations || annotations.length === 0) {
        console.log('🔍 No annotations to burn, returning original image');
        return originalImageData;
      }

      // Remove data URL prefix if present
      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Get image metadata to ensure we have correct dimensions
      const imageMetadata = await sharp(imageBuffer).metadata();
      const originalWidth = imageMetadata.width || imageDimensions.width;
      const originalHeight = imageMetadata.height || imageDimensions.height;
      
      console.log('🔍 Original image dimensions:', originalWidth, 'x', originalHeight);
      console.log('🔍 Provided image dimensions:', imageDimensions.width, 'x', imageDimensions.height);

      // Use the original image dimensions for burning to maintain quality
      // The frontend will handle the final display scaling
      const burnWidth = originalWidth;
      const burnHeight = originalHeight;
      
      console.log('🔍 Burning at original dimensions:', burnWidth, 'x', burnHeight);

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
      
      console.log('✅ Successfully burned SVG overlay server-side');
      console.log('🔍 Original size:', imageBuffer.length, 'bytes');
      console.log('🔍 Burned size:', burnedImageBuffer.length, 'bytes');
      
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

    console.log('🔍 Creating SVG overlay with dimensions:', actualWidth, 'x', actualHeight);
    console.log('🔍 Original dimensions:', originalDimensions.width, 'x', originalDimensions.height);
    
    // Calculate scaling factors from provided dimensions to actual burn dimensions
    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;
    
    console.log('🔍 Scaling factors:', { scaleX, scaleY });
    
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
    
    console.log(`🔍 Annotation ${index + 1}: Original(${x}, ${y}, ${width}, ${height}) -> Scaled(${scaledX}, ${scaledY}, ${scaledWidth}, ${scaledHeight})`);
    
    let svg = '';
    
    // Add annotation number indicator (scaled)
    const numberRadius = 18 * Math.min(scaleX, scaleY);
    const fontSize = 16 * Math.min(scaleX, scaleY);
    svg += `<circle cx="${scaledX + 20}" cy="${scaledY + 20}" r="${numberRadius}" fill="#ff4444" opacity="0.9"/>`;
    svg += `<text x="${scaledX + 20}" y="${scaledY + 26}" text-anchor="middle" fill="white" 
            font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold">${index + 1}</text>`;
    
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
   * Create tick annotation
   */
  private static createTickAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const size = Math.min(width, height) * 4.0; // 5x larger (0.8 * 5 = 4.0)
    const strokeWidth = Math.max(30, Math.min(width, height) * 1.0); // 5x thicker stroke
    
    return `
      <g stroke="#00ff00" stroke-width="${strokeWidth}" fill="none" opacity="0.8">
        <path d="M ${centerX - size/3} ${centerY} L ${centerX - size/6} ${centerY + size/4} L ${centerX + size/3} ${centerY - size/4}" 
              stroke-linecap="round" stroke-linejoin="round"/>
      </g>`;
  }

  /**
   * Create cross annotation
   */
  private static createCrossAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const size = Math.min(width, height) * 0.8;
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    
    return `
      <g stroke="#ff0000" stroke-width="${strokeWidth}" fill="none" opacity="0.8">
        <line x1="${centerX - size/2}" y1="${centerY - size/2}" x2="${centerX + size/2}" y2="${centerY + size/2}" stroke-linecap="round"/>
        <line x1="${centerX + size/2}" y1="${centerY - size/2}" x2="${centerX - size/2}" y2="${centerY + size/2}" stroke-linecap="round"/>
      </g>`;
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
   * Create comment annotation
   */
  private static createCommentAnnotation(x: number, y: number, width: number, height: number, comment: string, scaleX: number, scaleY: number): string {
    if (!comment) return '';
    
    // Calculate comment position (above the bounding box)
    const commentX = x;
    const commentY = Math.max(25 * scaleY, y - 10 * scaleY);
    
    // Comment background (scaled)
    const textWidth = comment.length * 12 * scaleX; // Approximate text width
    const textHeight = 20 * scaleY;
    const bgWidth = Math.max(textWidth + 20 * scaleX, 120 * scaleX);
    const bgHeight = textHeight + 12 * scaleY;
    const borderRadius = 6 * Math.min(scaleX, scaleY);
    
    let svg = '';
    svg += `<rect x="${commentX}" y="${commentY - bgHeight}" width="${bgWidth}" 
            height="${bgHeight}" fill="#ff4444" opacity="0.9" rx="${borderRadius}"/>`;
    
    // Comment text (scaled)
    const textFontSize = 16 * Math.min(scaleX, scaleY);
    svg += `<text x="${commentX + 10 * scaleX}" y="${commentY - 4 * scaleY}" fill="white" 
            font-family="Arial, sans-serif" font-size="${textFontSize}" font-weight="500">${comment}</text>`;
    
    // Bounding box rectangle (scaled)
    const strokeWidth = 4 * Math.min(scaleX, scaleY);
    svg += `<rect x="${x}" y="${y}" width="${width}" height="${height}" 
            fill="none" stroke="#ff4444" stroke-width="${strokeWidth}" opacity="0.6"/>`;
    
    return svg;
  }
}