/**
 * SVG Overlay Service for burning SVG annotations into images
 * Converts SVG overlays to permanent image annotations
 */

import sharp from 'sharp';
// Ensure Annotation type includes the bbox property
import { Annotation, ImageDimensions } from '../types/index.js';

/**
 * SVG Overlay Service Configuration
 */
export interface SVGOverlayConfig {
  fontFamily: string;
  fontSizes: {
    reasoning: number;
    tick: number;
    cross: number;
    markingSchemeCode: number;
    studentScore: number;
  };
}

/**
 * SVG Overlay Service class
 */
export class SVGOverlayService {
  
  /**
   * Centralized configuration for SVG overlay styling
   */
  private static CONFIG: SVGOverlayConfig = {
    // Configuration preserved
    fontFamily: "'Lucida Handwriting','Comic Neue', 'Comic Sans MS', cursive, Arial, sans-serif",
    fontSizes: {
      reasoning: 30,
      tick: 50,
      cross: 50,
      markingSchemeCode: 50,
      studentScore: 70
    }
  };

  // (Preserved methods: updateConfig, getConfig)

  static updateConfig(config: Partial<SVGOverlayConfig>): void {
    if (config.fontFamily) {
      this.CONFIG.fontFamily = config.fontFamily;
    }
    if (config.fontSizes) {
      this.CONFIG.fontSizes = { ...this.CONFIG.fontSizes, ...config.fontSizes };
    }
  }

  static getConfig(): SVGOverlayConfig {
    return { ...this.CONFIG };
  }


