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

    const scaleX = actualWidth / originalDimensions.width;
    const scaleY = actualHeight / originalDimensions.height;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;

    // --- SUB-QUESTION ZONES DEBUG BORDER (Optional) ---
    const drawZones = process.env.DRAW_SUBQUESTION_ZONES === 'true' || process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER === 'true';
    console.log(`🎨 [SVG-DEBUG] DRAW_SUBQUESTION_ZONES: ${process.env.DRAW_SUBQUESTION_ZONES}, ENABLE_SVG_ANNOTATION_DEBUG_BORDER: ${process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER}, finalDraw: ${drawZones}, Count: ${semanticZones ? (Array.isArray(semanticZones) ? semanticZones.length : Object.keys(semanticZones).length) : 0}`);

    if (drawZones && semanticZones) {
      const zonesToDraw = Array.isArray(semanticZones) ? semanticZones :
        Object.entries(semanticZones).flatMap(([label, list]) => (list as any[]).map(z => ({ ...z, label })));

      if (zonesToDraw.length > 0) {
        zonesToDraw.forEach(zone => {
          const szX = (zone.x || 0) * scaleX;
          const szY = (zone.startY || 0) * scaleY;
          const szW = actualWidth - szX - (50 * scaleX);
          const szH = (zone.endY - zone.startY) * scaleY;

          svg += `<rect x="${szX}" y="${szY}" width="${szW}" height="${szH}" 
                        fill="rgba(255, 0, 0, 0.05)" stroke="rgba(255, 0, 0, 0.4)" stroke-width="2" stroke-dasharray="8,4" />`;

          // Background for the label to make it readable over handwriting (Scaled to text length)
          const labelText = zone.label.toUpperCase();
          const labelBgWidth = Math.max(40, labelText.length * 10 + 10);
          svg += `<rect x="${szX}" y="${szY}" width="${labelBgWidth}" height="24" fill="rgba(255, 0, 0, 0.8)" />`;
          svg += `<text x="${szX + 5}" y="${szY + 18}" font-family="Arial" font-size="14" font-weight="bold" fill="white">${labelText}</text>`;
        });
      }
    }

    if (annotations && annotations.length > 0) {
      // 1. Group Logic (Split Blocks)
      const decisionMap = new Map<number, 'TRUST_AI' | 'TRUST_OCR'>();
      let currentGroupStartIndex = -1;

      annotations.forEach((anno, i) => {
        const isSplitBlock = (anno as any).hasLineData === false;
        if (isSplitBlock) {
          if (currentGroupStartIndex === -1) {
            currentGroupStartIndex = i;
            const aiPos = (anno as any).aiPosition;
            const [x, y, w, h] = anno.bbox;
            let decision: 'TRUST_AI' | 'TRUST_OCR' = 'TRUST_OCR';

            if (aiPos) {
              const originalWidth = actualWidth / scaleX;
              const originalHeight = actualHeight / scaleY;
              const aiX_px = (aiPos.x / 100) * originalWidth;
              const aiY_px = (aiPos.y / 100) * originalHeight - ((aiPos.height / 100) * originalHeight / 2);
              const ocrCenterX = x + w / 2;
              const ocrCenterY = y + h / 2;
              const aiCenterX = aiX_px + ((aiPos.width / 100) * originalWidth) / 2;
              const aiCenterY = aiY_px + ((aiPos.height / 100) * originalHeight) / 2;

              if (Math.sqrt(Math.pow(ocrCenterX - aiCenterX, 2) + Math.pow(ocrCenterY - aiCenterY, 2)) < 100) {
                decision = 'TRUST_AI';
              }
            }
            decisionMap.set(i, decision);
          } else {
            decisionMap.set(i, decisionMap.get(currentGroupStartIndex) || 'TRUST_OCR');
          }
        } else {
          currentGroupStartIndex = -1;
          decisionMap.set(i, 'TRUST_OCR');
        }
      });

      // 2. Y-Offset Logic
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
          const decision = decisionMap.get(index) || 'TRUST_OCR';
          const yOffset = offsets.get(index) || 0;
          svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY, actualWidth, actualHeight, decision, yOffset);
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

  private static createAnnotationSVG(annotation: Annotation, index: number, scaleX: number, scaleY: number, actualWidth: number, actualHeight: number, positionDecision: 'TRUST_AI' | 'TRUST_OCR', yOffset: number): string {
    let [x, y, width, height] = annotation.bbox;
    const action = annotation.action;
    if (!action) return '';

    const text = annotation.text || '';
    const ocrStatus = (annotation as any).ocr_match_status;
    const isDrawing = (annotation as any).isDrawing ||
      (text && text.includes('[DRAWING]')) ||
      (annotation.studentText && annotation.studentText.includes('[DRAWING]'));

    const hasLineData = (annotation as any).hasLineData;
    const aiPos = (annotation as any).aiPosition;
    let aiW_px = 0;

    if (aiPos) {
      const originalWidth = actualWidth / scaleX;
      aiW_px = (aiPos.width / 100) * originalWidth;
    }

    const isMissingBbox = x === 0 && y === 0;

    if (isMissingBbox && aiPos) {
      const originalWidth = actualWidth / scaleX;
      const originalHeight = actualHeight / scaleY;
      x = (parseFloat(String(aiPos.x)) / 100) * originalWidth;
      y = (parseFloat(String(aiPos.y)) / 100) * originalHeight;
      width = (parseFloat(String(aiPos.width || "50")) / 100) * originalWidth;
      height = (parseFloat(String(aiPos.height || "30")) / 100) * originalHeight;
    } else {
      if (aiW_px > 0 && (positionDecision === 'TRUST_AI' || isDrawing)) {
        width = aiW_px;
      }
    }

    const originalWidth = actualWidth / scaleX;
    if (x < 0) x = 0;
    if (x + width > originalWidth) x = Math.max(0, originalWidth - width);

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

    const useAiPos = (hasLineData === false || ocrStatus === 'FALLBACK' || ocrStatus === 'UNMATCHED' || isMissingBbox) && aiPos;
    const classificationText = useAiPos ? (annotation as any).classification_text : undefined;

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

      // THINNER BORDER (2px) + Status Label (m, u, v, s)
      svg += `<rect x="${scaledX}" y="${scaledY}" width="${scaledWidth}" height="${scaledHeight}" 
                fill="none" stroke="${debugBorderColor}" stroke-width="2" stroke-dasharray="8,4" opacity="0.6" />`;

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

    const markingCodeWidth = (text && text.trim()) ? text.length * (textSize * 0.6) : 0;
    const displayClassText = (classificationText && classificationText.trim())
      ? (classificationText.length > 20 ? classificationText.substring(0, 20) + '...' : classificationText)
      : '';
    const classTextWidth = displayClassText ? displayClassText.length * (classificationSize * 0.6) : 0;

    const symbolContentWidth = symbolSize +
      (markingCodeWidth ? markingCodeWidth + 10 : 0) +
      (classTextWidth ? classTextWidth + 15 : 0) +
      10;

    // 2. Layout Dimensions
    const safeMargin = 40 * fontScaleFactor;
    const padding = 10 * fontScaleFactor;
    const requiredBottomSpace = 150 * fontScaleFactor;
    const maxBottomY = actualHeight - requiredBottomSpace;

    let effectiveHeight = height;
    if (y + effectiveHeight > maxBottomY) {
      effectiveHeight = Math.max(50 * fontScaleFactor, maxBottomY - y);
    }

    const baseYOffsetPixels = (effectiveHeight * this.CONFIG.yPositions.baseYOffset) / 100;
    const symbolY = y + effectiveHeight + baseYOffsetPixels;

    // --- STEP 1: PLACE THE SYMBOL (ANCHOR) ---
    const rightEdgeOfStudentWork = x + width;
    const pageRightLimit = actualWidth - safeMargin;
    const spaceOnRight = pageRightLimit - rightEdgeOfStudentWork;
    const spaceOnLeft = x - safeMargin;

    let isFlipped = false;
    let symbolAnchorX = 0;
    let symbolTextAnchor = 'start';
    let drawSymbolBackground = false;

    // PREFER RIGHT GUTTER
    if (spaceOnRight >= symbolContentWidth + padding) {
      isFlipped = false;
      symbolAnchorX = rightEdgeOfStudentWork + padding;
      symbolTextAnchor = 'start';
    }
    // FLIP LEFT IF NECESSARY
    else if (spaceOnLeft >= symbolContentWidth + padding) {
      isFlipped = true;
      symbolAnchorX = x - padding;
      symbolTextAnchor = 'end';
    }
    // OVERLAY IF TRAPPED
    else {
      isFlipped = false;
      symbolAnchorX = pageRightLimit - symbolContentWidth;
      symbolTextAnchor = 'start';
      drawSymbolBackground = true;
    }

    // --- STEP 2: PLACE THE REASONING (SIDE-BY-SIDE) ---
    let svg = '';
    let reasoningBlockSVG = '';

    if (symbol === '✗' && reasoning && reasoning.trim()) {
      const cleanReasoning = reasoning.replace(/\|/g, '. ').replace(/\.\s*\./g, '.').trim();
      const lineHeight = reasoningSize + 4;

      // Break text into lines
      const lineCharLimit = isFlipped ? 20 : 30;
      const fallbackLines = this.breakTextIntoMultiLines(cleanReasoning, lineCharLimit);

      const totalBlockHeight = fallbackLines.length * lineHeight;

      // 🔥 FIX 1 (Vertical): ALIGN BOTTOM-UP
      // Anchor the bottom of the text block to the bottom of the symbol.
      // This forces the text to "Grow Upwards" into the empty margin, 
      // preventing it from dropping into the next question (20b).
      const startY = symbolY + (symbolSize * 0.5) - totalBlockHeight + (lineHeight * 0.8);

      let reasonX = symbolAnchorX;
      let anchor = isFlipped ? 'end' : 'start';

      // 🔥 FIX 2 (Horizontal): JUMP THE FULL LABEL
      // Use symbolContentWidth (Icon + "A0" + Padding) instead of just symbolSize.
      // This prevents the text from printing on top of the "A0" code.
      const separation = symbolContentWidth + 10;

      if (anchor === 'start') {
        reasonX += separation;
      } else {
        reasonX -= separation;
      }

      // Draw Background Box
      const maxLineWidth = Math.max(...fallbackLines.map(l => l.length * (reasoningSize * 0.55)));
      const boxX = (anchor === 'start') ? reasonX - 5 : reasonX - maxLineWidth - 5;
      const boxY = startY - reasoningSize + 5;

      reasoningBlockSVG += `<rect x="${boxX}" y="${boxY}" width="${maxLineWidth + 10}" height="${totalBlockHeight + 5}" 
                              fill="rgba(255, 255, 255, 0.9)" rx="4" />`;

      fallbackLines.forEach((line, i) => {
        reasoningBlockSVG += `<text x="${reasonX}" y="${startY + (i * lineHeight)}" text-anchor="${anchor}" 
                                  fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="bold">${this.escapeXml(line)}</text>`;
      });
    }

    // --- STEP 3: RENDER SYMBOL ---
    const renderSymbol = (startX: number) => {
      let currentX = startX;
      let svgParts = '';
      const mainColor = symbol === '✓' ? '#008000' : '#ff0000';

      if (drawSymbolBackground) {
        const bgPadding = 5;
        const bgHeight = Math.max(symbolSize, textSize) + 10;
        const bgY = symbolY - bgHeight + 5;
        const bgX = (symbolTextAnchor === 'start') ? startX - bgPadding : startX - symbolContentWidth - bgPadding;
        svgParts += `<rect x="${bgX}" y="${bgY}" width="${symbolContentWidth + (bgPadding * 2)}" height="${bgHeight}" 
                          fill="rgba(255, 255, 255, 0.9)" rx="4" />`;
      }

      if (!isFlipped) {
        svgParts += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" 
                    font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
        currentX += symbolSize + 5;

        if (text && text.trim()) {
          svgParts += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" 
                        font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(text)}</text>`;
          currentX += markingCodeWidth + 10;
        }
        if (displayClassText) {
          svgParts += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="#0000ff" 
                        font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${this.escapeXml(displayClassText)})</text>`;
        }
      } else {
        svgParts += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" 
                    font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
        currentX -= (symbolSize + 5);

        if (text && text.trim()) {
          svgParts += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" 
                        font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(text)}</text>`;
          currentX -= (markingCodeWidth + 10);
        }
        if (displayClassText) {
          svgParts += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="#0000ff" 
                        font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.8">(${this.escapeXml(displayClassText)})</text>`;
        }
      }
      return svgParts;
    };

    svg += reasoningBlockSVG;
    svg += renderSymbol(symbolAnchorX);

    return svg;
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
}