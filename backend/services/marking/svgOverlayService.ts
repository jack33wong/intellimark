/**
 * SVG Overlay Service for burning SVG annotations into images
 * Refactored: Green Ticks + Color-Coded Debug Borders + Smart Positioning
 */

import sharp from 'sharp';
import { Annotation, ImageDimensions } from '../../types/index.js';

/**
 * SVG Overlay Service Configuration
 */
export interface SVGOverlayConfig {
  fontFamily: string;
  baseFontSizes: {
    reasoning: number;
    tick: number;
    cross: number;
    markingSchemeCode: number;
    studentScore: number;
    totalScore: number;
  };
  baseReferenceHeight: number;
  yPositions: {
    baseYOffset: number;
    reasoningYOffset: number;
  };
  circleMark: {
    baseRadius: number;
    baseFontSize: number;
    marginRight: number;
    marginTop: number;
    baseStrokeWidth: number;
    minRadius: number;
    minStrokeWidth: number;
  };
  totalScore: {
    baseFontSize: number;
    marginRight: number;
    marginTop: number;
    baseStrokeWidth: number;
    underlineSpacing: number;
    underlineOffset: number;
    minStrokeWidth: number;
    minMarginRight: number;
    minMarginTop: number;
  };
}

export class SVGOverlayService {

  private static CONFIG: SVGOverlayConfig = {
    fontFamily: "'Lucida Handwriting','Comic Neue', 'Comic Sans MS', cursive, Arial, sans-serif",
    baseFontSizes: {
      reasoning: 30,
      tick: 50,
      cross: 50,
      markingSchemeCode: 50,
      studentScore: 70,
      totalScore: 50
    },
    baseReferenceHeight: 2400,
    yPositions: {
      baseYOffset: -40,
      reasoningYOffset: -11
    },
    circleMark: {
      baseRadius: 60,
      baseFontSize: 30,
      marginRight: 90,
      marginTop: 90,
      baseStrokeWidth: 8,
      minRadius: 30,
      minStrokeWidth: 4
    },
    totalScore: {
      baseFontSize: 70,
      marginRight: 80,
      marginTop: 80,
      baseStrokeWidth: 4,
      underlineSpacing: 10,
      underlineOffset: 15,
      minStrokeWidth: 3,
      minMarginRight: 40,
      minMarginTop: 40
    }
  };

  static updateConfig(config: Partial<SVGOverlayConfig>): void {
    if (config.fontFamily) this.CONFIG.fontFamily = config.fontFamily;
    if ((config as any).fontSizes) this.CONFIG.baseFontSizes = { ...this.CONFIG.baseFontSizes, ...(config as any).fontSizes };
    if (config.baseFontSizes) this.CONFIG.baseFontSizes = { ...this.CONFIG.baseFontSizes, ...config.baseFontSizes };
    if (config.baseReferenceHeight) this.CONFIG.baseReferenceHeight = config.baseReferenceHeight;
    if (config.yPositions) this.CONFIG.yPositions = { ...this.CONFIG.yPositions, ...config.yPositions };
    if (config.circleMark) this.CONFIG.circleMark = { ...this.CONFIG.circleMark, ...config.circleMark };
    if (config.totalScore) this.CONFIG.totalScore = { ...this.CONFIG.totalScore, ...config.totalScore };
  }

  static getConfig(): SVGOverlayConfig {
    return { ...this.CONFIG };
  }

  // =========================================================================
  // MAIN SERVER-SIDE BURNING METHOD
  // =========================================================================

  static async burnSVGOverlayServerSide(
    originalImageData: string,
    annotations: Annotation[],
    imageDimensions: ImageDimensions,
    scoreToDraw?: { scoreText: string } | { scoreText: string }[],
    totalScoreText?: string,
    hasMetaPage?: boolean,
    semanticZones?: any[]
  ): Promise<string> {
    try {
      const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
      if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText) {
        return originalImageData;
      }

      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Rotate image to upright
      const uprightImageBuffer = await sharp(imageBuffer).rotate().toBuffer();
      const imageMetadata = await sharp(uprightImageBuffer).metadata();

      const burnWidth = imageMetadata.width || imageDimensions.width;
      const burnHeight = imageMetadata.height || imageDimensions.height;

      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, scoreToDraw, totalScoreText, hasMetaPage, semanticZones);
      const svgBuffer = Buffer.from(svgOverlay);

