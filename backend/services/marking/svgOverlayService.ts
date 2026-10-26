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

interface Rect2D {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface InkDensityMap {
  getInkDensity(px: number, py: number, pw: number, ph: number): number;
}

interface DeferredReasoningItem {
  annotation: Annotation;
  symbolRect: Rect2D;
  studentRect: Rect2D;
  reasoningText: string;
  subQuestion?: string;
}

export class SVGOverlayService {

  private static CONFIG: SVGOverlayConfig = {
    fontFamily: "'Lucida Handwriting','Comic Neue', 'Comic Sans MS', cursive, Arial, sans-serif",
    baseFontSizes: {
      reasoning: 26,
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
    semanticZones?: any[],
    hasDensityError?: boolean
  ): Promise<string> {
    try {
      const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
      if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText && !hasDensityError) {
        return originalImageData;
      }

      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Rotate image to upright
      const uprightImageBuffer = await sharp(imageBuffer).rotate().toBuffer();
      const imageMetadata = await sharp(uprightImageBuffer).metadata();

      const burnWidth = imageMetadata.width || imageDimensions.width;
      const burnHeight = imageMetadata.height || imageDimensions.height;

      // Build fast 2D integral ink-density map from the page image so reasoning text finds genuine empty paper
      let inkMap: InkDensityMap | undefined;
      try {
        inkMap = await this.buildInkIntegralMap(uprightImageBuffer, burnWidth, burnHeight);
      } catch (inkErr) {
        console.warn('[SVGOverlayService] Could not build ink integral map, falling back to bbox-only placement:', inkErr);
      }

      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, scoreToDraw, totalScoreText, hasMetaPage, semanticZones, hasDensityError, inkMap);
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

  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions, scoreToDraw?: any, totalScoreText?: string, hasMetaPage?: boolean, semanticZones?: any[], hasDensityError?: boolean, inkMap?: InkDensityMap): string {
    const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
    if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText && (!semanticZones || semanticZones.length === 0) && !hasDensityError) {
      return '';
    }

    // ⚡ [MERGE-FIX] Auto-Merge overlapping annotations (e.g. "M1" + "M1" -> "M1 M1")
    // This cleans up the UI when multiple marks land on the same spot.
    annotations = this.mergeOverlappingAnnotations(annotations, actualWidth, actualHeight);

    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;

    // Flatten semantic zones for both optional debug drawing and empty-space zone bounds
    const flatZones: any[] = semanticZones
      ? (Array.isArray(semanticZones)
          ? semanticZones
          : Object.entries(semanticZones).flatMap(([label, list]) => (list as any[]).map(z => ({ ...z, label }))))
      : [];

    // --- SUB-QUESTION ZONES DEBUG BORDER (Optional) ---
    const drawZones = process.env.DRAW_SUBQUESTION_ZONES === 'true' || process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER === 'true';

    if (drawZones && flatZones.length > 0) {
      flatZones.forEach((zone) => {
        const szX = (zone.x);
        const szY = (zone.startY);
        const szW = (zone.width);
        const szH = (zone.endY - zone.startY);

        if (szW <= 5 || szH <= 5) return;

        svg += `<rect x="${szX}" y="${szY}" width="${szW}" height="${szH}" 
                      fill="rgba(255, 0, 0, 0.1)" stroke="rgba(255, 0, 0, 0.5)" stroke-width="4" stroke-dasharray="10,5" />`;

        const zoneCoordsLabel = `(${Math.round(zone.x || 0)},${Math.round(zone.startY)})`;
        const labelText = `${(zone.label || '').toUpperCase()} ${zoneCoordsLabel}`;
        const fontSize = Math.max(32, Math.round(40 * fontScaleFactor));
        const labelHeight = Math.max(54, Math.round(62 * fontScaleFactor));
        const labelBgWidth = Math.max(120, labelText.length * (fontSize * 0.65) + 20);

        svg += `<rect x="${szX}" y="${szY}" width="${labelBgWidth}" height="${labelHeight}" fill="rgba(255, 0, 0, 0.8)" />`;
        svg += `<text x="${szX + (5 * fontScaleFactor)}" y="${szY + (labelHeight * 0.75)}" font-family="Arial" font-size="${fontSize}" font-weight="bold" fill="white">${labelText}</text>`;
      });
    }

