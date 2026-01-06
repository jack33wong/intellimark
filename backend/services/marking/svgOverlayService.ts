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
      reasoning: 30,           // Font size for reasoning text in annotations
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
    scoreToDraw?: { scoreText: string } | { scoreText: string }[], // UPDATED: Accept array for multiple circles
    totalScoreText?: string,
    hasMetaPage?: boolean
  ): Promise<string> {
    try {
      // Allow drawing even if no annotations, as long as we have scores to draw
      const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
      if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText) {
        return originalImageData;
      }

      // Remove data URL prefix if present
      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // 0. Explicitly rotate the image first to ensure we are working with upright pixels
      const uprightImageBuffer = await sharp(imageBuffer).rotate().toBuffer();

      // Get image metadata from the UPRIGHT buffer
      const imageMetadata = await sharp(uprightImageBuffer).metadata();
      const originalWidth = imageMetadata.width || imageDimensions.width;
      const originalHeight = imageMetadata.height || imageDimensions.height;


      // Use original image dimensions (no extension to maintain orientation)
      const burnWidth = originalWidth;
      const burnHeight = originalHeight;


      // Create SVG overlay with extended dimensions (no scaling needed since we're using actual burn dimensions)
      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, scoreToDraw, totalScoreText, hasMetaPage);

      // Create SVG buffer
      const svgBuffer = Buffer.from(svgOverlay);

      // Composite the SVG overlay directly onto the UPRIGHT image
      const burnedImageBuffer = await sharp(uprightImageBuffer)
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

      return burnedImageData;

    } catch (error) {
      console.error('❌ Failed to burn SVG overlay server-side:', error);
      throw new Error(`Failed to burn SVG overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Create SVG overlay for burning into image
   */
  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions, scoreToDraw?: any, totalScoreText?: string, hasMetaPage?: boolean): string {
    // Allow creating SVG even if no annotations, as long as we have scores to draw
    const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
    if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText) {
      return '';
    }

    // Calculate scaling factors from provided dimensions to actual burn dimensions
    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;


    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;

    // Full-page debug border removed


    // Process annotations if available
    if (annotations && annotations.length > 0) {
      // Pre-calculate decisions for split block groups
      const decisionMap = new Map<number, 'TRUST_AI' | 'TRUST_OCR'>();
      let currentGroupStartIndex = -1;

      annotations.forEach((anno, i) => {
        const isSplitBlock = (anno as any).hasLineData === false;

        if (isSplitBlock) {
          if (currentGroupStartIndex === -1) {
            // Start of a new group
            currentGroupStartIndex = i;

            // Perform Check on First Block
            const aiPos = (anno as any).aiPosition;
            const [x, y, w, h] = anno.bbox;

            let decision: 'TRUST_AI' | 'TRUST_OCR' = 'TRUST_OCR'; // Default

            if (aiPos) {
              // Calculate original dimensions from actual dimensions and scale
              const originalWidth = actualWidth / scaleX;
              const originalHeight = actualHeight / scaleY;

              // Convert AI % to Original Pixels
              const aiH_orig = (aiPos.height / 100) * originalHeight;
              const aiY_orig = (aiPos.y / 100) * originalHeight;

              const aiX_px = (aiPos.x / 100) * originalWidth;
              const aiW_px = (aiPos.width / 100) * originalWidth;
              const aiH_px = aiH_orig;
              const aiY_px = aiY_orig - (aiH_orig / 2);

              // Calculate centers
              const ocrCenterX = x + w / 2;
              const ocrCenterY = y + h / 2;
              const aiCenterX = aiX_px + aiW_px / 2;
              const aiCenterY = aiY_px + aiH_px / 2;

              // Calculate Euclidean distance
              const distance = Math.sqrt(
                Math.pow(ocrCenterX - aiCenterX, 2) +
                Math.pow(ocrCenterY - aiCenterY, 2)
              );

              // Threshold: 100px
              if (distance < 100) {
                decision = 'TRUST_AI';
              }
            }

            decisionMap.set(i, decision);
          } else {
            // Continue group - inherit decision from start
            const startDecision = decisionMap.get(currentGroupStartIndex);
            decisionMap.set(i, startDecision || 'TRUST_OCR');
          }
        } else {
          // Not a split block - reset group
          currentGroupStartIndex = -1;
          decisionMap.set(i, 'TRUST_OCR');
        }
      });

      // 1. Group by BBox (approximate) to detect overlaps
      const positionGroups = new Map<string, number[]>(); // Key: "x,y,w,h", Value: [indices]

      annotations.forEach((anno, i) => {
        // Use fixed precision to group effectively
        const key = `${anno.bbox[0].toFixed(1)},${anno.bbox[1].toFixed(1)},${anno.bbox[2].toFixed(1)},${anno.bbox[3].toFixed(1)}`;
        if (!positionGroups.has(key)) {
          positionGroups.set(key, []);
        }
        positionGroups.get(key)!.push(i);
      });

      // 2. Calculate Offsets
      const offsets = new Map<number, number>(); // Index -> Y Offset

      // Calculate font scale to determine appropriate spacing
      const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
      const baseSpacing = Math.round(this.CONFIG.baseFontSizes.tick * fontScaleFactor * 1.2); // 1.2x tick size

      positionGroups.forEach((indices) => {
        if (indices.length > 1) {
          indices.forEach((annoIndex, groupIndex) => {
            if (groupIndex > 0) {
              // Offset subsequent annotations by dynamic spacing
              offsets.set(annoIndex, baseSpacing * groupIndex);
            }
          });
        }
      });

      // 3. Smart Height Adjustment: Count unique Sub-Questions on this page
      // This helps determine density to restrict "Whole Page" drawing blocks (like Q11)
      const uniqueSubQuestions = new Set<string>();
      annotations.forEach(a => {
        if (a.subQuestion) uniqueSubQuestions.add(a.subQuestion);
      });
      // Fallback: If no explicit sub-questions (e.g. Q1, Q2), count detected questions from other sources?
      // Or just default to 1 if set is empty? 
      // Q11 with Q11a, Q11b -> set size 2.
      // Q1 without sub-parts -> set size 0 (count as 1).
      const subQuestionCount = Math.max(1, uniqueSubQuestions.size);

      annotations.forEach((annotation, index) => {
        try {
          const decision = decisionMap.get(index) || 'TRUST_OCR';
          const yOffset = offsets.get(index) || 0;
          svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY, actualWidth, actualHeight, decision, yOffset, subQuestionCount);
        } catch (error) {
          console.error(`❌ [SVG ERROR] Failed to create SVG for annotation ${index}:`, error);
          console.error(`❌ [SVG ERROR] Annotation data:`, annotation);
          throw new Error(`Failed to create SVG for annotation ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      });
    }

    // Add total score with double underline at top right (first page only)
    if (totalScoreText) {
      svg += this.createTotalScoreWithDoubleUnderline(totalScoreText, actualWidth, actualHeight, hasMetaPage);
    }

    // Add student score circles at top right if available (stacking handled in helper)
    if (scoreToDraw) {
      const scores = Array.isArray(scoreToDraw) ? scoreToDraw : [scoreToDraw];
      svg += this.createStudentScoreCircles(scores, actualWidth, actualHeight);
    }

    const finalSvg = svg + '</svg>';
    return finalSvg;
  }

  /**
   * Create annotation SVG element based on type
   */
  private static createAnnotationSVG(annotation: Annotation, index: number, scaleX: number, scaleY: number, actualWidth: number, actualHeight: number, positionDecision: 'TRUST_AI' | 'TRUST_OCR' = 'TRUST_OCR', yOffset: number = 0, subQuestionCount: number = 1): string {
    let [x, y, width, height] = annotation.bbox;
    const action = annotation.action;
    if (!action) {
      // Log warning but don't fail the whole page
      console.warn(`⚠️ [SVG WARNING] Annotation ${index} missing action field, skipping.`);
      return '';
    }
    const text = annotation.text || '';

    // Upstream (MarkingExecutor) now consistently provides bbox in pixels for all statuses
    const ocrStatus = (annotation as any).ocr_match_status;

    // FAIL FAST: Log annotation data for debugging

    // NEW: Check for drawing indicators in text or text content
    const isDrawing = (annotation as any).isDrawing ||
      (annotation.text && annotation.text.includes('[DRAWING]')) ||
      (annotation.studentText && annotation.studentText.includes('[DRAWING]'));

    // Scale the bounding box coordinates
    // MODIFIED: For split blocks (orange) or fallback (green), use AI position if available
    const hasLineData = (annotation as any).hasLineData;
    const aiPos = (annotation as any).aiPosition;

    // 1. Calculate AI Width (if available)
    let aiW_px = 0;
    if (aiPos) {
      const originalWidth = actualWidth / scaleX;
      aiW_px = (aiPos.width / 100) * originalWidth;
    }

    // 2. Determine Coordinate Source
    // Upstream (MarkingExecutor) now consistently provides bbox in pixels.
    // We only override x/y if the bbox is missing (0,0) and we have AI position.
    const isMissingBbox = x === 0 && y === 0;

    if (isMissingBbox && aiPos) {
      const originalWidth = actualWidth / scaleX;
      const originalHeight = actualHeight / scaleY;

      x = (parseFloat(String(aiPos.x)) / 100) * originalWidth;
      y = (parseFloat(String(aiPos.y)) / 100) * originalHeight;
      width = (parseFloat(String(aiPos.width || "50")) / 100) * originalWidth;
      height = (parseFloat(String(aiPos.height || "30")) / 100) * originalHeight;
    } else {
      // TRUST_OCR/EXECUTIVE case: Use bbox from executor, but maybe override dimensions from AI if requested
      if (aiW_px > 0 && (positionDecision === 'TRUST_AI' || isDrawing)) {
        width = aiW_px;
        // height = ... // Keep OCR height usually as it fits the text better
      }
    }

    // DEBUG LOG: Track coordinate final state for specific questions (e.g. Q10, Q20)
    const qNum = (annotation as any).questionNumber || '';
    if (qNum === '10' || qNum === '20' || String(qNum).startsWith('6')) {
      console.log(`[SVG DEBUG] Q${qNum} Annotation: action=${action}, ocr=${ocrStatus}, posDecision=${positionDecision}, finalX=${x.toFixed(1)}, finalW=${width.toFixed(1)} (aiPos.x=${aiPos?.x})`);
    }

    // 2. Clamp Box Position to paper boundaries
    // We only ensure the BOX itself is on the paper. 
    // The Labels (Symbol/MarkCode) will handle their own overflow via Horizontal Flip.
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const originalWidth = actualWidth / scaleX;
    if (x < 0) x = 0;
    if (x + width > originalWidth) {
      x = Math.max(0, originalWidth - width);
    }

    const scaledX = x * scaleX;
    const scaledY = (y * scaleY) + yOffset; // Apply vertical offset for overlapping annotations
    let scaledWidth = width * scaleX;
    let scaledHeight = height * scaleY;

    // CLAMP HEIGHT LOGIC (Same as in createSymbolAnnotation)
    // Ensure the visual box doesn't run off the bottom of the page
    // const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight; // Already defined above
    const requiredBottomSpace = 150 * fontScaleFactor;
    const maxBottomY = actualHeight - requiredBottomSpace;

    if (scaledY + scaledHeight > maxBottomY) {
      const availableHeight = maxBottomY - scaledY;
      if (availableHeight > 50 * fontScaleFactor) {
        scaledHeight = availableHeight;
      }
    }


    let svg = '';

    // Add color-coded border based on annotation status
    // Black = Precise OCR match (MATCHED)
    // Red   = Visual/Unmatched (UNMATCHED) - AI classification position
    // Yellow = Drawing or Estimated block
    let borderColor = 'black';
    let strokeDash = 'none';

    if (isDrawing) {
      // Drawing - use yellow as requested by user
      borderColor = 'yellow';
      strokeDash = '5,5';
    } else if (ocrStatus === 'UNMATCHED') {
      // UNMATCHED - no OCR blocks available, using classification position (Visual)
      borderColor = 'red';
      strokeDash = '5,5'; // Dashed border to indicate fallback
    } else if (hasLineData === false) {
      // No line data - coordinates were estimated from split blocks
      borderColor = 'yellow'; // Also use yellow for estimated blocks
      strokeDash = '5,5';
    }

    const borderWidth = 2;

    // Draw border for all annotations (unless in production)
    // Draw border for all annotations
    // TEMPORARILY DISABLED: User requested to remove borders in all environments
    /* 
    svg += `<rect x="${scaledX}" y="${scaledY}" width="${scaledWidth}" height="${scaledHeight}" 
            fill="none" stroke="${borderColor}" stroke-width="${borderWidth}" opacity="0.8" 
            stroke-dasharray="${strokeDash}"/>`;
    */

    // Create annotation based on type
    const reasoning = (annotation as any).reasoning;

    // Determine if we should show classification text (only for AI-positioned blocks or missing OCR)
    const useAiPos = (hasLineData === false || ocrStatus === 'FALLBACK' || ocrStatus === 'UNMATCHED' || isMissingBbox) && aiPos;
    const classificationText = useAiPos ? (annotation as any).classification_text : undefined;

    // Determine if we should show classification text (green)
    // Logic: Show if explicitly requested via green scheme OR if likely correct answer
    const showClassification = !!classificationText && (action === 'tick' || action === 'cross');

    // Create symbol annotation
    // Pass subQuestionCount if needed (currently not used inside createSymbolAnnotation explicitly, 
    // but dimensions passed are already clamped)
    if (action === 'tick' || action === 'cross' || action === 'write') {
      let symbol = '';
      if (action === 'tick') symbol = '✓';
      else if (action === 'cross') symbol = '✗';
      else if (action === 'write') symbol = text && text.length < 5 ? text : '✎'; // Use pencil for long text writes

      svg += this.createSymbolAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, symbol, text, reasoning, actualWidth, actualHeight, classificationText);
    } else if (action === 'circle') {
      svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    } else if (action === 'underline') {
      svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    } else {
      // Log warning and skip instead of throwing error
      console.warn(`⚠️ [SVG WARNING] Unknown action type: "${action}" for annotation ${index}, skipping.`);
      return '';
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
   * Break text into multiple lines for better fit within image bounds
   */
  private static breakTextIntoMultiLines(text: string, maxCharsPerLine: number = 25): string[] {
    if (text.length <= maxCharsPerLine) {
      return [text];
    }

    const lines: string[] = [];
    let remaining = text;

    while (remaining.length > maxCharsPerLine) {
      // Find the best break point (space or punctuation)
      let breakPoint = maxCharsPerLine;
      for (let i = maxCharsPerLine; i >= Math.floor(maxCharsPerLine * 0.7); i--) {
        if (remaining[i] === ' ' || remaining[i] === ',' || remaining[i] === '.' || remaining[i] === ';') {
          breakPoint = i;
          break;
        }
      }

      lines.push(remaining.substring(0, breakPoint).trim());
      remaining = remaining.substring(breakPoint).trim();
    }

    // Add any remaining text as the last line
    if (remaining.length > 0) {
      lines.push(remaining);
    }

    return lines;
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
    // 1. Scale font sizes
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const symbolSize = Math.max(20, Math.round((symbol === '✓' ? this.CONFIG.baseFontSizes.tick : this.CONFIG.baseFontSizes.cross) * fontScaleFactor));
    const textSize = Math.max(16, Math.round(this.CONFIG.baseFontSizes.markingSchemeCode * fontScaleFactor));
    const classificationSize = Math.max(14, Math.round(textSize * 0.8));

    // 2. Estimate Content Widths
    const markingCodeWidth = (text && text.trim()) ? text.length * (textSize * 0.6) : 0;
    const displayClassText = (classificationText && classificationText.trim())
      ? (classificationText.length > 20 ? classificationText.substring(0, 20) + '...' : classificationText)
      : '';
    const classTextWidth = displayClassText ? displayClassText.length * (classificationSize * 0.6) : 0;

    // Total width of marks (Symbol + Code + Class) + padding
    const markContentWidth = symbolSize + (markingCodeWidth ? markingCodeWidth + 10 : 0) + (classTextWidth ? classTextWidth + 15 : 0) + 10;

    // 3. Detect Overflow & Determine Flip
    const safeMargin = 40 * fontScaleFactor;
    const isFlipped = (x + width + markContentWidth) > (actualWidth - safeMargin);
    const textAnchor = isFlipped ? 'end' : 'start';

    // Calculate required bottom space (Reasoning + Margins)
    const requiredBottomSpace = 150 * fontScaleFactor; // Enough for ~3 lines
    const maxBottomY = actualHeight - requiredBottomSpace;

    // Check if the current block bottom (y + height) exceeds the safe limit
    let effectiveHeight = height;
    if (y + effectiveHeight > maxBottomY) {
      const availableHeight = maxBottomY - y;
      if (availableHeight > 50 * fontScaleFactor) {
        effectiveHeight = availableHeight;
      }
    }

    // Position text relative to EFFECTIVE height
    const baseYOffsetPixels = (effectiveHeight * this.CONFIG.yPositions.baseYOffset) / 100;
    const textY = y + effectiveHeight + baseYOffsetPixels;

    // 4. Position Symbols based on Flip
    // symbolX is the anchor point for the first element
    let symbolX: number;
    if (isFlipped) {
      symbolX = x - 10; // 10px spacing from left edge of box
    } else {
      symbolX = x + width; // Right edge of box
    }

    let svg = `
      <text x="${symbolX}" y="${textY}" text-anchor="${textAnchor}" fill="#ff0000" 
            font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;

    if (isFlipped) {
      // Flipped Left: [Classification] [Code] [Symbol] [BOX]
      // currentX moves further LEFT for each element
      let currentX = symbolX - symbolSize - 5;

      if (text && text.trim()) {
        const escapedText = this.escapeXml(text);
        svg += `
          <text x="${currentX}" y="${textY}" text-anchor="end" fill="#ff0000" 
                font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${escapedText}</text>`;
        currentX -= (markingCodeWidth + 10);
      }

      if (displayClassText) {
        const escapedClassText = this.escapeXml(displayClassText);
        svg += `
          <text x="${currentX}" y="${textY}" text-anchor="end" fill="#0000ff" 
                font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${escapedClassText})</text>`;
      }
    } else {
      // Default Right: [BOX] [Symbol] [Code] [Classification]
      let currentX = symbolX + symbolSize + 5;

      if (text && text.trim()) {
        const escapedText = this.escapeXml(text);
        svg += `
          <text x="${currentX}" y="${textY}" text-anchor="start" fill="#ff0000" 
                font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${escapedText}</text>`;
        currentX += markingCodeWidth + 10;
      }

      if (displayClassText) {
        const escapedClassText = this.escapeXml(displayClassText);
        svg += `<text x="${currentX}" y="${textY}" text-anchor="start" fill="#0000ff" font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${escapedClassText})</text>`;
      }
    }

    // Add reasoning text only for cross actions (wrong steps) - break into multiple lines if needed
    if (symbol === '✗' && reasoning && reasoning.trim()) {
      // CLEANUP: Clean pipe separators | which might be returned by AI
      // Replace pipes with period-space, then squash any double periods ". " -> "."
      const cleanReasoning = reasoning.replace(/\|/g, '. ').replace(/\.\s*\./g, '.').trim();
      const reasoningLines = this.breakTextIntoMultiLines(cleanReasoning, 60); // Break at 60 characters
      const reasoningSize = Math.max(14, Math.round(this.CONFIG.baseFontSizes.reasoning * fontScaleFactor));
      const lineHeight = reasoningSize + 2; // Small spacing between lines

      // CRITICAL: Horizontal Positioning for Reasoning
      // 1. Calculate width and overflow
      const maxCharsInLine = Math.max(...reasoningLines.map(line => line.length));
      // Increase multiplier from 0.6 to 0.8 for safer estimation (red text is semi-bold usually)
      const estimatedMaxReasoningWidth = maxCharsInLine * (reasoningSize * 0.8);

      const reasoningSafeRightLimit = actualWidth - safeMargin;

      // 2. Vertical Strategy: Default to Top unless it overflows the page top
      const reasoningY = this.calculateReasoningStartY(
        y,           // student block top
        effectiveHeight, // student block height
        reasoningLines.length,
        lineHeight,
        actualHeight
      );

      // 3. Horizontal Strategy: Always Left-Aligned (text-anchor="start")
      // If it overflows right, shift the entire block LEFT ("inner")
      let rX = x;
      if (x + estimatedMaxReasoningWidth > reasoningSafeRightLimit) {
        // Shift left so it ends at the safe limit
        rX = reasoningSafeRightLimit - estimatedMaxReasoningWidth;
        // Ensure it doesn't shift past the left safe margin
        rX = Math.max(safeMargin, rX);
      }

      reasoningLines.forEach((line, index) => {
        const escapedLine = this.escapeXml(line);
        // FORCE 'start' anchor for consistent left-alignment
        svg += `<text x="${rX}" y="${reasoningY + (index * lineHeight)}" text-anchor="start" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="bold">${escapedLine}</text>`;
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
   * Create student score circles with hollow red border (positioned at TOP right corner)
   * If multiple scores provided, they are stacked vertically.
   */
  private static createStudentScoreCircles(scores: any[], imageWidth: number, imageHeight: number): string {
    if (!scores || scores.length === 0) return '';

    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const config = this.CONFIG.circleMark;
    const circleRadius = Math.max(config.minRadius, Math.round(config.baseRadius * scaleFactor));
    const scoreFontSize = Math.round(config.baseFontSize * scaleFactor);
    const strokeWidth = Math.max(config.minStrokeWidth, Math.round(config.baseStrokeWidth * scaleFactor));

    let svg = '';
    scores.forEach((scoreItem, index) => {
      const scoreText = scoreItem.scoreText || '0/0';
      // Position at TOP right corner, stack downwards
      // Base position matches original configuration
      const circleX = imageWidth - (circleRadius + config.marginRight * scaleFactor);

      // Vertical stacking: move subsequent circles down
      const verticalGap = circleRadius * 2.5;
      const circleY = circleRadius + (config.marginTop * scaleFactor) + (index * verticalGap);

      const circle = `<circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" 
                     fill="none" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;

      const textYAdjust = scoreFontSize * 0.35;
      const text = `<text x="${circleX}" y="${circleY + textYAdjust}" 
                  text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" 
                  font-size="${scoreFontSize}" font-weight="bold">${scoreText}</text>`;

      svg += circle + text;
    });

    return svg;
  }

  /**
   * Create total score with double underline at top right corner
   */
  private static createTotalScoreWithDoubleUnderline(totalScoreText: string, imageWidth: number, imageHeight: number, hasMetaPage?: boolean): string {
    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const config = this.CONFIG.totalScore;

    const fontSize = Math.round(config.baseFontSize * scaleFactor);
    const strokeWidth = Math.max(config.minStrokeWidth, Math.round(config.baseStrokeWidth * scaleFactor));
    const marginRight = Math.max(config.minMarginRight, config.marginRight * scaleFactor);
    const marginTop = Math.max(config.minMarginTop, config.marginTop * scaleFactor);

    // Dynamic Positioning: Top Right if Meta Page present, Top Left otherwise
    const isTopLeft = hasMetaPage === false;

    let textX: number;
    let textAnchor: string;

    if (isTopLeft) {
      // Position at top left corner (using marginRight as marginLeft)
      textX = marginRight;
      textAnchor = "start";
    } else {
      // Default: Position at top right corner
      textX = imageWidth - marginRight;
      textAnchor = "end";
    }

    const textY = marginTop + fontSize;      // Vertical position: margin from top edge

    // Estimate text width (approximate: 10px per character)
    const estimatedTextWidth = totalScoreText.length * (fontSize * 0.6);

    // Calculate underline start/end based on anchor
    let underlineStartX: number;
    let underlineEndX: number;

    if (isTopLeft) {
      underlineStartX = textX;
      underlineEndX = textX + estimatedTextWidth;
    } else {
      underlineStartX = textX - estimatedTextWidth;
      underlineEndX = textX;
    }

    const underlineY1 = textY + config.underlineOffset;
    const underlineY2 = textY + config.underlineOffset + config.underlineSpacing;

    const text = `<text x="${textX}" y="${textY}" 
                text-anchor="${textAnchor}" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" 
                font-size="${fontSize}" font-weight="bold">${totalScoreText}</text>`;

    // Double underline
    const underline1 = `<line x1="${underlineStartX}" y1="${underlineY1}" x2="${underlineEndX}" y2="${underlineY1}" 
                          stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
    const underline2 = `<line x1="${underlineStartX}" y1="${underlineY2}" x2="${underlineEndX}" y2="${underlineY2}" 
                          stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;

    return text + underline1 + underline2;
  }

  /**
   * Calculate smart positioning for reasoning text
   * Strategy:
   * - Default: Top of the block (adjusted for number of lines)
   * - Overflow: Flip to bottom of the block
   */
  private static calculateReasoningStartY(
    rectY: number,
    rectHeight: number,
    linesCount: number,
    lineHeight: number,
    imageHeight: number
  ): number {
    const padding = lineHeight * 0.5; // proportional padding

    // Strategy 1: Top Positioning
    // We want the last line to be slightly above the rectY.
    // Formula: startY + (n-1)*lineHeight = rectY - padding
    // startY = rectY - padding - (n-1)*lineHeight
    const startY_Top = rectY - padding - (linesCount - 1) * lineHeight;

    // Check strict top overflow (assuming first line top is startY - lineHeight/2 approx)
    if ((startY_Top - lineHeight) >= 0) {
      return startY_Top;
    }

    // Strategy 2: Bottom Positioning (Fallback)
    // rectY + rectHeight + padding + adjust for first line baseline
    return rectY + rectHeight + padding + lineHeight;
  }
}