      const burnedImageBuffer = await sharp(uprightImageBuffer)
        .composite([{ input: svgBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      return `data:image/jpeg;base64,${burnedImageBuffer.toString('base64')}`;
    } catch (error) {
      console.error('❌ Failed to burn SVG overlay:', error);
      throw new Error(`Failed to burn SVG overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // =========================================================================
  // SVG GENERATION LOGIC
  // =========================================================================

  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions, scoreToDraw?: any, totalScoreText?: string, hasMetaPage?: boolean, semanticZones?: any[]): string {
    const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
    if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText && (!semanticZones || semanticZones.length === 0)) {
      return '';
    }

    // ⚡ [MERGE-FIX] Auto-Merge overlapping annotations (e.g. "M1" + "M1" -> "M1 M1")
    // This cleans up the UI when multiple marks land on the same spot.
    annotations = this.mergeOverlappingAnnotations(annotations, actualWidth, actualHeight);

    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;

    // --- SUB-QUESTION ZONES DEBUG BORDER (Optional) ---
    const drawZones = process.env.DRAW_SUBQUESTION_ZONES === 'true' || process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER === 'true';

    if (drawZones && semanticZones) {
      const zonesToDraw = Array.isArray(semanticZones) ? semanticZones :
        Object.entries(semanticZones).flatMap(([label, list]) => (list as any[]).map(z => ({ ...z, label })));

      if (zonesToDraw.length > 0) {
        const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;

        zonesToDraw.forEach((zone, idx) => {
          const szX = (zone.x) * scaleX;
          const szY = (zone.startY) * scaleY;
          const szW = (zone.width) * scaleX;
          const szH = (zone.endY - zone.startY) * scaleY;

          // console.log(`   🎨 [ZONE-SVG-DRAW] [#${idx}] Label: "${zone.label}" | Rect: [x=${Math.round(szX)}, y=${Math.round(szY)}, w=${Math.round(szW)}, h=${Math.round(szH)}] | StartY: ${zone.startY}, EndY: ${zone.endY}`);

          // 🛡️ [DARK REC FIX]: Skip drawing ONLY if dimensions are effectively 0
          // This allows "Top Snap" zones (startY=0) to be drawn correctly.
          if (szW <= 5 || szH <= 5) return;

          svg += `<rect x="${szX}" y="${szY}" width="${szW}" height="${szH}" 
                        fill="rgba(255, 0, 0, 0.1)" stroke="rgba(255, 0, 0, 0.5)" stroke-width="4" stroke-dasharray="10,5" />`;

          // Background for the label to make it readable (Scaled to fontScaleFactor)
          const labelText = zone.label.toUpperCase();
          const fontSize = Math.max(28, Math.round(36 * fontScaleFactor));
          const labelHeight = Math.max(48, Math.round(56 * fontScaleFactor));
          const labelBgWidth = Math.max(80, labelText.length * (fontSize * 0.7) + 20);

          svg += `<rect x="${szX}" y="${szY}" width="${labelBgWidth}" height="${labelHeight}" fill="rgba(255, 0, 0, 0.8)" />`;
          svg += `<text x="${szX + (5 * fontScaleFactor)}" y="${szY + (labelHeight * 0.75)}" font-family="Arial" font-size="${fontSize}" font-weight="bold" fill="white">${labelText}</text>`;
        });
      }
    }

    if (annotations && annotations.length > 0) {
      // 1. Y-Offset Logic (Stacking marks on the same bbox)
      const positionGroups = new Map<string, number[]>();
      annotations.forEach((anno, i) => {
        const key = `${anno.bbox[0].toFixed(1)},${anno.bbox[1].toFixed(1)},${anno.bbox[2].toFixed(1)},${anno.bbox[3].toFixed(1)}`;
        if (!positionGroups.has(key)) positionGroups.set(key, []);
        positionGroups.get(key)!.push(i);
      });

      const offsets = new Map<number, number>();
      const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
      const baseSpacing = Math.round(this.CONFIG.baseFontSizes.tick * fontScaleFactor * 1.2);

      positionGroups.forEach((indices) => {
        if (indices.length > 1) {
          indices.forEach((annoIndex, groupIndex) => {
            if (groupIndex > 0) offsets.set(annoIndex, baseSpacing * groupIndex);
          });
        }
      });

      annotations.forEach((annotation, index) => {
        try {
          const yOffset = offsets.get(index) || 0;
          svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY, actualWidth, actualHeight, yOffset);
        } catch (error) {
          console.error(`SVG Generation Error [Idx: ${index}]:`, error);
        }
      });
    }