    // Track occupied rectangles (symbols, score circles, and placed reasoning blocks)
    const occupiedRects: Rect2D[] = [];
    // Track student handwriting bboxes so we avoid placing reasoning text over student work
    const studentWorkRects: Rect2D[] = [];

    // Pre-register top-right score circles into occupiedRects
    if (hasScores) {
      const scoresArray = Array.isArray(scoreToDraw) ? scoreToDraw : [scoreToDraw];
      const config = this.CONFIG.circleMark;
      const circleRadius = Math.max(config.minRadius, Math.round(config.baseRadius * fontScaleFactor));
      scoresArray.forEach((_, idx) => {
        const circleX = actualWidth - (circleRadius + config.marginRight * fontScaleFactor);
        const verticalGap = circleRadius * 2.5;
        const circleY = circleRadius + (config.marginTop * fontScaleFactor) + (idx * verticalGap);
        occupiedRects.push({
          x: circleX - circleRadius - 10,
          y: circleY - circleRadius - 10,
          w: circleRadius * 2 + 20,
          h: circleRadius * 2 + 20
        });
      });
    }

    if (annotations && annotations.length > 0) {
      // Pre-register all student work bboxes
      annotations.forEach((anno) => {
        const [bx, by, bw, bh] = (anno as any).snappedBbox || anno.bbox || [0, 0, 0, 0];
        if (bw > 5 && bh > 5) {
          studentWorkRects.push({ x: bx, y: by, w: bw, h: bh });
        }
      });

      // Order annotations top-to-bottom, and when two marks share a line/vertical band,
      // always place Ticks (✓) BEFORE Crosses (✗) so ✓ sits above ✗ and never blocks ✗'s reasoning text below.
      const sortedAnnotations = [...annotations].sort((a, b) => {
        const [, ay, , ah] = (a as any).snappedBbox || a.bbox || [0, 0, 0, 0];
        const [, by, , bh] = (b as any).snappedBbox || b.bbox || [0, 0, 0, 0];
        const aBaseline = ay + ah;
        const bBaseline = by + bh;

        if (Math.abs(aBaseline - bBaseline) <= 22 * fontScaleFactor) {
          const rank = (act?: string) => (act === 'tick' ? 0 : act === 'write' ? 1 : act === 'cross' ? 2 : 3);
          const rDiff = rank(a.action) - rank(b.action);
          if (rDiff !== 0) return rDiff;
        }
        return aBaseline - bBaseline;
      });

      const deferredReasonings: DeferredReasoningItem[] = [];

      // PASS 1: Render all symbols (✓ P1, ✗ M0, ✗ A0, circles, underlines) and lock their positions
      // (Collision avoidance in createSymbolAnnotation handles exact-bbox stacking cleanly without double-shifting)
      sortedAnnotations.forEach((annotation, index) => {
        try {
          svg += this.createAnnotationSVG(
            annotation,
            index,
            actualWidth,
            actualHeight,
            0,
            occupiedRects,
            deferredReasonings
          );
        } catch (error) {
          console.error(`SVG Generation Error [Idx: ${index}]:`, error);
        }
      });

      // PASS 2: Place deferred reasoning text blocks into the nearest empty space (teacher-style)
      deferredReasonings.forEach((item) => {
        try {
          svg += this.renderTeacherStyleReasoning(
            item,
            actualWidth,
            actualHeight,
            occupiedRects,
            studentWorkRects,
            flatZones,
            inkMap
          );
        } catch (error) {
          console.error('SVG Reasoning Placement Error:', error);
        }
      });
    }

    if (totalScoreText) svg += this.createTotalScoreWithDoubleUnderline(totalScoreText, actualWidth, actualHeight, hasMetaPage);

    // --- DENSITY ERROR WARNING ---
    if (hasDensityError && !hasMetaPage) {
      const scaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
      const rectWidth = 450 * scaleFactor;
      const rectHeight = 60 * scaleFactor;
      const margin = 20 * scaleFactor;
      const x = actualWidth - rectWidth - margin;
      const y = margin;
      
      svg += `
        <rect x="${x}" y="${y}" width="${rectWidth}" height="${rectHeight}" rx="${8 * scaleFactor}" fill="rgba(254, 226, 226, 0.9)" stroke="#EF4444" stroke-width="${3 * scaleFactor}"/>
        <text x="${x + rectWidth / 2}" y="${y + (rectHeight / 2) + (6 * scaleFactor)}" font-family="${this.CONFIG.fontFamily}" font-size="${24 * scaleFactor}" font-weight="bold" fill="#EF4444" text-anchor="middle">
          MANUAL REVIEW: PAGE TOO DENSE
        </text>`;
    }

