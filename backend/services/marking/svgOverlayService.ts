/**
 * SVG Overlay Service for burning SVG annotations into images
 * Converts SVG overlays to permanent image annotations
 */

import sharp from 'sharp';
import { Annotation, ImageDimensions } from '../../types/index.js';

/**
 * SVG Overlay Service Configuration
 */
export interface SVGOverlayConfig {
  fontFamily: string;
  // Base font sizes for a reference image height; actual sizes will scale from these
  baseFontSizes: {
    reasoning: number;
    tick: number;
    cross: number;
    markingSchemeCode: number;
    studentScore: number;
  };
  baseReferenceHeight: number;
  // Y Position Configuration (as percentages of block height)
  yPositions: {
    baseYOffset: number;    // % of block height from bottom
    reasoningYOffset: number; // % of block height offset from baseY
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
    fontFamily: "'Lucida Handwriting','Comic Neue', 'Comic Sans MS', cursive, Arial, sans-serif",
    baseFontSizes: {
      reasoning: 22,
      tick: 50,
      cross: 50,
      markingSchemeCode: 50,
      studentScore: 70
    },
    baseReferenceHeight: 2400,
    // Y Position Configuration (as percentages of block height)
    yPositions: {
      baseYOffset: -40,
      reasoningYOffset: -11
    }
  };

  /**
   * Update the SVG overlay configuration
   * @param config Partial configuration to update
   */
  static updateConfig(config: Partial<SVGOverlayConfig>): void {
    if (config.fontFamily) {
      this.CONFIG.fontFamily = config.fontFamily;
    }
    if ((config as any).fontSizes) {
      // Backward-compat: if old fontSizes provided, map to baseFontSizes
      this.CONFIG.baseFontSizes = { ...this.CONFIG.baseFontSizes, ...(config as any).fontSizes };
    }
    if (config.baseFontSizes) {
      this.CONFIG.baseFontSizes = { ...this.CONFIG.baseFontSizes, ...config.baseFontSizes };
    }
    if (config.baseReferenceHeight) {
      this.CONFIG.baseReferenceHeight = config.baseReferenceHeight;
    }
    if (config.yPositions) {
      this.CONFIG.yPositions = { ...this.CONFIG.yPositions, ...config.yPositions };
    }
  }

  /**
   * Get the current SVG overlay configuration
   */
  static getConfig(): SVGOverlayConfig {
    return { ...this.CONFIG };
  }




  /**
   * Alternative method using server-side image processing with Sharp
   * This version works in Node.js environment without DOM
   */
  static async burnSVGOverlayServerSide(
    originalImageData: string,
    annotations: Annotation[],
    imageDimensions: ImageDimensions,
    studentScore?: any
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
      

      // Use original image dimensions (no extension to maintain orientation)
      const burnWidth = originalWidth;
      const burnHeight = originalHeight;
      

      // Create SVG overlay with extended dimensions (no scaling needed since we're using actual burn dimensions)
      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, studentScore);
      
      // Create SVG buffer
      const svgBuffer = Buffer.from(svgOverlay);

      // Composite the SVG overlay directly onto the original image (no extension)
      const burnedImageBuffer = await sharp(imageBuffer)
        .composite([
          {
            input: svgBuffer,
            top: 0,
            left: 0
          }
        ])
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      // Convert back to base64 data URL
      const burnedImageData = `data:image/jpeg;base64,${burnedImageBuffer.toString('base64')}`;
      
      try {
        const outMeta = await sharp(burnedImageBuffer).metadata();
      } catch {}
      
      
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
    if (!annotations || annotations.length === 0) {
      return '';
    }

    // Calculate scaling factors from provided dimensions to actual burn dimensions
    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;
    
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;
    