    if (totalScoreText) svg += this.createTotalScoreWithDoubleUnderline(totalScoreText, actualWidth, actualHeight, hasMetaPage);
    if (scoreToDraw) {
      const scores = Array.isArray(scoreToDraw) ? scoreToDraw : [scoreToDraw];
      svg += this.createStudentScoreCircles(scores, actualWidth, actualHeight);
    }

    return svg + '</svg>';
  }

  private static createAnnotationSVG(annotation: Annotation, index: number, scaleX: number, scaleY: number, actualWidth: number, actualHeight: number, yOffset: number): string {
    const [x, y, width, height] = annotation.bbox || [0, 0, 0, 0];
    const action = annotation.action;
    if (!action) return '';

    const text = annotation.text || '';
    const ocrStatus = (annotation as any).ocr_match_status;
    const isDrawing = (annotation as any).isDrawing ||
      (text && text.includes('[DRAWING]')) ||
      (annotation.studentText && annotation.studentText.includes('[DRAWING]')) ||
      ocrStatus === 'VISUAL';

    const scaledX = x * scaleX;
    const scaledY = (y * scaleY) + yOffset;
    let scaledWidth = width * scaleX;
    let scaledHeight = height * scaleY;

    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const maxBottomY = actualHeight - (150 * fontScaleFactor);
    if (scaledY + scaledHeight > maxBottomY) {
      const availableHeight = maxBottomY - scaledY;
      if (availableHeight > 50 * fontScaleFactor) scaledHeight = availableHeight;
    }

    const classificationText = (annotation as any).classification_text || (annotation as any).classificationText;

    let svg = '';

    // --- DEBUG BORDER (Development Env Only) ---
    // If running in development mode, draw a color-coded dashed box around the student work.
    const isDebugMode = process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER === 'true' ||
      (process.env.NODE_ENV === 'development' && process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER !== 'false');
    if (isDebugMode) {
      let statusLabel = 'm';
      let debugBorderColor = 'blue';
      if (isDrawing) {
        debugBorderColor = 'magenta';
        statusLabel = 'v';
      } else if (ocrStatus === 'FALLBACK') {
        debugBorderColor = 'orange';
        statusLabel = 's';
      } else if (ocrStatus === 'UNMATCHED') {
        debugBorderColor = 'red';
        statusLabel = 'u';
      } else if (ocrStatus === 'MATCHED') {
        debugBorderColor = 'blue';
        statusLabel = 'm';
      } else {
        debugBorderColor = 'grey';
        statusLabel = '?';
      }

      // THINNER BORDER (Double Thickness 4px) + Status Label (m, u, v, s)
      svg += `<rect x="${scaledX}" y="${scaledY}" width="${scaledWidth}" height="${scaledHeight}" 
                fill="none" stroke="${debugBorderColor}" stroke-width="4" stroke-dasharray="8,4" opacity="0.6" />`;

      // Small status label tag (BIGGER)
      svg += `<rect x="${scaledX}" y="${scaledY - 18}" width="22" height="18" fill="${debugBorderColor}" />
              <text x="${scaledX + 5}" y="${scaledY - 4}" font-family="Arial" font-size="14" font-weight="bold" fill="white">${statusLabel}</text>`;
    }

    if (action === 'tick' || action === 'cross' || action === 'write') {
      let symbol = action === 'tick' ? '✓' : (action === 'cross' ? '✗' : (text && text.length < 5 ? text : '✎'));
      const reasoning = (annotation as any).reasoning;
      svg += this.createSymbolAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, symbol, text, reasoning, actualWidth, actualHeight, classificationText);
    } else if (action === 'circle') {
      svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    } else if (action === 'underline') {
      svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    }

    return svg;
  }

  // =========================================================================
  // SMART SYMBOL ANNOTATION
  // =========================================================================

  private static createSymbolAnnotation(
    x: number,
    y: number,
    width: number,
    height: number,
    symbol: string,
    text: string | undefined,
    reasoning: string | undefined,
    actualWidth: number,
    actualHeight: number,
    classificationText?: string
  ): string {
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;

    // 1. Sizing
    const symbolSize = Math.max(20, Math.round((symbol === '✓' ? this.CONFIG.baseFontSizes.tick : this.CONFIG.baseFontSizes.cross) * fontScaleFactor));
    const textSize = Math.max(16, Math.round(this.CONFIG.baseFontSizes.markingSchemeCode * fontScaleFactor));
    const classificationSize = Math.max(14, Math.round(textSize * 0.8));
    const reasoningSize = Math.max(14, Math.round(this.CONFIG.baseFontSizes.reasoning * fontScaleFactor));

    // --- STEP 1: CALCULATE SYMBOL LINE (LINE 1) ---
    const markingCodeWidth = (text && text.trim()) ? text.length * (textSize * 1.1) : 0;

    // [FIX]: Truncate for display (50 chars) AND use this for width calculation
    const maxChars = 50;
    const displayClassText = (classificationText && classificationText.trim())
      ? (classificationText.length > maxChars ? classificationText.substring(0, maxChars) + '...' : classificationText)
      : '';

    // Use truncated text for width estimation
    const classTextWidth = displayClassText ? displayClassText.length * (classificationSize * 0.75) : 0;

    const line1Width = symbolSize +
      (markingCodeWidth ? markingCodeWidth + 15 : 0) +
      (classTextWidth ? classTextWidth + 25 : 0) +
      20;

    // Safety: Cap total annotation width to manageable size (80% of page)
    const maxWidth = actualWidth * 0.8;
    const finalLine1Width = Math.min(line1Width, maxWidth);

    // --- STEP 2: CALCULATE REASONING BLOCK (LINE 2+) ---
    let reasoningSVG = '';
    let maxReasoningWidth = 0;
    let reasoningLineHeight = reasoningSize + 4;
    let reasoningTotalHeight = 0;
    let reasoningLines: string[] = [];

    if (symbol === '✗' && reasoning && reasoning.trim()) {
      const cleanReasoning = reasoning.replace(/\|/g, '. ').replace(/\.\s*\./g, '.').trim();
      // Line limit for vertical stack
      const lineCharLimit = 35;
      reasoningLines = this.breakTextIntoMultiLines(cleanReasoning, lineCharLimit);
      reasoningTotalHeight = reasoningLines.length * reasoningLineHeight;
      maxReasoningWidth = Math.max(...reasoningLines.map(l => l.length * (reasoningSize * 0.75)));
    }

    // The total horizontal footprint is the wider of the two lines
    const totalAnnotationWidth = Math.max(finalLine1Width, maxReasoningWidth);

    // Layout Dimensions
    const safeMargin = 100 * fontScaleFactor;
    const padding = 15 * fontScaleFactor;
    const rowGap = 10 * fontScaleFactor;

    const requiredBottomSpace = 150 * fontScaleFactor;
    const maxBottomY = actualHeight - requiredBottomSpace;

    let effectiveHeight = height;
    if (y + effectiveHeight > maxBottomY) {
      effectiveHeight = Math.max(50 * fontScaleFactor, maxBottomY - y);
    }

    const baseYOffsetPixels = (effectiveHeight * this.CONFIG.yPositions.baseYOffset) / 100;
    const anchorY = y + effectiveHeight + baseYOffsetPixels; // The "Baseline" of student work

    // --- STEP 3: PLACE THE ENTIRE BLOCK (ANCHOR) ---
    const rightEdgeOfStudentWork = x + width;
    const pageRightLimit = actualWidth - safeMargin;
    const spaceOnRight = pageRightLimit - rightEdgeOfStudentWork;
    const spaceOnLeft = x - safeMargin;

    let isFlipped = false;
    let symbolAnchorX = 0;
    let symbolTextAnchor = 'start';
    let drawBackground = false;

    // PREFER RIGHT GUTTER
    if (spaceOnRight >= finalLine1Width + padding) {
      isFlipped = false;
      symbolAnchorX = rightEdgeOfStudentWork + padding;
      symbolTextAnchor = 'start';
    }
    // FLIP LEFT IF NECESSARY
    else if (spaceOnLeft >= finalLine1Width + padding) {
      isFlipped = true;
      symbolAnchorX = x - padding;
      symbolTextAnchor = 'end';
    }
    // OVERLAY IF TRAPPED
    else {
      isFlipped = false;
      symbolAnchorX = pageRightLimit - finalLine1Width;
      symbolTextAnchor = 'start';
      drawBackground = true;
    }

    // --- STEP 4: RENDER REASONING (LINE 2+) ---
    if (reasoningLines.length > 0) {
      // Position reasoning below the symbol line
      const reasoningStartY = anchorY + (symbolSize * 0.4) + rowGap;
      const anchor = isFlipped ? 'end' : 'start';

      // Draw Background Box for reasoning
      const boxX = (anchor === 'start') ? symbolAnchorX - 5 : symbolAnchorX - maxReasoningWidth - 5;
      const boxY = reasoningStartY - reasoningSize + 5;

      reasoningSVG += `<rect x="${boxX}" y="${boxY}" width="${maxReasoningWidth + 10}" height="${reasoningTotalHeight + 5}" 
                               fill="rgba(255, 255, 255, 0.9)" rx="4" />`;

      reasoningLines.forEach((line, i) => {
        reasoningSVG += `<text x="${symbolAnchorX}" y="${reasoningStartY + (i * reasoningLineHeight)}" text-anchor="${anchor}" 
                                  fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="bold">${this.escapeXml(line)}</text>`;
      });
    }

    // --- STEP 5: RENDER SYMBOLS (LINE 1) ---
    let mainSVG = '';
    const symbolY = anchorY;
    const mainColor = symbol === '✓' ? '#008000' : '#ff0000';

    if (drawBackground) {
      const bgPadding = 5;
      const bgHeight = Math.max(symbolSize, textSize) + 10;
      const bgY = symbolY - bgHeight + 5;
      const bgX = (symbolTextAnchor === 'start') ? symbolAnchorX - bgPadding : symbolAnchorX - finalLine1Width - bgPadding;
      mainSVG += `<rect x="${bgX}" y="${bgY}" width="${finalLine1Width + (bgPadding * 2)}" height="${bgHeight}" 
                        fill="rgba(255, 255, 255, 0.9)" rx="4" />`;
    }

    let currentX = symbolAnchorX;
    if (!isFlipped) {
      mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" 
                  font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
      currentX += symbolSize + 5;

      if (text && text.trim()) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" 
                      font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(text)}</text>`;
        currentX += markingCodeWidth + 10;
      }
      if (displayClassText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="#0000ff" 
                      font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${this.escapeXml(displayClassText)})</text>`;
      }
    } else {
      mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" 
                  font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
      currentX -= (symbolSize + 5);

      if (text && text.trim()) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" 
                      font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(text)}</text>`;
        currentX -= (markingCodeWidth + 10);
      }
      if (displayClassText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="#0000ff" 
                      font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${this.escapeXml(displayClassText)})</text>`;
      }
    }

    return reasoningSVG + mainSVG;
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  private static breakTextIntoMultiLines(text: string, maxCharsPerLine: number = 25): string[] {
    if (text.length <= maxCharsPerLine) return [text];
    const lines: string[] = [];
    let remaining = text;
    while (remaining.length > maxCharsPerLine) {
      let breakPoint = maxCharsPerLine;
      for (let i = maxCharsPerLine; i >= Math.floor(maxCharsPerLine * 0.7); i--) {
        if ([' ', ',', '.', ';'].includes(remaining[i])) {
          breakPoint = i;
          break;
        }
      }
      lines.push(remaining.substring(0, breakPoint).trim());
      remaining = remaining.substring(breakPoint).trim();
    }
    if (remaining.length > 0) lines.push(remaining);
    return lines;
  }

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

  private static createCircleAnnotation(x: number, y: number, width: number, height: number): string {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.min(width, height) * 0.4;
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    return `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="#ffaa00" stroke-width="${strokeWidth}" opacity="0.8"/>`;
  }

  private static createUnderlineAnnotation(x: number, y: number, width: number, height: number): string {
    const underlineY = y + height - Math.max(3, height * 0.1);
    const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
    return `<line x1="${x}" y1="${underlineY}" x2="${x + width}" y2="${underlineY}" stroke="#0066ff" stroke-width="${strokeWidth}" opacity="0.8" stroke-linecap="round"/>`;
  }

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
      const circleX = imageWidth - (circleRadius + config.marginRight * scaleFactor);
      const verticalGap = circleRadius * 2.5;
      const circleY = circleRadius + (config.marginTop * scaleFactor) + (index * verticalGap);

      const circle = `<circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="none" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
      const textYAdjust = scoreFontSize * 0.35;
      const text = `<text x="${circleX}" y="${circleY + textYAdjust}" text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${scoreFontSize}" font-weight="bold">${scoreText}</text>`;
      svg += circle + text;
    });
    return svg;
  }

  private static createTotalScoreWithDoubleUnderline(totalScoreText: string, imageWidth: number, imageHeight: number, hasMetaPage?: boolean): string {
    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const config = this.CONFIG.totalScore;
    const fontSize = Math.round(config.baseFontSize * scaleFactor);
    const strokeWidth = Math.max(config.minStrokeWidth, Math.round(config.baseStrokeWidth * scaleFactor));
    const marginRight = Math.max(config.minMarginRight, config.marginRight * scaleFactor);
    const marginTop = Math.max(config.minMarginTop, config.marginTop * scaleFactor);

    const isTopLeft = hasMetaPage === false;
    let textX: number, textAnchor: string;
    if (isTopLeft) {
      textX = marginRight;
      textAnchor = "start";
    } else {
      textX = imageWidth - marginRight;
      textAnchor = "end";
    }

    const textY = marginTop + fontSize;
    const estimatedTextWidth = totalScoreText.length * (fontSize * 0.6);
    let underlineStartX: number, underlineEndX: number;

    if (isTopLeft) {
      underlineStartX = textX;
      underlineEndX = textX + estimatedTextWidth;
    } else {
      underlineStartX = textX - estimatedTextWidth;
      underlineEndX = textX;
    }

    const underlineY1 = textY + config.underlineOffset;
    const underlineY2 = textY + config.underlineOffset + config.underlineSpacing;

    const text = `<text x="${textX}" y="${textY}" text-anchor="${textAnchor}" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${fontSize}" font-weight="bold">${totalScoreText}</text>`;
    const underline1 = `<line x1="${underlineStartX}" y1="${underlineY1}" x2="${underlineEndX}" y2="${underlineY1}" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
    const underline2 = `<line x1="${underlineStartX}" y1="${underlineY2}" x2="${underlineEndX}" y2="${underlineY2}" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;

    return text + underline1 + underline2;
  }

  private static mergeOverlappingAnnotations(annotations: Annotation[], width: number, height: number): Annotation[] {
    if (!annotations || annotations.length < 2) return annotations;
    const mergedInfos = new Map<string, Annotation>();
    const standalone: Annotation[] = [];

    for (const anno of annotations) {
      const lineId = (anno as any).line_id;
      const action = anno.action;
      if (!lineId) {
        standalone.push(anno);
        continue;
      }
      const key = `${lineId}|${action}`;
      if (mergedInfos.has(key)) {
        const existing = mergedInfos.get(key)!;
        const newText = [existing.text, anno.text].filter(t => t).join(' ');
        mergedInfos.set(key, { ...existing, text: newText });
      } else {
        mergedInfos.set(key, anno);
      }
    }
    return [...standalone, ...mergedInfos.values()];
  }
}