    // --- SCORES AND ANNOTATIONS ---
    if (hasScores) {
      const scoresArray = Array.isArray(scoreToDraw) ? scoreToDraw : [scoreToDraw];
      svg += this.createStudentScoreCircles(scoresArray, actualWidth, actualHeight);
    }

    return svg + '</svg>';
  }

  private static createAnnotationSVG(
    annotation: Annotation,
    index: number,
    actualWidth: number,
    actualHeight: number,
    yOffset: number,
    occupiedRects: Rect2D[],
    deferredReasonings: DeferredReasoningItem[]
  ): string {
    // Priority: snappedBbox (Rescued/Authoritative) -> bbox (Original/Hallucinated)
    const [x, y, width, height] = (annotation as any).snappedBbox || annotation.bbox || [0, 0, 0, 0];
    const action = annotation.action;
    if (!action) return '';

    const text = annotation.text || '';
    const ocrStatus = (annotation as any).ocr_match_status;
    const isDrawing = (annotation as any).isDrawing ||
      (text && text.includes('[DRAWING]')) ||
      (annotation.studentText && annotation.studentText.includes('[DRAWING]')) ||
      ocrStatus === 'VISUAL';

    const scaleX = 1.0;
    const scaleY = 1.0;

    const scaledX = x * scaleX;
    const scaledY = (y + yOffset) * scaleY;
    let scaledWidth = width * scaleX;
    let scaledHeight = height * scaleY;

    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const maxBottomY = actualHeight - (120 * fontScaleFactor);
    if (scaledY + scaledHeight > maxBottomY) {
      const availableHeight = maxBottomY - scaledY;
      if (availableHeight > 50 * fontScaleFactor) scaledHeight = availableHeight;
    }

    const classificationText = (annotation as any).classification_text || (annotation as any).classificationText;

    let svg = '';

    // --- DEBUG BORDER (Development Env Only) ---
    const isDebugMode = process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER === 'true' ||
      (process.env.NODE_ENV === 'development' && process.env.ENABLE_SVG_ANNOTATION_DEBUG_BORDER !== 'false');
    if (isDebugMode) {
      let statusLabel = 'm';
      let debugBorderColor = 'blue';
      const _debug_status = (annotation as any)._debug_status;
      if (_debug_status === 'RED_BORDER') {
        debugBorderColor = 'red';
        statusLabel = 'u';
      } else if (_debug_status === 'GREEN_BORDER' || (annotation as any).isSplitBlock || (annotation as any).hasLineData === false) {
        debugBorderColor = '#00FF00';
        statusLabel = 'S';
      } else if (isDrawing) {
        debugBorderColor = 'magenta';
        statusLabel = 'v';
      } else if (ocrStatus === 'FALLBACK') {
        debugBorderColor = 'orange';
        statusLabel = 's';
      } else if (ocrStatus === 'MATCHED' || _debug_status === 'BLUE_BORDER') {
        debugBorderColor = 'blue';
        statusLabel = 'm';
      } else {
        debugBorderColor = 'grey';
        statusLabel = '?';
      }

      svg += `<rect x="${scaledX}" y="${scaledY}" width="${scaledWidth}" height="${scaledHeight}" 
                fill="none" stroke="${debugBorderColor}" stroke-width="4" stroke-dasharray="8,4" opacity="0.6" />`;

      const coordLabel = `${statusLabel}-${annotation.subQuestion} (${Math.round(x)},${Math.round(y)})`;
      const debugFontSize = 18;
      const debugLabelWidth = coordLabel.length * 10 + 10;
      const debugLabelHeight = 22;

      svg += `<rect x="${scaledX}" y="${scaledY - debugLabelHeight}" width="${debugLabelWidth}" height="${debugLabelHeight}" fill="${debugBorderColor}" />
              <text x="${scaledX + 5}" y="${scaledY - 5}" font-family="Arial" font-size="${debugFontSize}" font-weight="bold" fill="white">${coordLabel}</text>`;
    }

    if (action === 'tick' || action === 'cross' || action === 'write') {
      const symbol = action === 'tick' ? '✓' : (action === 'cross' ? '✗' : (text && text.length < 5 ? text : '✎'));
      const reasoning = (annotation as any).reasoning;
      svg += this.createSymbolAnnotation(
        annotation,
        scaledX,
        scaledY,
        scaledWidth,
        scaledHeight,
        symbol,
        text,
        reasoning,
        actualWidth,
        actualHeight,
        classificationText,
        occupiedRects,
        deferredReasonings
      );
    } else if (action === 'circle') {
      svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    } else if (action === 'underline') {
      svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    }

    return svg;
  }