  /**
   * Alternative method using server-side image processing with Sharp
   */
  static async burnSVGOverlayServerSide(
    originalImageData: string,
    // These annotations should have the 'bbox' property populated by ImageAnnotationService
    annotations: Annotation[],
    imageDimensions: ImageDimensions,
    studentScore?: any
  ): Promise<string> {
    try {
      // FIX: Filter annotations to only include those that were successfully mapped (have a bbox)
      const validAnnotations = annotations.filter(ann => ann.bbox && ann.bbox.length === 4);

      if (validAnnotations.length === 0 && !(studentScore && studentScore.scoreText)) {
        // If no valid annotations and no score to display, return the original image.
        return originalImageData;
      }

      // Remove data URL prefix if present
      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Get image metadata to ensure we have correct dimensions (should match ImageUtils output)
      const imageMetadata = await sharp(imageBuffer).metadata();
      const originalWidth = imageMetadata.width || imageDimensions.width;
      const originalHeight = imageMetadata.height || imageDimensions.height;
      
      // Use actual dimensions for the burn process
      const burnWidth = originalWidth;
      const burnHeight = originalHeight;
      

      // Create SVG overlay
      // We pass the validAnnotations list here
      const svgOverlay = this.createSVGOverlay(validAnnotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, studentScore);
      
      // Create SVG buffer
      const svgBuffer = Buffer.from(svgOverlay);

      // Composite the SVG overlay directly onto the original image
      const burnedImageBuffer = await sharp(imageBuffer)
        .composite([
          {
            input: svgBuffer,
            top: 0,
            left: 0
          }
        ])
        // Ensure output is standard JPEG
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      // Convert back to base64 data URL
      const burnedImageData = `data:image/jpeg;base64,${burnedImageBuffer.toString('base64')}`;
      
      
      return burnedImageData;
      
    } catch (error) {
      console.error('❌ Failed to burn SVG overlay server-side:', error);
      throw new Error(`Failed to burn SVG overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create SVG overlay for burning into image
   */
  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions, studentScore?: any): string {
    
    // Calculate scaling factors (should ideally be 1.0 if dimensions match)
    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;
    
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;
    
    // Iterate over the annotations (which are pre-validated to have bbox)
    annotations.forEach((annotation, index) => {
      try {
        svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY);
      } catch (error) {
        console.error(`❌ [SVG ERROR] Failed to create SVG for annotation ${index}:`, error);
        console.error(`❌ [SVG ERROR] Annotation data:`, annotation);
        // Continue processing other annotations instead of throwing
      }
    });

    // Add student score circle if available
    if (studentScore && studentScore.scoreText) {
      svg += this.createStudentScoreCircle(studentScore, actualWidth, actualHeight);
    }

    const finalSvg = svg + '</svg>';
    return finalSvg;
  }

  /**
   * Create annotation SVG element based on type
   */
  private static createAnnotationSVG(annotation: Annotation, index: number, scaleX: number, scaleY: number): string {
    // We know bbox exists because it was filtered in the calling function
    const [x, y, width, height] = annotation.bbox!;
    const action = annotation.action;
    
    if (!action) {
      console.warn(`⚠️ [SVG WARN] Annotation ${index} missing action field, skipping.`, annotation);
      return '';
    }
    const text = annotation.text || '';
    
    // Scale the bounding box coordinates
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;
    
    
    let svg = '';
    
    // Create annotation based on type
    // Use the reasoning field from the AI response
    const reasoning = (annotation as any).reasoning;
    switch (action) {
        case 'tick':
            svg += this.createTickAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text, reasoning);
            break;
        case 'cross':
            svg += this.createCrossAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text, reasoning);
            break;
        case 'circle':
            svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
            break;
        case 'underline':
            svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
            break;
        default:
            // Log warning for unknown actions but do not throw error
            console.warn(`⚠️ [SVG WARN] Unknown action type: ${action} for annotation ${index}. Skipping.`);
    }
    
    return svg;
  }

  // (Preserved rendering methods: createTickAnnotation, createCrossAnnotation, breakTextIntoTwoLines, createSymbolAnnotation, createCircleAnnotation, createUnderlineAnnotation, createStudentScoreCircle)
  // These methods are required for rendering and are included below.

  private static createTickAnnotation(x: number, y: number, width: number, height: number, text?: string, reasoning?: string): string {
    return this.createSymbolAnnotation(x, y, width, height, '✓', text, reasoning);
  }

  private static createCrossAnnotation(
    x: number,
    y: number,
    width: number,
    height: number,
    text?: string,
    reasoning?: string
  ): string {
    return this.createSymbolAnnotation(x, y, width, height, '✗', text, reasoning);
  }
  

  private static breakTextIntoTwoLines(text: string, maxCharsPerLine: number = 25): string[] {
    if (!text) return [];
    if (text.length <= maxCharsPerLine) {
      return [text];
    }
    
    let breakPoint = maxCharsPerLine;
    for (let i = maxCharsPerLine; i >= Math.floor(maxCharsPerLine * 0.7); i--) {
      if (text[i] === ' ' || text[i] === ',' || text[i] === '.' || text[i] === ';') {
        breakPoint = i;
        break;
      }
    }
    
    const line1 = text.substring(0, breakPoint).trim();
    const line2 = text.substring(breakPoint).trim();
    
    return [line1, line2].filter(line => line.length > 0);
  }

  private static createSymbolAnnotation(x: number, y: number, width: number, height: number, symbol: string, text?: string, reasoning?: string): string {
    const symbolX = x + width;
    const textY = y + height - 4;
    
    const symbolSize = symbol === '✓' ? this.CONFIG.fontSizes.tick : this.CONFIG.fontSizes.cross;
    const textSize = this.CONFIG.fontSizes.markingSchemeCode;
    
    let svg = `
      <text x="${symbolX}" y="${textY}" text-anchor="start" fill="#ff0000" 
            font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
    
    if (text && text.trim()) {
      const textX = symbolX + symbolSize + 5;
      svg += `
        <text x="${textX}" y="${textY}" text-anchor="start" fill="#ff0000" 
              font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${text}</text>`;
    }

    // Add reasoning text only for cross actions (wrong steps)
    // Increased maxCharsPerLine for portrait mode (30)
    if (symbol === '✗' && reasoning && reasoning.trim()) {
        const reasoningLines = this.breakTextIntoTwoLines(reasoning, 30); 
        const reasoningX = x + width - 10; // Top right corner with 10px spacing from edge
        const reasoningSize = this.CONFIG.fontSizes.reasoning;
        const lineHeight = reasoningSize + 2;
        
        reasoningLines.forEach((line, index) => {
          const reasoningY = y + 15 + (index * lineHeight); // Position at top of block with 15px spacing
          svg += `
            <text x="${reasoningX}" y="${reasoningY}" text-anchor="end" fill="#ff0000" 
                  font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="normal">${line}</text>`;
        });
    }
    
    return svg;
  }

  private static createCircleAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.min(width, height) * 0.4;
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    
    return `<circle cx="${centerX}" cy="${centerY}" r="${radius}" 
            fill="none" stroke="#ffaa00" stroke-width="${strokeWidth}" opacity="0.8"/>`;
  }

  private static createUnderlineAnnotation(x: number, y: number, width: number, height: number): string {
    const underlineY = y + height - Math.max(3, height * 0.1);
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    
    return `<line x1="${x}" y1="${underlineY}" x2="${x + width}" y2="${underlineY}" 
            stroke="#0066ff" stroke-width="${strokeWidth}" opacity="0.8" stroke-linecap="round"/>`;
  }

  private static createStudentScoreCircle(studentScore: any, imageWidth: number, imageHeight: number): string {
    const scoreText = studentScore.scoreText || '0/0';
    const circleRadius = 80;
    
    // Position circle in top-right corner (consistent for portrait/landscape)
    let circleX = imageWidth - 120;
    let circleY = 120;
    
    const circle = `<circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" 
                   fill="none" stroke="#ff0000" stroke-width="8" opacity="0.9"/>`;
    
    const text = `<text x="${circleX}" y="${circleY + 20}" 
                text-anchor="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" 
                font-size="${this.CONFIG.fontSizes.studentScore}" font-weight="bold" stroke="#ffffff" stroke-width="2">${scoreText}</text>`;
    
    return circle + text;
  }
}