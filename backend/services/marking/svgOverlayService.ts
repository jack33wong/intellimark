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
    totalScore: number;
  };
  baseReferenceHeight: number;
  // Y Position Configuration (as percentages of block height)
  yPositions: {
    baseYOffset: number;    // % of block height from bottom
    reasoningYOffset: number; // % of block height offset from baseY
  };
  // Circle mark (student score) configuration
  // Example: To move circle more to the left, increase marginRight (e.g., 100)
  //          To move circle down from top, increase marginTop (e.g., 100)
  //          Position: Top right corner of image
  circleMark: {
    baseRadius: number;        // Base radius for scaling (default: 80)
    baseFontSize: number;      // Font size for circle mark text (scales with image height)
    marginRight: number;       // Margin from right edge (multiplied by scaleFactor) - increase to move left
    marginTop: number;         // Margin from top edge (multiplied by scaleFactor) - increase to move down
    baseStrokeWidth: number;   // Base stroke width for scaling (default: 8)
    minRadius: number;         // Minimum radius regardless of scale (default: 40)
    minStrokeWidth: number;    // Minimum stroke width regardless of scale (default: 4)
  };
  // Total score (underline) configuration
  // Example: To move text left (keep top): increase marginRight (e.g., 60)
  //          To move text right (keep top): decrease marginRight (e.g., 20)
  //          To move text down (keep right): increase marginTop (e.g., 60)
  //          To move text up (keep right): decrease marginTop (e.g., 20)
  //          To adjust underline spacing: change underlineSpacing (e.g., 8 for wider gap)
  //          Position: Top right corner of image
  totalScore: {
    baseFontSize: number;      // Font size for total score text (scales with image height)
    marginRight: number;       // Margin from right edge (multiplied by scaleFactor) - increase to move left
    marginTop: number;         // Margin from top edge (multiplied by scaleFactor) - increase to move down
    baseStrokeWidth: number;   // Base stroke width for scaling (default: 4)
    underlineSpacing: number;  // Spacing between double underlines in pixels (default: 5) - increase for wider gap
    underlineOffset: number;  // Offset from text baseline to first underline in pixels (default: 10) - increase to move underlines down
    minStrokeWidth: number;    // Minimum stroke width regardless of scale (default: 3)
    minMarginRight: number;    // Minimum right margin regardless of scale (default: 40)
    minMarginTop: number;      // Minimum top margin regardless of scale (default: 40)
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
    // Base font sizes for a reference image height (2400px); actual sizes scale proportionally
    // Example: For reasoning text, increase reasoning value (e.g., 28) to make it larger
    baseFontSizes: {
      reasoning: 25,           // Font size for reasoning text in annotations
      tick: 50,                // Font size for tick (✓) symbols
      cross: 50,              // Font size for cross (✗) symbols
      markingSchemeCode: 50,  // Font size for marking scheme codes (e.g., "A1", "M1")
      studentScore: 70,       // Font size for student score in circle mark
      totalScore: 50          // Font size for total score text with underline
    },
    // Reference image height for scaling calculations (all sizes scale from this)
    // Example: For larger images, increase this value to maintain proportions
    baseReferenceHeight: 2400,
    // Y Position Configuration (as percentages of block height)
    // Example: To move annotations higher, decrease baseYOffset (e.g., -50)
    //          To move reasoning text closer to annotation, decrease reasoningYOffset (e.g., -15)
    yPositions: {
      baseYOffset: -40,       // Vertical offset for annotations (% of block height, negative = above block)
      reasoningYOffset: -11   // Vertical offset for reasoning text relative to baseY (% of block height)
    },
    // Circle mark (student score) configuration
    // Position: Top right corner
    // Example adjustments:
    //   - Move left: increase marginRight (e.g., 120)
    //   - Move right: decrease marginRight (e.g., 50)
    //   - Move down: increase marginTop (e.g., 120)
    //   - Move up: decrease marginTop (e.g., 50)
    circleMark: {
      baseRadius: 60,           // Base radius for scaling (decrease to make circle smaller)
      baseFontSize: 30,        // Font size for circle mark text (scales with image height) - single parameter to control text size
      marginRight: 90,          // Margin from right edge (increase = move left)
      marginTop: 90,            // Margin from top edge (increase = move down)
      baseStrokeWidth: 8,      // Base stroke width for scaling
      minRadius: 30,            // Minimum radius regardless of scale (decrease proportionally)
      minStrokeWidth: 4         // Minimum stroke width regardless of scale
    },
    // Total score (underline) configuration
    // Position: Top right corner
    // Example adjustments:
    //   - Move left (keep top): increase marginRight (e.g., 60)
    //   - Move right (keep top): decrease marginRight (e.g., 20)
    //   - Move down (keep right): increase marginTop (e.g., 60)
    //   - Move up (keep right): decrease marginTop (e.g., 20)
    //   - Wider underline gap: increase underlineSpacing (e.g., 8)
    //   - Move underlines down: increase underlineOffset (e.g., 15)
    totalScore: {
      baseFontSize: 70,         // Font size for total score text (scales with image height) - single parameter to control text size
      marginRight: 80,          // Margin from right edge (increase = move left)
      marginTop: 80,            // Margin from top edge (increase = move down)
      baseStrokeWidth: 4,       // Base stroke width for scaling
      underlineSpacing: 10,      // Spacing between double underlines (pixels)
      underlineOffset: 15,      // Offset from text baseline to first underline (pixels)
      minStrokeWidth: 3,        // Minimum stroke width regardless of scale
      minMarginRight: 40,       // Minimum right margin regardless of scale
      minMarginTop: 40          // Minimum top margin regardless of scale
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
    if (config.circleMark) {
      this.CONFIG.circleMark = { ...this.CONFIG.circleMark, ...config.circleMark };
    }
    if (config.totalScore) {
      this.CONFIG.totalScore = { ...this.CONFIG.totalScore, ...config.totalScore };
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
    studentScore?: any,
    totalScoreText?: string
  ): Promise<string> {
    try {
      // Allow drawing even if no annotations, as long as we have scores to draw
      if ((!annotations || annotations.length === 0) && !studentScore && !totalScoreText) {
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
      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, studentScore, totalScoreText);

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
      } catch { }


      return burnedImageData;

    } catch (error) {
      console.error('❌ Failed to burn SVG overlay server-side:', error);
      throw new Error(`Failed to burn SVG overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create SVG overlay for burning into image
   */
  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions, studentScore?: any, totalScoreText?: string): string {
    // Allow creating SVG even if no annotations, as long as we have scores to draw
    if ((!annotations || annotations.length === 0) && !studentScore && !totalScoreText) {
      return '';
    }

    // Calculate scaling factors from provided dimensions to actual burn dimensions
    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;


    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;

    // DEBUG: Add black border around entire image
    svg += `<rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="none" stroke="black" stroke-width="5" opacity="1.0"/>`;


    // Process annotations if available
    if (annotations && annotations.length > 0) {
      annotations.forEach((annotation, index) => {
        try {
          svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY, actualWidth, actualHeight);
        } catch (error) {
          console.error(`❌ [SVG ERROR] Failed to create SVG for annotation ${index}:`, error);
          console.error(`❌ [SVG ERROR] Annotation data:`, annotation);
          throw new Error(`Failed to create SVG for annotation ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      });
    }

    // Add total score with double underline at top right (first page only)
    if (totalScoreText) {
      svg += this.createTotalScoreWithDoubleUnderline(totalScoreText, actualWidth, actualHeight);
    }

    // Add student score circle at lower right if available
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
    let [x, y, width, height] = annotation.bbox;
    const action = annotation.action;
    if (!action) {
      console.error(`❌ [SVG ERROR] Annotation ${index} missing action field:`, annotation);
      throw new Error(`Annotation ${index} missing required action field`);
    }
    const text = annotation.text || '';

    // FAIL FAST: Log annotation data for debugging

    // Scale the bounding box coordinates
    // MODIFIED: For split blocks (orange) or fallback (green), use AI position if available
    // This replaces inaccurate/missing OCR coords with the AI-estimated position
    const hasLineData = (annotation as any).hasLineData;
    const ocrStatus = (annotation as any).ocr_match_status;
    const aiPos = (annotation as any).aiPosition;

    if ((hasLineData === false || ocrStatus === 'FALLBACK') && aiPos) {
      // Calculate original dimensions from actual dimensions and scale
      const originalWidth = actualWidth / scaleX;
      const originalHeight = actualHeight / scaleY;

      // Convert AI % to Original Pixels
      const aiH_orig = (aiPos.height / 100) * originalHeight;
      const aiY_orig = (aiPos.y / 100) * originalHeight; // AI Y is treated as Baseline

      // Target: Annotation Bottom (y + h) should match Cyan Circle Center (aiY + aiH/2)
      // y + aiH = aiY + aiH/2
      // y = aiY - aiH/2

      x = (aiPos.x / 100) * originalWidth;
      // Target: Raise one block higher than previous (which was aiY + aiH/2)
      // New y = (aiY + aiH/2) - aiH = aiY - aiH/2
      y = aiY_orig - (aiH_orig / 2);
      width = (aiPos.width / 100) * originalWidth;
      height = aiH_orig;


    }

    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    const scaledWidth = width * scaleX;
    const scaledHeight = height * scaleY;


    let svg = '';

    // Add color-coded border based on line data presence
    // Orange = No line data (Block Data - estimated coords from split blocks)
    // Black = Has line data (True Line Data - precise Mathpix coords)
    let borderColor = 'black';
    let strokeDash = 'none';

    if (ocrStatus === 'FALLBACK') {
      // Fallback - student work found in Classification but missing in OCR
      borderColor = 'green';
      strokeDash = '5,5';
    } else if (hasLineData === false) {
      // No line data - coordinates were estimated from split blocks
      borderColor = 'orange';
      strokeDash = '5,5';
      // DEBUG: Log width for orange border
      console.log(`[SVG DEBUG] Orange Border for step ${annotation.step_id}: Width=${width} (Original Pixels), AI Width=${aiPos?.width}%`);
    }

    const borderWidth = 2;

    // Draw border around the annotation bounding box
    svg += `<rect x="${scaledX}" y="${scaledY}" width="${scaledWidth}" height="${scaledHeight}" 
            fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" opacity="0.8" 
            stroke-dasharray="${strokeDash}"/>`;

    // Cyan circle visualization removed as requested




    // Create annotation based on type
    const reasoning = (annotation as any).reasoning;

    // Determine if we should show classification text (only for AI-positioned blocks)
    const useAiPos = (hasLineData === false || ocrStatus === 'FALLBACK') && aiPos;
    const classificationText = useAiPos ? (annotation as any).classification_text : undefined;

    switch (action) {
      case 'tick':
        svg += this.createTickAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text, reasoning, actualWidth, actualHeight, classificationText);
        break;
      case 'cross':
        svg += this.createCrossAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, text, reasoning, actualWidth, actualHeight, classificationText);
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
  private static createTickAnnotation(x: number, y: number, width: number, height: number, text: string | undefined, reasoning: string | undefined, actualWidth: number, actualHeight: number, classificationText?: string): string {
    return this.createSymbolAnnotation(x, y, width, height, '✓', text, reasoning, actualWidth, actualHeight, classificationText);
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
    actualHeight: number,
    classificationText?: string
  ): string {
    return this.createSymbolAnnotation(x, y, width, height, '✗', text, reasoning, actualWidth, actualHeight, classificationText);
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
   * Escape XML special characters to prevent SVG parsing errors
   */
  private static escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
      return c;
    });
  }

  /**
   * Create symbol annotation with optional text (unified logic for tick/cross)
   */
  private static createSymbolAnnotation(x: number, y: number, width: number, height: number, symbol: string, text: string | undefined, reasoning: string | undefined, actualWidth: number, actualHeight: number, classificationText?: string): string {
    // Position at the end of the bounding box
    const symbolX = x + width;
    // Calculate base Y position using configurable percentage offset
    const baseYOffsetPixels = (height * this.CONFIG.yPositions.baseYOffset) / 100;
    const textY = y + height + baseYOffsetPixels;

    // Scale font sizes relative to actual image height
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const symbolSize = Math.max(20, Math.round((symbol === '✓' ? this.CONFIG.baseFontSizes.tick : this.CONFIG.baseFontSizes.cross) * fontScaleFactor));
    const textSize = Math.max(16, Math.round(this.CONFIG.baseFontSizes.markingSchemeCode * fontScaleFactor));
    const classificationSize = Math.max(14, Math.round(textSize * 0.8)); // Slightly smaller than mark code

    let svg = `
      <text x="${symbolX}" y="${textY}" text-anchor="start" fill="#ff0000" 
            font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;

    let currentX = symbolX + symbolSize + 5; // Track current X position for next element

    // Add text (Mark Code) after the symbol if provided
    if (text && text.trim()) {
      const escapedText = this.escapeXml(text);
      svg += `
        <text x="${currentX}" y="${textY}" text-anchor="start" fill="#ff0000" 
              font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${escapedText}</text>`;

      // Update currentX for next element
      const estimatedMarkingCodeWidth = text.length * (textSize * 0.6);
      currentX += estimatedMarkingCodeWidth + 10; // Add spacing
    }

    // Add Classification Text (Blue) if provided
    if (classificationText && classificationText.trim()) {
      // Truncate if too long (e.g. > 20 chars)
      const displayClassText = classificationText.length > 20 ? classificationText.substring(0, 20) + '...' : classificationText;
      const escapedClassText = this.escapeXml(displayClassText);

      svg += `
        <text x="${currentX}" y="${textY}" text-anchor="start" fill="#0000ff" 
              font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${escapedClassText})</text>`;

      // Update currentX for next element (reasoning)
      const estimatedClassTextWidth = displayClassText.length * (classificationSize * 0.6);
      currentX += estimatedClassTextWidth + 15; // Add spacing
    }

    // Add reasoning text only for cross actions (wrong steps) - break into 2 lines
    if (symbol === '✗' && reasoning && reasoning.trim()) {
      const reasoningLines = this.breakTextIntoTwoLines(reasoning, 30); // Break at 30 characters as requested
      const reasoningSize = Math.max(14, Math.round(this.CONFIG.baseFontSizes.reasoning * fontScaleFactor));
      const lineHeight = reasoningSize + 2; // Small spacing between lines

      // Estimate reasoning width (rough estimate: ~8px per character)
      const estimatedReasoningWidth = reasoningLines.reduce((max, line) => Math.max(max, line.length * 8), 0);

      const reasoningXInline = currentX; // Start right after previous element
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
        // Position reasoning inline
        reasoningX = reasoningXInline;
        // Calculate reasoning Y position using configurable percentage offset
        const reasoningYOffsetPixels = (height * this.CONFIG.yPositions.reasoningYOffset) / 100;
        reasoningY = textY + reasoningYOffsetPixels;
      }

      reasoningLines.forEach((line, index) => {
        // For multi-line reasoning, add line height offset for subsequent lines
        const lineY = reasoningY + (index * lineHeight);
        const escapedLine = this.escapeXml(line);
        svg += `
          <text x="${reasoningX}" y="${lineY}" text-anchor="start" fill="#ff0000"
                font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="normal">${escapedLine}</text>`;
      });
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
   * Create student score circle with hollow red border (positioned at TOP right corner)
   */
  private static createStudentScoreCircle(studentScore: any, imageWidth: number, imageHeight: number): string {
    const scoreText = studentScore.scoreText || '0/0';
    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const config = this.CONFIG.circleMark;

    const circleRadius = Math.max(config.minRadius, Math.round(config.baseRadius * scaleFactor));
    const scoreFontSize = Math.round(config.baseFontSize * scaleFactor);
    const strokeWidth = Math.max(config.minStrokeWidth, Math.round(config.baseStrokeWidth * scaleFactor));

    // Position at TOP right corner (changed from lower right)
    const circleX = imageWidth - (circleRadius + config.marginRight * scaleFactor);
    const circleY = circleRadius + (config.marginTop * scaleFactor);

    const circle = `<circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" 
                   fill="none" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;

    const textYAdjust = scoreFontSize * 0.35;
    const text = `<text x="${circleX}" y="${circleY + textYAdjust}" 
                text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" 
                font-size="${scoreFontSize}" font-weight="bold">${scoreText}</text>`;

    return circle + text;
  }

  /**
   * Create total score with double underline at top right corner
   */
  private static createTotalScoreWithDoubleUnderline(totalScoreText: string, imageWidth: number, imageHeight: number): string {
    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const config = this.CONFIG.totalScore;

    const fontSize = Math.round(config.baseFontSize * scaleFactor);
    const strokeWidth = Math.max(config.minStrokeWidth, Math.round(config.baseStrokeWidth * scaleFactor));
    const marginRight = Math.max(config.minMarginRight, config.marginRight * scaleFactor);
    const marginTop = Math.max(config.minMarginTop, config.marginTop * scaleFactor);

    // Position at top right corner
    const textX = imageWidth - marginRight;  // Horizontal position: margin from right edge
    const textY = marginTop + fontSize;      // Vertical position: margin from top edge

    // Estimate text width (approximate: 10px per character)
    const estimatedTextWidth = totalScoreText.length * (fontSize * 0.6);
    const underlineStartX = textX - estimatedTextWidth;
    const underlineY1 = textY + config.underlineOffset;
    const underlineY2 = textY + config.underlineOffset + config.underlineSpacing;

    const text = `<text x="${textX}" y="${textY}" 
                text-anchor="end" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" 
                font-size="${fontSize}" font-weight="bold">${totalScoreText}</text>`;

    // Double underline
    const underline1 = `<line x1="${underlineStartX}" y1="${underlineY1}" x2="${textX}" y2="${underlineY1}" 
                          stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
    const underline2 = `<line x1="${underlineStartX}" y1="${underlineY2}" x2="${textX}" y2="${underlineY2}" 
                          stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;

    return text + underline1 + underline2;
  }
}