  // =========================================================================
  // PASS 1: SMART SYMBOL ANNOTATION (KEEP TICK/CROSS ANCHORED NEXT TO WORK)
  // =========================================================================

  private static createSymbolAnnotation(
    annotation: Annotation,
    x: number,
    y: number,
    width: number,
    height: number,
    symbol: string,
    text: string | undefined,
    reasoning: string | undefined,
    actualWidth: number,
    actualHeight: number,
    classificationText: string | undefined,
    occupiedRects: Rect2D[],
    deferredReasonings: DeferredReasoningItem[]
  ): string {
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;

    // 1. Sizing
    const symbolSize = Math.max(20, Math.round((symbol === '✓' ? this.CONFIG.baseFontSizes.tick : this.CONFIG.baseFontSizes.cross) * fontScaleFactor));
    const textSize = Math.max(16, Math.round(this.CONFIG.baseFontSizes.markingSchemeCode * fontScaleFactor));
    const classificationSize = Math.max(14, Math.round(textSize * 0.8));

    // --- CALCULATE SYMBOL LINE (LINE 1) ---
    const cleanCodeText = (text && text.trim()) ? text.trim() : '';
    const markingCodeWidth = cleanCodeText ? this.estimateTextWidth(cleanCodeText, textSize) : 0;

    const maxChars = 50;
    const displayClassText = (classificationText && classificationText.trim())
      ? (classificationText.length > maxChars ? classificationText.substring(0, maxChars) + '...' : classificationText)
      : '';

    const classTextWidth = displayClassText ? this.estimateTextWidth(`(${displayClassText})`, classificationSize) : 0;

    const gapAfterSymbol = Math.round(8 * fontScaleFactor);
    const gapAfterCode = Math.round(10 * fontScaleFactor);

    const line1Width = symbolSize +
      (markingCodeWidth ? gapAfterSymbol + markingCodeWidth : 0) +
      (classTextWidth ? gapAfterCode + classTextWidth : 0) +
      Math.round(8 * fontScaleFactor);

    const maxWidth = actualWidth * 0.8;
    const finalLine1Width = Math.min(line1Width, maxWidth);
    const line1Height = Math.max(symbolSize, textSize);

    // Layout Dimensions
    const edgeMargin = Math.max(18, Math.round(28 * fontScaleFactor));
    const padding = Math.round(15 * fontScaleFactor);
    const maxBottomY = actualHeight - Math.round(90 * fontScaleFactor);

    let effectiveHeight = height;
    if (y + effectiveHeight > maxBottomY) {
      effectiveHeight = Math.max(40 * fontScaleFactor, maxBottomY - y);
    }

    const baseYOffsetPixels = (effectiveHeight * this.CONFIG.yPositions.baseYOffset) / 100;
    let symbolY = y + effectiveHeight + baseYOffsetPixels;
    symbolY = Math.max(edgeMargin + line1Height, Math.min(symbolY, maxBottomY));

    // --- PLACE THE SYMBOL LINE (LINE 1) ON THE RIGHT-HAND SIDE ---
    const rightEdgeOfStudentWork = x + width;
    const pageRightLimit = actualWidth - edgeMargin;

    // Always place tick/cross and mark code on the right-hand side of student work (never flip to left)
    const isFlipped = false;
    const maxSymbolRightX = Math.max(edgeMargin, pageRightLimit - finalLine1Width);
    const symbolAnchorX = Math.min(rightEdgeOfStudentWork + padding, maxSymbolRightX);

    let symBoxX = symbolAnchorX;
    let symBoxY = symbolY - line1Height * 0.85;
    const symRect: Rect2D = {
      x: symBoxX,
      y: symBoxY,
      w: finalLine1Width,
      h: line1Height
    };

    // Avoid symbol-on-symbol collision (e.g. ✗ M0 and ✗ A0 on closely spaced lines)
    let shiftAttempts = 0;
    const shiftStep = Math.max(12, Math.round(16 * fontScaleFactor));
    while (shiftAttempts < 12 && occupiedRects.some(r => this.rectsOverlap(symRect, r, 4 * fontScaleFactor))) {
      symRect.y += shiftStep;
      symbolY += shiftStep;
      shiftAttempts++;
    }

    // Clamp to page bottom if shifted
    if (symRect.y + symRect.h > actualHeight - edgeMargin) {
      symRect.y = actualHeight - edgeMargin - symRect.h;
      symbolY = symRect.y + line1Height * 0.85;
    }

    occupiedRects.push({ ...symRect });

    // Queue reasoning text for Pass 2 (Teacher-Style Empty-Space Placement)
    if (symbol === '✗' && reasoning && reasoning.trim()) {
      const cleanReasoning = reasoning
        .replace(/\|/g, '. ')
        .replace(/\.\s*\./g, '.')
        .replace(/[.\s]+$/, '')
        .trim();
      if (cleanReasoning.length > 0) {
        deferredReasonings.push({
          annotation,
          symbolRect: { ...symRect },
          studentRect: { x, y, w: Math.max(20, width), h: Math.max(20, height) },
          reasoningText: cleanReasoning,
          subQuestion: annotation.subQuestion
        });
      }
    }

    // --- RENDER SYMBOL LINE (WITH SUBTLE HALO INSTEAD OF OPAQUE BOX) ---
    let mainSVG = '';
    const mainColor = symbol === '✓' ? '#008000' : '#ff0000';
    const haloStrokeWidth = Math.max(2.5, Math.round(3.5 * fontScaleFactor));
    const haloStyle = `paint-order="stroke fill" stroke="rgba(255, 255, 255, 0.88)" stroke-width="${haloStrokeWidth}px" stroke-linecap="round" stroke-linejoin="round"`;

    let currentX = symbolAnchorX;
    if (!isFlipped) {
      mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" ${haloStyle}
                  font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
      currentX += symbolSize + gapAfterSymbol;

      if (cleanCodeText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" ${haloStyle}
                      font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(cleanCodeText)}</text>`;
        currentX += markingCodeWidth + gapAfterCode;
      }
      if (displayClassText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="#0000ff" ${haloStyle}
                      font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.85">(${this.escapeXml(displayClassText)})</text>`;
      }
    } else {
      mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" ${haloStyle}
                  font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
      currentX -= (symbolSize + gapAfterSymbol);

      if (cleanCodeText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" ${haloStyle}
                      font-family="${this.CONFIG.fontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(cleanCodeText)}</text>`;
        currentX -= (markingCodeWidth + gapAfterCode);
      }
      if (displayClassText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="#0000ff" ${haloStyle}
                      font-family="${this.CONFIG.fontFamily}" font-size="${classificationSize}" font-weight="normal" opacity="0.85">(${this.escapeXml(displayClassText)})</text>`;
      }
    }

    return mainSVG;
  }

  // =========================================================================
  // PASS 2: TEACHER-STYLE EMPTY-SPACE REASONING PLACEMENT ENGINE
  // =========================================================================

  private static renderTeacherStyleReasoning(
    item: DeferredReasoningItem,
    actualWidth: number,
    actualHeight: number,
    occupiedRects: Rect2D[],
    studentWorkRects: Rect2D[],
    flatZones: any[],
    inkMap?: InkDensityMap
  ): string {
    const fontScaleFactor = actualHeight / this.CONFIG.baseReferenceHeight;
    const reasoningSize = Math.max(14, Math.round(this.CONFIG.baseFontSizes.reasoning * fontScaleFactor));
    const lineHeight = Math.round(reasoningSize * 1.22);
    const edgeMargin = Math.max(20, Math.round(30 * fontScaleFactor));
    const maxBottomY = actualHeight - Math.round(80 * fontScaleFactor);

    const { symbolRect, studentRect, reasoningText, subQuestion } = item;

    // Find sub-question vertical zone if available
    let zoneMinY = edgeMargin;
    let zoneMaxY = maxBottomY;
    if (subQuestion && flatZones.length > 0) {
      const normSub = String(subQuestion).toLowerCase().replace(/\s+/g, '');
      const matchingZone = flatZones.find(z => {
        const zLabel = String(z.label || '').toLowerCase().replace(/\s+/g, '');
        return zLabel === normSub || zLabel.endsWith(normSub) || normSub.endsWith(zLabel);
      });
      if (matchingZone && matchingZone.endY - matchingZone.startY > 100 * fontScaleFactor) {
        zoneMinY = Math.max(edgeMargin, matchingZone.startY + 10 * fontScaleFactor);
        zoneMaxY = Math.min(maxBottomY, matchingZone.endY - 10 * fontScaleFactor);
      }
    }

    // Search window around the symbol, respecting zone bounds when reasonable
    const searchMinY = Math.max(edgeMargin, Math.min(zoneMinY, symbolRect.y - 160 * fontScaleFactor));
    const searchMaxY = Math.min(maxBottomY, Math.max(zoneMaxY, symbolRect.y + 340 * fontScaleFactor));

    // Evaluate two wrap profiles: standard (34 chars) and compact margin (24 chars)
    const charLimits = [34, 24];
    let bestCandidate: {
      x: number;
      y: number;
      w: number;
      h: number;
      lines: string[];
      cost: number;
    } | null = null;

    for (const charLimit of charLimits) {
      const lines = this.breakTextIntoMultiLines(reasoningText, charLimit);
      const maxLineW = Math.max(...lines.map(l => this.estimateTextWidth(l, reasoningSize)));
      const boxW = Math.min(actualWidth - edgeMargin * 2, maxLineW + Math.round(8 * fontScaleFactor));
      const boxH = lines.length * lineHeight + Math.round(4 * fontScaleFactor);

      const minX = edgeMargin;
      const maxX = Math.max(minX, actualWidth - boxW - edgeMargin);
      const minY = searchMinY;
      const maxY = Math.max(minY, searchMaxY - boxH);

      // Ideal right-hand anchor X: aligned with the ✗ symbol (or clamped to right margin so text never clips)
      const rightAnchorX = Math.max(minX, Math.min(Math.round(symbolRect.x), maxX));
      const minRightRegionX = Math.max(minX, Math.round(rightAnchorX - 180 * fontScaleFactor));

      // Build candidate list: right-hand side spots under/near the ✗ symbol
      const candidates: Array<[number, number]> = [
        // 1. Directly below the ✗ symbol (clamped to page right margin)
        [rightAnchorX, symbolRect.y + symbolRect.h + 6 * fontScaleFactor],
        // 2. Right of the ✗ symbol (if room in right margin)
        [symbolRect.x + symbolRect.w + 12 * fontScaleFactor, symbolRect.y],
        // 3. Flush against the right margin directly below the ✗ symbol
        [maxX, symbolRect.y + symbolRect.h + 6 * fontScaleFactor],
        // 4. Below the student work on the right side
        [rightAnchorX, studentRect.y + studentRect.h + 10 * fontScaleFactor]
      ];

      // Add 2D grid candidates on the right-hand side to avoid collisions & find empty space
      const stepX = Math.max(30, Math.round(45 * fontScaleFactor));
      const stepY = Math.max(20, Math.round(28 * fontScaleFactor));
      for (let gy = minY; gy <= maxY; gy += stepY) {
        candidates.push([rightAnchorX, gy]);
        candidates.push([maxX, gy]);
        for (let gx = minRightRegionX; gx <= maxX; gx += stepX) {
          candidates.push([gx, gy]);
        }
      }

      const collisionPad = Math.max(5, Math.round(8 * fontScaleFactor));

      for (const [rawX, rawY] of candidates) {
        const cx = Math.max(minX, Math.min(Math.round(rawX), maxX));
        const cy = Math.max(minY, Math.min(Math.round(rawY), maxY));
        const candRect: Rect2D = { x: cx, y: cy, w: boxW, h: boxH };

        // Hard check: do not overlap already-placed symbols or reasoning blocks
        const overlapsPlaced = occupiedRects.some(r => this.rectsOverlap(candRect, r, collisionPad));

        // Measure image ink density in [0, 1] (0 = pure blank paper)
        const inkDensity = inkMap ? inkMap.getInkDensity(cx, cy, boxW, boxH) : 0;

        // Measure overlap ratio with known student handwriting bboxes
        let studentOverlapArea = 0;
        for (const sw of studentWorkRects) {
          studentOverlapArea += this.rectIntersectionArea(candRect, sw);
        }
        const studentOverlapRatio = Math.min(1, studentOverlapArea / Math.max(1, boxW * boxH));

        // Distance from the ideal right-hand spot directly below the ✗ symbol
        const idealY = symbolRect.y + symbolRect.h + 6 * fontScaleFactor;
        const dxNorm = Math.abs(cx - rightAnchorX) / Math.max(0.5, fontScaleFactor);
        const dyNorm = Math.abs(cy - idealY) / Math.max(0.5, fontScaleFactor);

        // Penalty for placing above the symbol vs beside/below
        const abovePenalty = (cy + boxH < symbolRect.y) ? 80 : 0;
        // Slight preference for 34-char wrap unless 24-char wrap fits the right margin much cleaner
        const wrapPenalty = charLimit === 24 ? 14 : 0;
        // Heavy penalty if overlapping another placed annotation (used only if all candidates collide)
        const placedCollisionPenalty = overlapsPlaced ? 5000 : 0;

        const totalCost =
          placedCollisionPenalty +
          inkDensity * 850 +
          studentOverlapRatio * 500 +
          dxNorm * 1.35 +
          dyNorm * 0.55 +
          abovePenalty +
          wrapPenalty;

        if (!bestCandidate || totalCost < bestCandidate.cost) {
          bestCandidate = { x: cx, y: cy, w: boxW, h: boxH, lines, cost: totalCost };
        }
      }
    }

    if (!bestCandidate) return '';

    // Lock the winning rectangle so subsequent reasoning blocks won't overlap it
    const chosenRect: Rect2D = {
      x: bestCandidate.x,
      y: bestCandidate.y,
      w: bestCandidate.w,
      h: bestCandidate.h
    };
    occupiedRects.push(chosenRect);

    // Render red teacher handwriting directly on the empty paper (with subtle white halo for legibility)
    let outSvg = '';
    const haloStrokeWidth = Math.max(2.5, Math.round(3.5 * fontScaleFactor));
    const haloStyle = `paint-order="stroke fill" stroke="rgba(255, 255, 255, 0.88)" stroke-width="${haloStrokeWidth}px" stroke-linecap="round" stroke-linejoin="round"`;

    // Only draw a subtle teacher pointer line if the reasoning block had to move noticeably away from ✗
    const gapBetween = this.rectDistance(symbolRect, chosenRect);
    if (gapBetween > 75 * fontScaleFactor) {
      const [sx, sy, tx, ty] = this.getClosestConnectorPoints(symbolRect, chosenRect);
      const strokeW = Math.max(1.5, Math.round(2 * fontScaleFactor));
      const dash = `${Math.round(5 * fontScaleFactor)},${Math.round(4 * fontScaleFactor)}`;
      outSvg += `<line x1="${Math.round(sx)}" y1="${Math.round(sy)}" x2="${Math.round(tx)}" y2="${Math.round(ty)}" stroke="#e60000" stroke-width="${strokeW}" stroke-dasharray="${dash}" opacity="0.55" stroke-linecap="round" />`;
    }

    const firstBaselineY = bestCandidate.y + reasoningSize;
    bestCandidate.lines.forEach((line, i) => {
      const lineY = firstBaselineY + i * lineHeight;
      outSvg += `<text x="${bestCandidate!.x}" y="${lineY}" text-anchor="start" fill="#e60000" ${haloStyle} font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="bold">${this.escapeXml(line)}</text>`;
    });

    return outSvg;
  }

  // =========================================================================
  // 2D INK-DENSITY MAP & GEOMETRY HELPERS
  // =========================================================================

  private static async buildInkIntegralMap(
    imageBuffer: Buffer,
    actualWidth: number,
    actualHeight: number
  ): Promise<InkDensityMap> {
    const GRID_W = 180;
    const GRID_H = 240;

    const rawGray = await sharp(imageBuffer)
      .resize(GRID_W, GRID_H, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    const inkGrid = new Float32Array(GRID_W * GRID_H);
    const radius = 2; // 5x5 local window to estimate local paper background brightness

    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const idx = gy * GRID_W + gx;
        const pixel = rawGray[idx];

        let localMax = pixel;
        const y0 = Math.max(0, gy - radius);
        const y1 = Math.min(GRID_H - 1, gy + radius);
        const x0 = Math.max(0, gx - radius);
        const x1 = Math.min(GRID_W - 1, gx + radius);

        for (let wy = y0; wy <= y1; wy++) {
          const rowOffset = wy * GRID_W;
          for (let wx = x0; wx <= x1; wx++) {
            const val = rawGray[rowOffset + wx];
            if (val > localMax) localMax = val;
          }
        }

        // Dark regions outside the physical paper (e.g. dark desk border in camera photos) count as non-writable
        if (localMax < 85) {
          inkGrid[idx] = 1.0;
        } else {
          const contrast = localMax - pixel;
          // Ignore gradual lighting shadows (contrast <= 16); capture handwriting, printed text, and dark borders
          inkGrid[idx] = contrast > 16 ? Math.min(1.0, (contrast - 16) / 36) : 0;
        }
      }
    }

    // Build 2D Summed-Area Table (Integral Image) for O(1) rectangle queries
    const stride = GRID_W + 1;
    const sat = new Float64Array(stride * (GRID_H + 1));

    for (let gy = 1; gy <= GRID_H; gy++) {
      let rowSum = 0;
      for (let gx = 1; gx <= GRID_W; gx++) {
        rowSum += inkGrid[(gy - 1) * GRID_W + (gx - 1)];
        sat[gy * stride + gx] = sat[(gy - 1) * stride + gx] + rowSum;
      }
    }

    return {
      getInkDensity(px: number, py: number, pw: number, ph: number): number {
        const gx1 = Math.max(0, Math.min(GRID_W - 1, Math.floor((px / actualWidth) * GRID_W)));
        const gy1 = Math.max(0, Math.min(GRID_H - 1, Math.floor((py / actualHeight) * GRID_H)));
        const gx2 = Math.max(gx1 + 1, Math.min(GRID_W, Math.ceil(((px + pw) / actualWidth) * GRID_W)));
        const gy2 = Math.max(gy1 + 1, Math.min(GRID_H, Math.ceil(((py + ph) / actualHeight) * GRID_H)));

        const sum =
          sat[gy2 * stride + gx2] -
          sat[gy1 * stride + gx2] -
          sat[gy2 * stride + gx1] +
          sat[gy1 * stride + gx1];
        const count = Math.max(1, (gx2 - gx1) * (gy2 - gy1));
        return sum / count;
      }
    };
  }

  private static estimateTextWidth(text: string, fontSize: number): number {
    if (!text) return 0;
    let units = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if ('iljtf1.,;:!|()[]\'" '.includes(ch)) units += 0.32;
      else if ('mwMW@%✓✗'.includes(ch)) units += 0.82;
      else if (ch >= 'A' && ch <= 'Z') units += 0.64;
      else if (ch >= '0' && ch <= '9') units += 0.56;
      else units += 0.54;
    }
    return Math.ceil(units * fontSize * 1.08);
  }

  private static rectsOverlap(a: Rect2D, b: Rect2D, pad: number = 0): boolean {
    return (
      a.x < b.x + b.w + pad &&
      a.x + a.w + pad > b.x &&
      a.y < b.y + b.h + pad &&
      a.y + a.h + pad > b.y
    );
  }

  private static rectIntersectionArea(a: Rect2D, b: Rect2D): number {
    const xOverlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const yOverlap = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return xOverlap * yOverlap;
  }

  private static rectDistance(a: Rect2D, b: Rect2D): number {
    const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
    const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    return Math.hypot(dx, dy);
  }

  private static getClosestConnectorPoints(from: Rect2D, to: Rect2D): [number, number, number, number] {
    const fx = from.x + from.w / 2;
    const fy = from.y + from.h / 2;
    const tx = to.x + to.w / 2;
    const ty = to.y + to.h / 2;

    const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
    const sx = clamp(tx, from.x, from.x + from.w);
    const sy = clamp(ty, from.y, from.y + from.h);
    const ex = clamp(fx, to.x, to.x + to.w);
    const ey = clamp(fy, to.y, to.y + to.h);
    return [sx, sy, ex, ey];
  }

  // =========================================================================
  // HELPER METHODS
  // =========================================================================

  private static breakTextIntoMultiLines(text: string, maxCharsPerLine: number = 25): string[] {
    if (text.length <= maxCharsPerLine) return [text];
    const lines: string[] = [];
    let remaining = text.trim();
    while (remaining.length > maxCharsPerLine) {
      let breakPoint = maxCharsPerLine;
      for (let i = maxCharsPerLine; i >= Math.floor(maxCharsPerLine * 0.7); i--) {
        if ([' ', ',', '.', ';'].includes(remaining[i])) {
          breakPoint = i;
          break;
        }
      }
      lines.push(remaining.substring(0, breakPoint).trim());
      remaining = remaining.substring(breakPoint).replace(/^[.,;:\s]+/, '').trim();
    }
    if (remaining.length > 0) {
      if (lines.length > 0 && remaining.length <= 2) {
        lines[lines.length - 1] = `${lines[lines.length - 1]}${remaining}`;
      } else {
        lines.push(remaining);
      }
    }
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