    annotations.forEach((annotation, index) => {
      try {
        svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY, actualWidth, actualHeight);
      } catch (error) {
        console.error(`❌ [SVG ERROR] Failed to create SVG for annotation ${index}:`, error);
        console.error(`❌ [SVG ERROR] Annotation data:`, annotation);
        throw new Error(`Failed to create SVG for annotation ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  private static createAnnotationSVG(annotation: Annotation, index: number, scaleX: number, scaleY: number, actualWidth: number, actualHeight: number): string {
    const [x, y, width, height] = annotation.bbox;
    const action = annotation.action;
    if (!action) {
      console.error(`❌ [SVG ERROR] Annotation ${index} missing action field:`, annotation);
      throw new Error(`Annotation ${index} missing required action field`);
    }
    const text = annotation.text || '';
    
    // FAIL FAST: Log annotation data for debugging
    
    // Scale the bounding box coordinates
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;
    
    
    let svg = '';
    
           // Create annotation based on type
           const reasoning = (annotation as any).reasoning;
           switch (action) {
             case 'tick':
               svg += this.createTickAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text, reasoning, actualWidth, actualHeight);
               break;
             case 'cross':
               svg += this.createCrossAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text, reasoning, actualWidth, actualHeight);
               break;
             case 'circle':
               svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
               break;
             case 'underline':
               svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
               break;
             default:
               console.error(`❌ [SVG ERROR] Unknown action type: ${action}`);
               throw new Error(`Unknown annotation action: ${action}`);
           }
    
    return svg;
  }

  /**
   * Create tick annotation with symbol and text
   */
  private static createTickAnnotation(x: number, y: number, width: number, height: number, text: string | undefined, reasoning: string | undefined, actualWidth: number, actualHeight: number): string {
    return this.createSymbolAnnotation(x, y, width, height, '✓', text, reasoning, actualWidth, actualHeight);
  }

  /**
   * Create cross annotation using random cross symbols with natural variations
   */
  private static createCrossAnnotation(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string | undefined,
    reasoning: string | undefined,
    actualWidth: number,
    actualHeight: number
  ): string {
    return this.createSymbolAnnotation(x, y, width, height, '✗', text, reasoning, actualWidth, actualHeight);
  }
  

  /**
   * Break text into 2 lines for better fit within image bounds
   */
  private static breakTextIntoTwoLines(text: string, maxCharsPerLine: number = 25): string[] {
    if (text.length <= maxCharsPerLine) {
      return [text];
    }
    
    // Find the best break point (space or punctuation)
    let breakPoint = maxCharsPerLine;
    for (let i = maxCharsPerLine; i >= Math.floor(maxCharsPerLine * 0.7); i--) {
      if (text[i] === ' ' || text[i] === ',' || text[i] === '.' || text[i] === ';') {
        breakPoint = i;
        break;
      }
    }
    
    const line1 = text.substring(0, breakPoint).trim();
    const line2 = text.substring(breakPoint).trim();
    
    return [line1, line2];
  }

  /**
   * Create symbol annotation with optional text (unified logic for tick/cross)
   */
  private static createSymbolAnnotation(x: number, y: number, width: number, height: number, symbol: string, text: string | undefined, reasoning: string | undefined, actualWidth: number, actualHeight: number): string {
    // Position at the end of the bounding box
    const symbolX = x + width;
    // Calculate base Y position using configurable percentage offset
    const baseYOffsetPixels = (height * this.CONFIG.yPositions.baseYOffset) / 100;
    const textY = y + height + baseYOffsetPixels;
    
    // Scale font sizes relative to actual image height
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const symbolSize = Math.max(20, Math.round((symbol === '✓' ? this.CONFIG.baseFontSizes.tick : this.CONFIG.baseFontSizes.cross) * fontScaleFactor));
    const textSize = Math.max(16, Math.round(this.CONFIG.baseFontSizes.markingSchemeCode * fontScaleFactor));
    
    let svg = `
      <text x="${symbolX}" y="${textY}" text-anchor="start" fill="#ff0000" 
            font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
    
    // Add text after the symbol if provided
    if (text && text.trim()) {
      const textX = symbolX + symbolSize + 5; // 5px spacing after symbol
      svg += `
        <text x="${textX}" y="${textY}" text-anchor="start" fill="#ff0000" 
              font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${text}</text>`;
      
      // Add reasoning text only for cross actions (wrong steps) - break into 2 lines
      if (symbol === '✗' && reasoning && reasoning.trim()) {
        const reasoningLines = this.breakTextIntoTwoLines(reasoning, 30); // Break at 30 characters as requested
        const reasoningSize = Math.max(14, Math.round(this.CONFIG.baseFontSizes.reasoning * fontScaleFactor));
        const lineHeight = reasoningSize + 2; // Small spacing between lines
        
        // Estimate reasoning width (rough estimate: ~8px per character)
        const estimatedReasoningWidth = reasoningLines.reduce((max, line) => Math.max(max, line.length * 8), 0);
        const reasoningXInline = textX + textSize + 30; // Start right after marking code with spacing
        const wouldOverflow = (reasoningXInline + estimatedReasoningWidth) > actualWidth;
        
        // Determine if block is too wide (reasoning would overflow or block width exceeds threshold)
        const blockTooWide = width > (actualWidth * 0.7) || wouldOverflow;
        
        let reasoningX: number;
        let reasoningY: number;
        
        if (blockTooWide) {
          // Position reasoning below the answer block, starting at block's left edge
          reasoningX = x; // Start at block's left edge
          // Position below the block: block bottom + spacing
          const spacingBelowBlock = 10 * fontScaleFactor; // Small spacing below block
          reasoningY = y + height + spacingBelowBlock;
        } else {
          // Position reasoning inline (to the right of marking code)
          reasoningX = reasoningXInline;
          // Calculate reasoning Y position using configurable percentage offset
          const reasoningYOffsetPixels = (height * this.CONFIG.yPositions.reasoningYOffset) / 100;
          reasoningY = textY + reasoningYOffsetPixels;
        }
        
        reasoningLines.forEach((line, index) => {
          // For multi-line reasoning, add line height offset for subsequent lines
          const lineY = reasoningY + (index * lineHeight);
          svg += `
            <text x="${reasoningX}" y="${lineY}" text-anchor="start" fill="#ff0000" 
                  font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="normal">${line}</text>`;
        });
      }
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
   * Create student score circle with hollow red border
   */
  private static createStudentScoreCircle(studentScore: any, imageWidth: number, imageHeight: number): string {
    const scoreText = studentScore.scoreText || '0/0';
    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const baseRadius = 80;
    const circleRadius = Math.max(40, Math.round(baseRadius * scaleFactor));
    const scoreFontSize = Math.max(30, Math.round(this.CONFIG.baseFontSizes.studentScore * scaleFactor));
    const strokeWidth = Math.max(4, Math.round(8 * scaleFactor));
    
    const circleX = imageWidth - (circleRadius + 40 * scaleFactor);
    const circleY = circleRadius + 40 * scaleFactor;
    
    const circle = `<circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" 
                   fill="none" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
    
    const textYAdjust = scoreFontSize * 0.35;
    const text = `<text x="${circleX}" y="${circleY + textYAdjust}" 
                text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" 
                font-size="${scoreFontSize}" font-weight="bold">${scoreText}</text>`;
    
    return circle + text;
  }
}