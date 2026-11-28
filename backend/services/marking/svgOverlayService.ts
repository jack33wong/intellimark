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
  color?: string;
}

export interface RubricStampItem {
  questionNumber: string;
  stampText: string;
  targetY?: number;
}

export class SVGOverlayService {

  private static CONFIG: SVGOverlayConfig = {
    fontFamily: "'Kalam', 'Comic Neue', 'Comic Sans MS', 'DejaVu Sans', cursive, sans-serif",
    baseFontSizes: {
      reasoning: 34,
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
      baseRadius: 54,
      baseFontSize: 28,
      marginRight: 75,
      marginTop: 28,
      baseStrokeWidth: 8,
      minRadius: 28,
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
    hasDensityError?: boolean,
    rubricStamps?: RubricStampItem[],
    printedFooterRects?: Array<{ x: number; y: number; w: number; h: number }>,
    allPageStudentRects?: Array<{ x: number; y: number; w: number; h: number }>,
    gradeText?: string
  ): Promise<string> {
    try {
      const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
      const hasStamps = Array.isArray(rubricStamps) && rubricStamps.length > 0;
      if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText && !hasDensityError && !hasStamps) {
        return originalImageData;
      }

      const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      // Only run a full rotate() re-encode if the image has EXIF orientation > 1;
      // images from ImageUtils.preProcess (WebP) are already upright with known dimensions.
      let uprightImageBuffer: Buffer = imageBuffer;
      let burnWidth = imageDimensions.width;
      let burnHeight = imageDimensions.height;

      if (!burnWidth || !burnHeight || !originalImageData.startsWith('data:image/webp;')) {
        const imageMetadata = await sharp(imageBuffer).metadata();
        if (imageMetadata.orientation && imageMetadata.orientation > 1) {
          uprightImageBuffer = await sharp(imageBuffer).rotate().toBuffer();
          const rotatedMeta = await sharp(uprightImageBuffer).metadata();
          burnWidth = rotatedMeta.width || imageDimensions.width;
          burnHeight = rotatedMeta.height || imageDimensions.height;
        } else {
          burnWidth = imageMetadata.width || imageDimensions.width;
          burnHeight = imageMetadata.height || imageDimensions.height;
        }
      }

      // Build fast 2D integral ink-density map from the page image so reasoning text finds genuine empty paper
      let inkMap: InkDensityMap | undefined;
      try {
        inkMap = await this.buildInkIntegralMap(uprightImageBuffer, burnWidth, burnHeight);
      } catch (inkErr) {
        console.warn('[SVGOverlayService] Could not build ink integral map, falling back to bbox-only placement:', inkErr);
      }

      const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, { width: burnWidth, height: burnHeight }, scoreToDraw, totalScoreText, hasMetaPage, semanticZones, hasDensityError, inkMap, rubricStamps, printedFooterRects, allPageStudentRects, gradeText);
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

  private static createSVGOverlay(annotations: Annotation[], actualWidth: number, actualHeight: number, originalDimensions: ImageDimensions, scoreToDraw?: any, totalScoreText?: string, hasMetaPage?: boolean, semanticZones?: any[], hasDensityError?: boolean, inkMap?: InkDensityMap, rubricStamps?: RubricStampItem[], printedFooterRects?: Array<{ x: number; y: number; w: number; h: number }>, allPageStudentRects?: Array<{ x: number; y: number; w: number; h: number }>, gradeText?: string): string {
    const hasScores = (Array.isArray(scoreToDraw) ? scoreToDraw.length > 0 : !!scoreToDraw);
    const hasStamps = Array.isArray(rubricStamps) && rubricStamps.length > 0;
    if ((!annotations || annotations.length === 0) && !hasScores && !totalScoreText && (!semanticZones || semanticZones.length === 0) && !hasDensityError && !hasStamps) {
      return '';
    }

    // ⚡ [MERGE-FIX] Auto-Merge overlapping annotations (e.g. "M1" + "M1" -> "M1 M1")
    // This cleans up the UI when multiple marks land on the same spot.
    annotations = this.mergeOverlappingAnnotations(annotations, actualWidth, actualHeight);

    const fontScaleFactor = Math.min(
      actualHeight / this.CONFIG.baseReferenceHeight,
      actualWidth / 1650
    );

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

    // Track occupied rectangles (symbols, score circles, printed footers, and placed reasoning blocks)
    const occupiedRects: Rect2D[] = [];
    // Track student handwriting bboxes so we avoid placing reasoning text over student work
    const studentWorkRects: Rect2D[] = [];

    if (Array.isArray(allPageStudentRects) && allPageStudentRects.length > 0) {
      allPageStudentRects.forEach(r => {
        if (r && r.w > 5 && r.h > 5 && !isNaN(r.x) && !isNaN(r.y)) {
          studentWorkRects.push({ x: r.x, y: r.y, w: r.w, h: r.h });
        }
      });
    }

    if (Array.isArray(printedFooterRects) && printedFooterRects.length > 0) {
      printedFooterRects.forEach(r => {
        if (r && r.w > 0 && r.h > 0 && !isNaN(r.x) && !isNaN(r.y)) {
          occupiedRects.push({ x: r.x, y: r.y, w: r.w, h: r.h });
        }
      });
    }

    // Pre-register top-right score circles into occupiedRects
    const scoresArray = hasScores ? (Array.isArray(scoreToDraw) ? scoreToDraw : [scoreToDraw]) : [];
    if (hasScores) {
      const config = this.CONFIG.circleMark;
      const circleRadius = Math.max(12, Math.round(config.baseRadius * fontScaleFactor));
      const pad = Math.max(3, Math.round(10 * fontScaleFactor));
      scoresArray.forEach((_, idx) => {
        const circleX = actualWidth - (circleRadius + config.marginRight * fontScaleFactor);
        const verticalGap = circleRadius * 2.5;
        const circleY = circleRadius + (config.marginTop * fontScaleFactor) + (idx * verticalGap);
        occupiedRects.push({
          x: circleX - circleRadius - pad,
          y: circleY - circleRadius - pad,
          w: circleRadius * 2 + pad * 2,
          h: circleRadius * 2 + pad * 2
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
      const allSymbolRects: Rect2D[] = [];
      const lineIdLastRightX = new Map<string, number>();

      // PASS 0 (Space-Gated): Consolidate multi-criteria visual/graph sub-questions (>=2 VISUAL marks)
      // into a compact teacher-style checklist stamp when clean whitespace is available.
      // Automatically falls back to normal inline symbols on crowded pages.
      const { stampSvg: visualChecklistSvg, consumedAnnotations } = this.createVisualChecklistStampsSVG(
        sortedAnnotations,
        actualWidth,
        actualHeight,
        occupiedRects,
        studentWorkRects,
        inkMap
      );
      svg += visualChecklistSvg;

      // PASS 1: Render all symbols (✓ P1, ✗ M0, ✗ A0, circles, underlines, Not attempted pills) and lock their positions
      // (Collision avoidance in createSymbolAnnotation handles exact-bbox & shared line_id horizontal stacking cleanly)
      sortedAnnotations.forEach((annotation, index) => {
        if (consumedAnnotations.has(annotation)) return;
        try {
          svg += this.createAnnotationSVG(
            annotation,
            index,
            actualWidth,
            actualHeight,
            0,
            occupiedRects,
            deferredReasonings,
            allSymbolRects,
            lineIdLastRightX,
            studentWorkRects
          );
        } catch (error) {
          console.error(`SVG Generation Error [Idx: ${index}]:`, error);
        }
      });

      // Expand studentRect.h for single-cross sub-questions that have unannotated lower lines
      // so Pass 2 places margin reasoning cleanly below the full multi-line response.
      const deferredCountBySubQ = new Map<string, number>();
      deferredReasonings.forEach((d) => {
        if (d.subQuestion) {
          const norm = String(d.subQuestion).toLowerCase().replace(/\s+/g, '');
          deferredCountBySubQ.set(norm, (deferredCountBySubQ.get(norm) || 0) + 1);
        }
      });

      deferredReasonings.forEach((item) => {
        if (item.annotation?.action !== 'cross' || !item.subQuestion) return;
        const normSub = String(item.subQuestion).toLowerCase().replace(/\s+/g, '');
        if ((deferredCountBySubQ.get(normSub) || 0) !== 1) return;

        const matchingZone = flatZones.length > 0
          ? (flatZones.find(z => String(z.label || '').toLowerCase().replace(/\s+/g, '') === normSub) ||
             flatZones.find(z => {
               const zLabel = String(z.label || '').toLowerCase().replace(/\s+/g, '');
               return zLabel.length > 0 && (zLabel.endsWith(normSub) || normSub.endsWith(zLabel));
             }))
          : undefined;

        if (!Array.isArray(allPageStudentRects) || allPageStudentRects.length === 0) return;

        const nextSymY = allSymbolRects
          .filter(r => r.y > item.symbolRect.y + 4)
          .reduce((minY, r) => Math.min(minY, r.y), actualHeight);
        const zoneTop = matchingZone ? matchingZone.startY - 15 * fontScaleFactor : item.studentRect.y - 10 * fontScaleFactor;
        const zoneBottom = matchingZone ? Math.min(matchingZone.endY + 25 * fontScaleFactor, nextSymY) : nextSymY;

        // Only expand studentRect through vertically contiguous lines of the SAME answer.
        // Stop immediately on any gap larger than ~1.5-2 handwriting lines so we never bridge
        // across printed prompts/diagrams into the next sub-question (e.g. Q15a -> Q15b, Q20b -> Q20c).
        const maxContiguousLineGap = Math.round(95 * fontScaleFactor);
        const maxExpandedBottomY = Math.min(zoneBottom, item.symbolRect.y + Math.round(300 * fontScaleFactor));
        let maxSubQuestionLineBottomY = item.studentRect.y + item.studentRect.h;

        const sortedRects = allPageStudentRects
          .filter(sw => {
            const swCenterY = sw.y + sw.h / 2;
            return swCenterY >= zoneTop && swCenterY <= maxExpandedBottomY && sw.y + sw.h > maxSubQuestionLineBottomY;
          })
          .sort((a, b) => a.y - b.y);

        for (const sw of sortedRects) {
          if (sw.y <= maxSubQuestionLineBottomY + maxContiguousLineGap) {
            if (sw.y + sw.h > maxSubQuestionLineBottomY) {
              maxSubQuestionLineBottomY = sw.y + sw.h;
            }
          } else {
            break;
          }
        }

        if (maxSubQuestionLineBottomY > item.studentRect.y + item.studentRect.h) {
          item.studentRect.h = maxSubQuestionLineBottomY - item.studentRect.y;
        }
      });

      // PASS 2: Place deferred reasoning text blocks into the nearest empty space (teacher-style)
      deferredReasonings.forEach((item) => {
        try {
          const otherSymbolRects = allSymbolRects.filter(
            r => !(r.x === item.symbolRect.x && r.y === item.symbolRect.y && r.w === item.symbolRect.w && r.h === item.symbolRect.h)
          );
          svg += this.renderTeacherStyleReasoning(
            item,
            actualWidth,
            actualHeight,
            occupiedRects,
            studentWorkRects,
            flatZones,
            inkMap,
            otherSymbolRects
          );
        } catch (error) {
          console.error('SVG Reasoning Placement Error:', error);
        }
      });
    }

    const isSingleScoreDuplicate = Boolean(
      totalScoreText &&
      scoresArray.length === 1 &&
      scoresArray[0]?.scoreText?.trim() === totalScoreText.trim()
    );

    if (totalScoreText && !isSingleScoreDuplicate) {
      svg += this.createTotalScoreWithDoubleUnderline(totalScoreText, actualWidth, actualHeight, hasMetaPage, inkMap, occupiedRects, gradeText);
    }

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
      svg += this.createStudentScoreCircles(scoresArray, actualWidth, actualHeight, inkMap);
    }

    // --- END-OF-QUESTION RUBRIC STAMPS (LEVEL OF RESPONSE) ---
    if (hasStamps && rubricStamps) {
      svg += this.createRubricStampsSVG(rubricStamps, actualWidth, actualHeight, occupiedRects, studentWorkRects, inkMap);
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
    deferredReasonings: DeferredReasoningItem[],
    allSymbolRects?: Rect2D[],
    lineIdLastRightX?: Map<string, number>,
    studentWorkRects?: Rect2D[]
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

    if (action === 'not_attempted' || (annotation as any).isUnattempted === true) {
      svg += this.createNotAttemptedPill(
        annotation,
        scaledX,
        scaledY,
        scaledWidth,
        scaledHeight,
        actualWidth,
        actualHeight,
        occupiedRects
      );
    } else if (action === 'tick' || action === 'cross' || action === 'write' || (action as string) === 'partial') {
      let symbol = action === 'tick'
        ? '✓'
        : (action === 'cross'
          ? '✗'
          : ((action as string) === 'partial'
            ? '↑'
            : (text && text.length < 5 ? text : '✎')));
      if (action === 'tick' && text && /\bL[12]\b/i.test(text)) {
        symbol = '↑';
      }
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
        deferredReasonings,
        allSymbolRects,
        lineIdLastRightX,
        studentWorkRects
      );
    } else if (action === 'circle') {
      svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
      const reasoning = (annotation as any).reasoning;
      if ((text && text.trim()) || (reasoning && reasoning.trim())) {
        svg += this.createSymbolAnnotation(
          annotation,
          scaledX,
          scaledY,
          scaledWidth,
          scaledHeight,
          '⭕',
          text,
          reasoning,
          actualWidth,
          actualHeight,
          classificationText,
          occupiedRects,
          deferredReasonings,
          allSymbolRects,
          lineIdLastRightX,
          studentWorkRects
        );
      }
    } else if (action === 'underline') {
      svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
    }

    return svg;
  }


  private static createNotAttemptedPill(
    annotation: Annotation,
    x: number,
    y: number,
    width: number,
    height: number,
    actualWidth: number,
    actualHeight: number,
    occupiedRects: Rect2D[]
  ): string {
    const fontScaleFactor = Math.min(
      actualHeight / this.CONFIG.baseReferenceHeight,
      actualWidth / 1650
    );
    const fontSize = Math.max(10, Math.round(28 * fontScaleFactor));
    const padX = Math.max(6, Math.round(16 * fontScaleFactor));
    const padY = Math.max(4, Math.round(10 * fontScaleFactor));
    const rx = Math.max(6, Math.round(14 * fontScaleFactor));
    const edgeMargin = Math.max(6, Math.round(28 * fontScaleFactor));
    const printableRightLimit = Math.round(actualWidth * 0.90);

    const scoreBadgeText = (annotation as any).scoreBadgeText ? String((annotation as any).scoreBadgeText).trim() : '';
    const pillLabel = scoreBadgeText ? `${scoreBadgeText}  Not attempted` : 'Not attempted';
    const textW = this.estimateTextWidth(pillLabel, fontSize);
    const pillW = Math.min(printableRightLimit - edgeMargin, textW + padX * 2);
    const pillH = fontSize + padY * 2;

    const maxX = Math.max(edgeMargin, printableRightLimit - pillW);
    const maxY = Math.max(edgeMargin, actualHeight - edgeMargin - pillH);

    let pillX = Math.max(edgeMargin, Math.min(Math.round(x), maxX));
    let pillY = Math.max(edgeMargin, Math.min(Math.round(y), maxY));
    const pillRect: Rect2D = { x: pillX, y: pillY, w: pillW, h: pillH };

    const collisionGap = Math.max(2, Math.round(6 * fontScaleFactor));
    let attempts = 0;
    while (attempts < 10 && occupiedRects.some(r => this.rectsOverlap(pillRect, r, collisionGap))) {
      pillRect.y = Math.min(maxY, pillRect.y + Math.round(pillH + collisionGap));
      attempts++;
    }
    pillX = pillRect.x;
    pillY = pillRect.y;
    occupiedRects.push({ ...pillRect });

    const strokeW = Math.max(1, Number((2 * fontScaleFactor).toFixed(1)));
    const textY = pillY + padY + Math.round(fontSize * 0.82);

    return (
      `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${rx}" ` +
      `fill="rgba(243, 244, 246, 0.94)" stroke="#9CA3AF" stroke-width="${strokeW}" />` +
      `<text x="${pillX + padX}" y="${textY}" text-anchor="start" fill="#6B7280" ` +
      `font-family="${this.CONFIG.fontFamily}" font-size="${fontSize}" font-weight="600">${this.escapeXml(pillLabel)}</text>`
    );
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
    deferredReasonings: DeferredReasoningItem[],
    allSymbolRects?: Rect2D[],
    lineIdLastRightX?: Map<string, number>,
    studentWorkRects?: Rect2D[]
  ): string {
    const fontScaleFactor = Math.min(
      actualHeight / this.CONFIG.baseReferenceHeight,
      actualWidth / 1650
    );

    // 1. Resolution-proportional sizing (scales cleanly from 320x480 split pages up to 2400px+ scans)
    const baseSymbolSize = Math.max(9, Math.round(((symbol === '✓' || symbol === '↑') ? this.CONFIG.baseFontSizes.tick : this.CONFIG.baseFontSizes.cross) * fontScaleFactor));
    const baseTextSize = Math.max(8, Math.round(this.CONFIG.baseFontSizes.markingSchemeCode * fontScaleFactor));

    // --- CALCULATE SYMBOL LINE (LINE 1) ---
    let cleanCodeText = (text && text.trim()) ? text.trim() : '';
    const isEnglishAoBadge = /\[?AO\d|L[1-4]\]?/i.test(cleanCodeText);
    if (isEnglishAoBadge) {
      // Strip outer square brackets to save ~25px horizontal width (e.g. [AO5 L3] -> AO5 L3, [AO6] Grammar -> AO6 Grammar)
      cleanCodeText = cleanCodeText.replace(/\[([^\]]+)\]/g, '$1').trim();
    }

    const compactCodeText = isEnglishAoBadge
      ? cleanCodeText
          .replace(/^\[\vert{}\]$/g, '')
          .replace(/\[\vert{}\]/g, '')
          .replace(/\bCapitalisation\b/i, 'Caps')
          .replace(/\bPunctuation\b/i, 'Punct')
          .replace(/\bSpelling\b/i, 'Spell')
          .replace(/\bComma\s+splice\b/i, 'Comma')
          .trim()
      : cleanCodeText;

    const textSize = isEnglishAoBadge ? Math.max(7, Math.round(baseTextSize * 0.50)) : baseTextSize;
    const symbolSize = isEnglishAoBadge ? Math.max(8, Math.round(baseSymbolSize * 0.54)) : baseSymbolSize;
    const badgeFontFamily = this.CONFIG.fontFamily;
    const classificationSize = Math.max(7, Math.round(textSize * 0.8));

    const markingCodeWidth = compactCodeText ? this.estimateTextWidth(compactCodeText, textSize) : 0;

    const maxChars = 50;
    // Suppress classification text next to English AO badges so student sentences don't expand the badge or clash with margins
    const displayClassText = (!isEnglishAoBadge && classificationText && classificationText.trim())
      ? (classificationText.length > maxChars ? classificationText.substring(0, maxChars) + '...' : classificationText)
      : '';

    const classTextWidth = displayClassText ? this.estimateTextWidth(`(${displayClassText})`, classificationSize) : 0;

    const gapAfterSymbol = Math.max(2, Math.round(8 * fontScaleFactor));
    const gapAfterCode = Math.max(3, Math.round(10 * fontScaleFactor));

    const line1Width = symbolSize +
      (markingCodeWidth ? gapAfterSymbol + markingCodeWidth : 0) +
      (classTextWidth ? gapAfterCode + classTextWidth : 0) +
      Math.max(2, Math.round(8 * fontScaleFactor));

    const maxWidth = actualWidth * 0.8;
    const finalLine1Width = Math.min(line1Width, maxWidth);
    const line1Height = Math.max(symbolSize, textSize);

    // Layout Dimensions
    const edgeMargin = Math.max(6, Math.round(28 * fontScaleFactor));
    const padding = Math.max(3, Math.round(15 * fontScaleFactor));
    const maxBottomY = actualHeight - Math.max(18, Math.round(90 * fontScaleFactor));

    const isDrawingBox = Boolean(
      (annotation as any).isDrawing ||
      ((annotation as any).line_id && String((annotation as any).line_id).includes('visual_drawing')) ||
      ((annotation as any).linked_ocr_id && String((annotation as any).linked_ocr_id).includes('visual_drawing'))
    );

    let effectiveHeight = height;
    if (y + effectiveHeight > maxBottomY) {
      effectiveHeight = Math.max(40 * fontScaleFactor, maxBottomY - y);
    }

    const baseYOffsetPixels = (effectiveHeight * this.CONFIG.yPositions.baseYOffset) / 100;
    let symbolY = y + effectiveHeight + baseYOffsetPixels;
    if (isDrawingBox && effectiveHeight > 180 * fontScaleFactor) {
      symbolY = y + Math.min(Math.round(90 * fontScaleFactor), Math.round(effectiveHeight * 0.30));
    }
    symbolY = Math.max(edgeMargin + line1Height, Math.min(symbolY, maxBottomY));

    // --- PLACE THE SYMBOL LINE (LINE 1) ON THE RIGHT-HAND SIDE ---
    let rightEdgeOfStudentWork = x + width;

    // 📐 [ROW-END ANCHORING]: When a matched OCR block shares a horizontal y-band with other
    // student work blocks on the same line, anchor the tick/cross to the rightmost contiguous block
    // on that y-band — stopping at multi-column gaps (> 8% of page width) so left-column marks
    // never jump across a column divider onto right-column working.
    if (!isDrawingBox && !isEnglishAoBadge && Array.isArray(studentWorkRects) && studentWorkRects.length > 0 && height > 2) {
      const centerY = y + height / 2;
      const maxContiguousGap = Math.max(40, Math.round(actualWidth * 0.08));
      const sameBandRects = studentWorkRects
        .filter(sw => {
          if (sw.w <= 2 || sw.h <= 2) return false;
          const vOverlap = Math.min(y + height, sw.y + sw.h) - Math.max(y, sw.y);
          const minH = Math.max(1, Math.min(height, sw.h));
          const swCenterY = sw.y + sw.h / 2;
          const sameYBand =
            vOverlap >= minH * 0.4 ||
            Math.abs(centerY - swCenterY) <= Math.max(height, sw.h) * 0.55;
          return sameYBand && sw.x >= x - 10;
        })
        .sort((a, b) => a.x - b.x);

      const maxHorizontalSnap = Math.max(120, Math.round(actualWidth * 0.22));
      const baseRightEdge = x + width;
      for (const sw of sameBandRects) {
        if (sw.x > rightEdgeOfStudentWork + maxContiguousGap) {
          break;
        }
        // Never chain across wide answer-line prompts or jump > 22% of page width from the matched working block
        if (sw.w > actualWidth * 0.30 || sw.x + sw.w > baseRightEdge + maxHorizontalSnap) {
          break;
        }
        if (sw.x + sw.w > rightEdgeOfStudentWork) {
          rightEdgeOfStudentWork = sw.x + sw.w;
        }
      }
    }

    // Clamp all annotation X-coordinates inside the printable content frame (pageWidth * 0.90)
    const pageRightLimit = Math.round(actualWidth * 0.90);

    // Always place tick/cross and mark code on the right-hand side of student work (never flip to left)
    const isFlipped = false;
    const maxSymbolRightX = Math.max(edgeMargin, pageRightLimit - finalLine1Width);
    let symbolAnchorX = isEnglishAoBadge
      ? Math.max(Math.min(rightEdgeOfStudentWork + Math.round(8 * fontScaleFactor), maxSymbolRightX), Math.min(Math.round(actualWidth * 0.875), maxSymbolRightX))
      : Math.min(rightEdgeOfStudentWork + padding, maxSymbolRightX);

    // 📐 [HORIZONTAL STACKING FOR SHARED line_id]:
    // When multiple annotations target the same line_id, offset each subsequent mark horizontally
    // to the right of the previous mark's rendered width so they never overlap.
    const annoLineId = (annotation as any).line_id || (annotation as any).lineId;
    const horizontalStackGap = Math.max(6, Math.round(12 * fontScaleFactor));
    if (annoLineId && lineIdLastRightX && lineIdLastRightX.has(annoLineId)) {
      const prevRightX = lineIdLastRightX.get(annoLineId)!;
      symbolAnchorX = Math.min(Math.max(symbolAnchorX, prevRightX + horizontalStackGap), maxSymbolRightX);
    }

    let symBoxX = symbolAnchorX;
    let symBoxY = symbolY - line1Height * 0.85;
    const symRect: Rect2D = {
      x: symBoxX,
      y: symBoxY,
      w: finalLine1Width,
      h: line1Height
    };

    // Avoid symbol-on-symbol collision (e.g. ✓ P1, ✗ M0, and ✗ A0 on closely spaced lines)
    // First try shifting right past the colliding rect's rendered width (within pageRightLimit),
    // or 1 step upward before cascading downward.
    const shiftStep = Math.max(5, Math.round(16 * fontScaleFactor));
    const collisionGap = Math.max(1, 4 * fontScaleFactor);
    const hasSymCollision = (candidate: Rect2D) => occupiedRects.some(r => this.rectsOverlap(candidate, r, collisionGap));

    if (hasSymCollision(symRect)) {
      const collidingRects = occupiedRects.filter(r => this.rectsOverlap(symRect, r, collisionGap));
      const maxCollidingRightEdge = collidingRects.reduce((acc, r) => Math.max(acc, r.x + r.w), symBoxX);
      const shiftedRightX = Math.min(maxSymbolRightX, Math.round(maxCollidingRightEdge + horizontalStackGap));
      const rightCandidate: Rect2D = { ...symRect, x: shiftedRightX };
      const upShiftAmount = Math.max(shiftStep, line1Height + collisionGap + Math.round(2 * fontScaleFactor));
      const upCandidate: Rect2D = { ...symRect, y: symBoxY - upShiftAmount };

      if (shiftedRightX > symBoxX && !hasSymCollision(rightCandidate)) {
        symRect.x = shiftedRightX;
        symBoxX = shiftedRightX;
      } else if (upCandidate.y >= edgeMargin && !hasSymCollision(upCandidate)) {
        symRect.y = upCandidate.y;
        symBoxY = upCandidate.y;
        symbolY -= upShiftAmount;
      } else {
        let shiftAttempts = 0;
        while (shiftAttempts < 12 && hasSymCollision(symRect)) {
          symRect.y += shiftStep;
          symbolY += shiftStep;
          shiftAttempts++;
        }
      }
    }

    // Final hard clamp to printable right limit
    if (symRect.x + symRect.w > pageRightLimit) {
      symRect.x = Math.max(edgeMargin, pageRightLimit - symRect.w);
      symBoxX = symRect.x;
    }

    // Clamp to page bottom if shifted
    if (symRect.y + symRect.h > actualHeight - edgeMargin) {
      symRect.y = actualHeight - edgeMargin - symRect.h;
      symbolY = symRect.y + line1Height * 0.85;
    }

    occupiedRects.push({ ...symRect });
    if (allSymbolRects) {
      allSymbolRects.push({ ...symRect });
    }
    if (annoLineId && lineIdLastRightX) {
      lineIdLastRightX.set(annoLineId, Math.max(lineIdLastRightX.get(annoLineId) || 0, symRect.x + symRect.w));
    }

    // Queue reasoning text for Pass 2 (Teacher-Style Empty-Space Placement)
    // Supports: ✗ (Math/English/BYOMS errors), ⭕ (English SPaG circles), and ✓ / ↑ with English AO/Level tags (e.g. [AO2 L4], [AO2 L2])
    const isEnglishPositiveAoComment = (symbol === '✓' || symbol === '↑') && isEnglishAoBadge;
    if ((symbol === '✗' || symbol === '⭕' || symbol === '↑' || isEnglishPositiveAoComment) && reasoning && reasoning.trim()) {
      let cleanReasoning = reasoning
        .replace(/^\s*(?:\[[^\]]+\]\s*)+:?\s*/i, '') // Strip leading [1c] / [2b] subQuestion tags on canvas
        .replace(/^(?:Incorrect\s+(?:explanation|method|final\s+answer|answer|working|step|value)|Explanation\s+mark\s+not\s+awarded|Mark\s+not\s+awarded|Incorrect|Error)\s*:\s*/i, '')
        .replace(/^Final\s+answer\s+of\s+[^\s]+\s+is\s+incorrect[.,;]?\s*/i, '')
        .replace(/\|/g, '. ')
        .replace(/\.\s*\./g, '.')
        .replace(/[.\s]+$/, '')
        .trim();

      // Keep on-page teacher margin notes concise, allowing slightly more room when two marks merged onto one line
      const isMergedBadge = /\s/.test(cleanCodeText);
      const maxWords = isEnglishAoBadge ? 7 : (isMergedBadge ? 14 : 10);
      const maxCharsLimit = isEnglishAoBadge ? 62 : (isMergedBadge ? 85 : 72);

      // Preserve trailing `; ans: <value>` / `Ans: <value>` suffix when truncating so the correct answer is never cut off
      const trailingAnsMatch = !isEnglishAoBadge
        ? cleanReasoning.match(/((?:;\s*|\s+)(?:ans|correct)\s*:\s*[^;]+)$/i)
        : null;
      let ansSuffix = trailingAnsMatch ? trailingAnsMatch[1].replace(/^\s+/, '; ') : '';
      const prefixText = trailingAnsMatch
        ? cleanReasoning.slice(0, trailingAnsMatch.index).replace(/[;.,\s]+$/, '').trim()
        : cleanReasoning;

      // Strip redundant `; ans: <value>` when all significant answer tokens already appear in prefixText
      if (ansSuffix && prefixText) {
        const ansValue = ansSuffix.replace(/^;\s*(?:ans|correct)\s*:\s*/i, '').trim();
        const hasProseWord = /[a-zA-Z]{2,}/.test(prefixText);
        const tokenize = (s: string): string[] =>
          (s.toLowerCase().match(/-?[a-z0-9]+(?:[./][a-z0-9]+)*/g) || []);
        const STOP_TOKENS = new Set(['the', 'a', 'an', 'is', 'are', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or']);
        const prefixTokens = new Set(tokenize(prefixText));
        const significantAnsTokens = tokenize(ansValue).filter(t => !STOP_TOKENS.has(t));
        if (
          hasProseWord &&
          significantAnsTokens.length > 0 &&
          significantAnsTokens.every(t => prefixTokens.has(t))
        ) {
          cleanReasoning = prefixText;
          ansSuffix = '';
        }
      }

      if (cleanReasoning.length > maxCharsLimit) {
        if (ansSuffix) {
          const budgetForPrefix = maxCharsLimit - ansSuffix.length;
          if (budgetForPrefix <= 3 || !prefixText) {
            cleanReasoning = ansSuffix.replace(/^;\s*/, '').trim();
          } else {
            const words = prefixText.split(/\s+/);
            const sliced: string[] = [];
            for (const w of words) {
              const candidateStr = sliced.length === 0 ? w : `${sliced.join(' ')} ${w}`;
              if (candidateStr.length <= budgetForPrefix) {
                sliced.push(w);
              } else {
                break;
              }
            }
            while (sliced.length > 2 && /^(of|the|a|an|in|on|to|for|from|with|and|or|by|at|as|regarding|not|is|are)$/i.test(sliced[sliced.length - 1])) {
              sliced.pop();
            }
            const trimmedPrefix = sliced.join(' ').replace(/[;.,\s]+$/, '').trim();
            cleanReasoning = trimmedPrefix ? `${trimmedPrefix}${ansSuffix}` : ansSuffix.replace(/^;\s*/, '').trim();
          }
        } else {
          // Prefer taking the first sentence if it is self-contained (do not split on semicolons or decimal points like 3.14)
          const firstClause = cleanReasoning.split(/(?<!\d)\.(?!\d)|\(/)[0]?.trim();
          if (firstClause && firstClause.length >= 12 && firstClause.length <= maxCharsLimit) {
            cleanReasoning = firstClause;
          } else {
            const words = cleanReasoning.split(/\s+/);
            const sliced = words.slice(0, maxWords);
            while (sliced.length > 1 && sliced.join(' ').length > maxCharsLimit) {
              sliced.pop();
            }
            while (sliced.length > 4 && /^(of|the|a|an|in|on|to|for|from|with|and|or|by|at|as|regarding|not|is|are)$/i.test(sliced[sliced.length - 1])) {
              sliced.pop();
            }
            cleanReasoning = sliced.join(' ');
          }
        }
      }
      if (cleanReasoning.length > 0) {
        deferredReasonings.push({
          annotation,
          symbolRect: { ...symRect },
          studentRect: { x, y, w: Math.max(8, width), h: Math.max(8, height) },
          reasoningText: cleanReasoning,
          subQuestion: annotation.subQuestion,
          color: symbol === '✓' ? '#008000' : ((symbol === '⭕' || symbol === '↑') ? '#d97706' : '#e60000')
        });
      }
    }

    // --- RENDER SYMBOL LINE (WITH SUBTLE HALO INSTEAD OF OPAQUE BOX) ---
    let mainSVG = '';
    const mainColor = symbol === '✓' ? '#008000' : ((symbol === '⭕' || symbol === '↑') ? '#d97706' : '#ff0000');
    const haloStrokeWidth = Math.max(1.2, Number((3.5 * fontScaleFactor).toFixed(1)));
    const haloStyle = `paint-order="stroke fill" stroke="rgba(255, 255, 255, 0.88)" stroke-width="${haloStrokeWidth}px" stroke-linecap="round" stroke-linejoin="round"`;

    if (isEnglishAoBadge) {
      const pillPadX = Math.round(8 * fontScaleFactor);
      const pillPadY = Math.round(4 * fontScaleFactor);
      const pillRx = Math.round(8 * fontScaleFactor);
      const borderColor = symbol === '✓' ? 'rgba(22, 163, 74, 0.45)' : 'rgba(217, 119, 6, 0.45)';
      mainSVG += `<rect x="${symRect.x - pillPadX}" y="${symRect.y - pillPadY}" width="${symRect.w + pillPadX * 2}" height="${symRect.h + pillPadY * 2}" rx="${pillRx}" fill="rgba(255, 255, 255, 0.92)" stroke="${borderColor}" stroke-width="${Math.max(1.5, Math.round(2 * fontScaleFactor))}" />`;
    } else if (isDrawingBox) {
      const pillPadX = Math.round(6 * fontScaleFactor);
      const pillPadY = Math.round(3 * fontScaleFactor);
      const pillRx = Math.round(6 * fontScaleFactor);
      mainSVG += `<rect x="${symRect.x - pillPadX}" y="${symRect.y - pillPadY}" width="${symRect.w + pillPadX * 2}" height="${symRect.h + pillPadY * 2}" rx="${pillRx}" fill="rgba(255, 255, 255, 0.88)" />`;
    }

    let currentX = symRect.x;
    if (!isFlipped) {
      mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" ${haloStyle}
                  font-family="${this.CONFIG.fontFamily}" font-size="${symbolSize}" font-weight="bold">${symbol}</text>`;
      currentX += symbolSize + gapAfterSymbol;

      if (compactCodeText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="start" fill="${mainColor}" ${haloStyle}
                      font-family="${badgeFontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(compactCodeText)}</text>`;
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

      if (compactCodeText) {
        mainSVG += `<text x="${currentX}" y="${symbolY}" text-anchor="end" fill="${mainColor}" ${haloStyle}
                      font-family="${badgeFontFamily}" font-size="${textSize}" font-weight="bold">${this.escapeXml(compactCodeText)}</text>`;
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
    inkMap?: InkDensityMap,
    otherSymbolRects: Rect2D[] = []
  ): string {
    const fontScaleFactor = Math.min(
      actualHeight / this.CONFIG.baseReferenceHeight,
      actualWidth / 1650
    );
    // Target ~1.2%–1.4% of page height (~35% larger than legacy 26px/2400px) to match printed exam body text
    const rawScaledReasoning = Math.round(this.CONFIG.baseFontSizes.reasoning * fontScaleFactor);
    const minTargetSize = Math.ceil(actualHeight * 0.012);
    const maxTargetSize = Math.floor(actualHeight * 0.014);
    const reasoningSize = actualHeight >= 800
      ? Math.max(9, Math.max(minTargetSize, Math.min(maxTargetSize, rawScaledReasoning)))
      : Math.max(8, rawScaledReasoning);
    const lineHeight = Math.max(10, Math.round(reasoningSize * 1.24));
    const edgeMargin = Math.max(6, Math.round(30 * fontScaleFactor));
    const maxBottomY = actualHeight - Math.max(16, Math.round(80 * fontScaleFactor));
    const bgPadX = Math.max(4, Math.round(6 * fontScaleFactor));
    const bgPadY = Math.max(2, Math.round(4 * fontScaleFactor));
    // Wrapped comment max width (28% of page width), while unwrapped single-line comments may expand
    // up to 52% of page width whenever open blank space is available (still clamped inside 90% right margin).
    const maxCommentWidthPx = Math.round(actualWidth * 0.28);
    const maxSingleLineWidthPx = Math.round(actualWidth * 0.52);
    const printableRightLimit = Math.round(actualWidth * 0.90);

    const { symbolRect, studentRect, reasoningText, subQuestion } = item;

    // Keep default zone window anchored near the symbol so an early sub-question (e.g. 1aiii)
    // does not jump across subsequent sub-questions (1b, 1c) to the bottom of the page.
    let zoneMinY = Math.max(edgeMargin, symbolRect.y - Math.round(30 * fontScaleFactor));
    let zoneMaxY = Math.min(maxBottomY, symbolRect.y + Math.round(220 * fontScaleFactor));
    if (subQuestion && flatZones.length > 0) {
      const normSub = String(subQuestion).toLowerCase().replace(/\s+/g, '');
      const matchingZone =
        flatZones.find(z => String(z.label || '').toLowerCase().replace(/\s+/g, '') === normSub) ||
        flatZones.find(z => {
          const zLabel = String(z.label || '').toLowerCase().replace(/\s+/g, '');
          return zLabel.length > 0 && (zLabel.endsWith(normSub) || normSub.endsWith(zLabel));
        });
      if (matchingZone && matchingZone.endY - matchingZone.startY > 100 * fontScaleFactor) {
        zoneMinY = Math.max(edgeMargin, matchingZone.startY + 10 * fontScaleFactor);
        zoneMaxY = Math.min(maxBottomY, matchingZone.endY + Math.round(60 * fontScaleFactor));
      }
    }

    const isEnglishPositiveAoComment = item.color === '#008000' || item.color === '#d97706';
    const isFinalAnswerZeroMark = /\b[AB]0\b/i.test(String(item.annotation?.text || ''));
    const isNearPageBottom = symbolRect.y + symbolRect.h > actualHeight * 0.80;
    const preferAboveSymbol = isFinalAnswerZeroMark && isNearPageBottom;
    const hasMultiLineContinuationBelowSymbol =
      (studentRect.y + studentRect.h) > (symbolRect.y + symbolRect.h + Math.round(20 * fontScaleFactor));

    // Search window around the symbol, respecting zone bounds when reasonable
    const searchMinY = Math.max(edgeMargin, Math.min(zoneMinY, symbolRect.y - 110 * fontScaleFactor));
    const searchMaxY = Math.min(
      maxBottomY,
      Math.max(
        zoneMaxY,
        symbolRect.y + 240 * fontScaleFactor,
        studentRect.y + studentRect.h + Math.round(120 * fontScaleFactor)
      )
    );

    // Evaluate wrap profiles: single-line-first (72 chars up to 52% width) when empty space is available,
    // falling back to compact wrapped profiles (32, 22 chars within 28% width) when blocked by ink/margin.
    const charLimits = isEnglishPositiveAoComment ? [24, 20] : [72, 32, 22];
    let bestCandidate: {
      x: number;
      y: number;
      w: number;
      h: number;
      lines: string[];
      cost: number;
    } | null = null;

    const collisionPad = Math.max(2, Math.round(8 * fontScaleFactor));
    const normScale = Math.max(0.12, fontScaleFactor);

    const evaluateCandidates = (yStart: number, yEnd: number, limits: number[]) => {
      for (const charLimit of limits) {
        const effectiveMaxWidthPx = (!isEnglishPositiveAoComment && charLimit >= 60)
          ? maxSingleLineWidthPx
          : maxCommentWidthPx;
        const lines = this.breakTextToMaxWidth(reasoningText, reasoningSize, effectiveMaxWidthPx - bgPadX * 2, charLimit);
        const maxLineW = Math.max(...lines.map(l => this.estimateTextWidth(l, reasoningSize)));
        const boxW = Math.min(effectiveMaxWidthPx, maxLineW + bgPadX * 2);
        const boxH = lines.length * lineHeight + bgPadY * 2;

        const minX = edgeMargin;
        const maxX = Math.max(minX, printableRightLimit - boxW);
        const minY = yStart;
        const maxY = Math.max(minY, yEnd - boxH);

        // Ideal right-hand anchor X: aligned with the ✗ symbol (or clamped to right margin so text never clips)
        const rightAnchorX = Math.max(minX, Math.min(Math.round(symbolRect.x), maxX));
        const minRightRegionX = Math.max(minX, Math.round(rightAnchorX - 220 * fontScaleFactor));

        const belowStudentWorkY = studentRect.y + studentRect.h + Math.round(8 * fontScaleFactor);
        const aboveSymbolCandidate: [number, number] = [rightAnchorX, symbolRect.y - boxH - 8 * fontScaleFactor];
        const leftOfSymbolCandidate: [number, number] = [Math.max(minX, symbolRect.x - boxW - 12 * fontScaleFactor), symbolRect.y];
        const belowSymbolCandidate: [number, number] = [rightAnchorX, symbolRect.y + symbolRect.h + 6 * fontScaleFactor];
        const rightOfSymbolCandidate: [number, number] = [symbolRect.x + symbolRect.w + 12 * fontScaleFactor, symbolRect.y];
        const flushRightBelowCandidate: [number, number] = [maxX, symbolRect.y + symbolRect.h + 6 * fontScaleFactor];
        const belowStudentWorkCandidate: [number, number] = [rightAnchorX, belowStudentWorkY];

        // Build candidate list:
        // - For A0/B0 near page bottom: prioritize above-symbol first to avoid footer collisions
        // - Otherwise: prioritize inline right-of-symbol (Priority 1) when open space exists, then below-symbol (Priority 2), then left-shift fallback (Priority 3)
        const candidates: Array<[number, number]> = preferAboveSymbol
          ? [
              aboveSymbolCandidate,
              rightOfSymbolCandidate,
              belowSymbolCandidate,
              leftOfSymbolCandidate,
              flushRightBelowCandidate,
              belowStudentWorkCandidate
            ]
          : hasMultiLineContinuationBelowSymbol
            ? [
                rightOfSymbolCandidate,
                belowStudentWorkCandidate,
                flushRightBelowCandidate,
                belowSymbolCandidate,
                aboveSymbolCandidate,
                leftOfSymbolCandidate
              ]
            : [
                rightOfSymbolCandidate,
                belowSymbolCandidate,
                flushRightBelowCandidate,
                belowStudentWorkCandidate,
                aboveSymbolCandidate,
                leftOfSymbolCandidate
              ];

        // Add 2D grid candidates to avoid collisions & find empty space
        const stepX = Math.max(10, Math.round(40 * fontScaleFactor));
        const stepY = Math.max(6, Math.round(22 * fontScaleFactor));
        for (let gy = minY; gy <= maxY; gy += stepY) {
          candidates.push([rightAnchorX, gy]);
          candidates.push([maxX, gy]);
          for (let gx = minRightRegionX; gx <= maxX; gx += stepX) {
            candidates.push([gx, gy]);
          }
        }

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

          // Distance from the ideal right-hand spot (above symbol for A0/B0 near page bottom, below expanded student work for multi-line continuation, right/below symbol otherwise)
          const belowIdealY = hasMultiLineContinuationBelowSymbol
            ? belowStudentWorkY
            : symbolRect.y + symbolRect.h + 6 * fontScaleFactor;
          const aboveIdealY = Math.max(minY, symbolRect.y - boxH - 8 * fontScaleFactor);
          const isSameRowRight =
            Math.abs(cy - symbolRect.y) <= lineHeight * 1.5 &&
            cx >= symbolRect.x + symbolRect.w;
          const idealRightX = symbolRect.x + symbolRect.w + Math.round(12 * fontScaleFactor);
          const dxNorm = isSameRowRight
            ? Math.abs(cx - idealRightX) / normScale
            : Math.abs(cx - rightAnchorX) / normScale;
          const dyNorm = isSameRowRight
            ? 0
            : preferAboveSymbol
              ? Math.min(Math.abs(cy - aboveIdealY), Math.abs(cy - belowIdealY) + 6 * normScale) / normScale
              : Math.abs(cy - belowIdealY) / normScale;

          // Penalty for placing above the symbol vs beside/below (0 for A0/B0 final-answer annotations near page bottom)
          const abovePenalty = preferAboveSymbol ? 0 : ((cy + boxH < symbolRect.y) ? 80 : 0);

          // Non-Crossing Vertical Order Guard: prevent reasoning callout from jumping across an adjacent badge vertically
          let crossOrderPenalty = 0;
          for (const otherSym of otherSymbolRects) {
            if (Math.abs(otherSym.x - symbolRect.x) < 250 * fontScaleFactor) {
              if (otherSym.y > symbolRect.y + 4 && cy > otherSym.y) {
                crossOrderPenalty += 1500;
              } else if (otherSym.y + otherSym.h < symbolRect.y + 4 && cy < otherSym.y + otherSym.h) {
                crossOrderPenalty += 1500;
              }
            }
          }
          // Prefer single-line layout whenever open space is available (avoid unnecessary orphan wraps)
          const wrapPenalty = !isEnglishPositiveAoComment
            ? (lines.length > 1 ? 18 + (lines.length - 1) * 10 : 0)
            : 0;
          // Strict penalty if overlapping another placed symbol or reasoning block (NEVER allow smothering a badge)
          const placedCollisionPenalty = overlapsPlaced ? 100000 : 0;

          const isEnglishAoOrSpag = item.color === '#008000' || item.color === '#d97706';

          // Strict handwriting preservation for English: heavy penalty if candidate overlaps student handwriting
          const studentOverlapPenalty = isEnglishAoOrSpag
            ? (studentOverlapRatio > 0.04 ? 8000 : studentOverlapRatio * 2000)
            : studentOverlapRatio * 500;

          // Stepped ink penalty so printed lines like "(Total for Question X is Y marks)" strongly repel reasoning text
          const inkPenalty = isEnglishAoOrSpag
            ? (inkDensity > 0.12 ? 2500 + inkDensity * 2000 : inkDensity * 800)
            : (inkDensity > 0.08 ? 2500 + inkDensity * 2000 : inkDensity * 850);

          const totalCost =
            placedCollisionPenalty +
            inkPenalty +
            studentOverlapPenalty +
            crossOrderPenalty +
            dxNorm * 1.35 +
            dyNorm * 0.95 +
            abovePenalty +
            wrapPenalty;

          if (!bestCandidate || totalCost < bestCandidate.cost) {
            bestCandidate = { x: cx, y: cy, w: boxW, h: boxH, lines, cost: totalCost };
          }
        }
      }
    };

    evaluateCandidates(searchMinY, searchMaxY, charLimits);

    // If all candidates in the local zone collided with an already-placed annotation (cost >= 100000),
    // expand search to the full page height so two reasoning blocks NEVER overlap each other.
    if (!bestCandidate || bestCandidate.cost >= 100000) {
      evaluateCandidates(edgeMargin, maxBottomY, [22, 18]);
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

    // Render teacher handwriting directly on the empty paper (with subtle white halo for legibility)
    let outSvg = '';
    const textColor = item.color || '#e60000';
    const haloStrokeWidth = Math.max(1.2, Number((3.5 * fontScaleFactor).toFixed(1)));
    const haloStyle = `paint-order="stroke fill" stroke="rgba(255, 255, 255, 0.88)" stroke-width="${haloStrokeWidth}px" stroke-linecap="round" stroke-linejoin="round"`;

    // Draw a subtle teacher dotted pointer line only for short-to-medium offsets that do NOT cross heavy ink/drawings
    const gapBetween = this.rectDistance(symbolRect, chosenRect);
    const maxLeaderDistance = 260 * fontScaleFactor;
    if (gapBetween > 60 * fontScaleFactor && gapBetween <= maxLeaderDistance) {
      const [sx, sy, tx, ty] = this.getClosestConnectorPoints(symbolRect, chosenRect);
      let crossesHeavyInk = false;
      if (inkMap) {
        const probeSize = Math.max(12, Math.round(24 * fontScaleFactor));
        for (const t of [0.33, 0.5, 0.67]) {
          const px = sx + (tx - sx) * t - probeSize / 2;
          const py = sy + (ty - sy) * t - probeSize / 2;
          if (inkMap.getInkDensity(px, py, probeSize, probeSize) > 0.06) {
            crossesHeavyInk = true;
            break;
          }
        }
      }
      if (!crossesHeavyInk) {
        const strokeW = Math.max(1.0, Number((2 * fontScaleFactor).toFixed(1)));
        const dash = `${Math.max(2, Math.round(5 * fontScaleFactor))},${Math.max(2, Math.round(4 * fontScaleFactor))}`;
        outSvg += `<line x1="${Math.round(sx)}" y1="${Math.round(sy)}" x2="${Math.round(tx)}" y2="${Math.round(ty)}" stroke="${textColor}" stroke-width="${strokeW}" stroke-dasharray="${dash}" opacity="0.70" stroke-linecap="round" />`;
      }
    }

    // Subtle translucent white background pill with tight padding so comments blend naturally onto the paper
    const pillRx = Math.max(4, Math.round(7 * fontScaleFactor));
    outSvg += `<rect x="${chosenRect.x}" y="${chosenRect.y}" width="${chosenRect.w}" height="${chosenRect.h}" rx="${pillRx}" fill="rgba(255, 255, 255, 0.75)" />`;

    const firstBaselineY = bestCandidate.y + bgPadY + reasoningSize * 0.88;
    bestCandidate.lines.forEach((line, i) => {
      const lineY = firstBaselineY + i * lineHeight;
      outSvg += `<text x="${bestCandidate!.x + bgPadX}" y="${lineY}" text-anchor="start" fill="${textColor}" ${haloStyle} font-family="${this.CONFIG.fontFamily}" font-size="${reasoningSize}" font-weight="bold">${this.escapeXml(line)}</text>`;
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

  private static breakTextToMaxWidth(
    text: string,
    fontSize: number,
    maxPixelWidth: number,
    maxCharsPerLine: number = 28
  ): string[] {
    if (!text) return [''];
    const trimmed = text.trim();
    if (!trimmed) return [''];

    const words = trimmed.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else {
        const candidate = `${currentLine} ${word}`;
        if (
          candidate.length <= maxCharsPerLine &&
          this.estimateTextWidth(candidate, fontSize) <= maxPixelWidth
        ) {
          currentLine = candidate;
        } else {
          lines.push(currentLine);
          currentLine = word;
        }
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines;
  }

  private static breakTextIntoMultiLines(text: string, maxCharsPerLine: number = 25): string[] {
    if (!text || text.trim().length <= maxCharsPerLine) return [text ? text.trim() : ''];
    const lines: string[] = [];
    const words = text.trim().split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      if (!currentLine) {
        currentLine = word;
      } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
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

  private static createStudentScoreCircles(scores: any[], imageWidth: number, imageHeight: number, inkMap?: InkDensityMap): string {
    if (!scores || scores.length === 0) return '';
    const scaleFactor = Math.min(
      imageHeight / this.CONFIG.baseReferenceHeight,
      imageWidth / 1650
    );
    const config = this.CONFIG.circleMark;
    const circleRadius = Math.max(14, Math.round(config.baseRadius * 1.05 * scaleFactor));
    const scoreFontSize = Math.max(9, Math.round(config.baseFontSize * scaleFactor));
    const strokeWidth = Math.max(1.5, Number((config.baseStrokeWidth * 0.85 * scaleFactor).toFixed(1)));

    let svg = '';
    scores.forEach((scoreItem, index) => {
      const scoreText = scoreItem.scoreText || '0/0';
      const defaultX = imageWidth - (circleRadius + config.marginRight * scaleFactor);
      const verticalGap = circleRadius * 2.5;
      const defaultY = circleRadius + (config.marginTop * scaleFactor) + (index * verticalGap);

      let circleX = defaultX;
      let circleY = defaultY;

      // Avoid colliding with line 1 printed question text in the top-right header corner
      if (inkMap && index === 0) {
        const defaultInk = inkMap.getInkDensity(
          defaultX - circleRadius,
          defaultY - circleRadius,
          circleRadius * 2,
          circleRadius * 2
        );
        if (defaultInk > 0.03) {
          const candidates = [
            { x: imageWidth - circleRadius - Math.round(28 * scaleFactor), y: circleRadius + Math.round(18 * scaleFactor) },
            { x: defaultX, y: circleRadius + Math.round(16 * scaleFactor) },
            { x: imageWidth - circleRadius - Math.round(28 * scaleFactor), y: defaultY }
          ];
          let bestInk = defaultInk;
          for (const cand of candidates) {
            const cInk = inkMap.getInkDensity(
              cand.x - circleRadius,
              cand.y - circleRadius,
              circleRadius * 2,
              circleRadius * 2
            );
            if (cInk < bestInk - 0.005) {
              bestInk = cInk;
              circleX = cand.x;
              circleY = cand.y;
            }
          }
        }
      }

      const circle = `<circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="rgba(255, 255, 255, 0.90)" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
      const fractionMatch = String(scoreText).trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
      if (fractionMatch) {
        const [, numStr, denStr] = fractionMatch;
        const maxDigits = Math.max(numStr.length, denStr.length);
        // Scale number size directly against circleRadius so stacked digits fill the circle clearly
        const sizeRatio = maxDigits >= 3 ? 0.56 : 0.72;
        const fracFontSize = Math.max(10, Math.round(circleRadius * sizeRatio));
        const denFontSize = Math.max(9, Math.round(fracFontSize * 0.95));
        const barHalfW = Math.max(8, Math.round(circleRadius * 0.56));
        const barStroke = Math.max(1.5, Number((strokeWidth * 0.7).toFixed(1)));
        const numY = Math.round(circleY - circleRadius * 0.30);
        const barY = Math.round(circleY + circleRadius * 0.03);
        const denY = Math.round(circleY + circleRadius * 0.44);
        const fractionGroup =
          `<g transform="rotate(-2.5, ${circleX}, ${circleY})">` +
          `<text x="${circleX}" y="${numY}" text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${fracFontSize}" font-weight="bold">${this.escapeXml(numStr)}</text>` +
          `<line x1="${circleX - barHalfW}" y1="${barY}" x2="${circleX + barHalfW}" y2="${barY}" stroke="#ff0000" stroke-width="${barStroke}" stroke-linecap="round"/>` +
          `<text x="${circleX}" y="${denY}" text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${denFontSize}" font-weight="bold">${this.escapeXml(denStr)}</text>` +
          `</g>`;
        svg += circle + fractionGroup;
      } else {
        const textYAdjust = scoreFontSize * 0.35;
        const text = `<text x="${circleX}" y="${circleY + textYAdjust}" text-anchor="middle" dominant-baseline="middle" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${scoreFontSize}" font-weight="bold" transform="rotate(-2.5, ${circleX}, ${circleY})">${this.escapeXml(scoreText)}</text>`;
        svg += circle + text;
      }
    });
    return svg;
  }


  private static createTotalScoreWithDoubleUnderline(
    totalScoreText: string,
    imageWidth: number,
    imageHeight: number,
    hasMetaPage?: boolean,
    inkMap?: InkDensityMap,
    occupiedRects?: Rect2D[],
    gradeText?: string
  ): string {
    const scaleFactor = Math.min(
      imageHeight / this.CONFIG.baseReferenceHeight,
      imageWidth / 1650
    );
    const config = this.CONFIG.totalScore;
    // Scale font slightly down for scoped labels like "26/38 (Pages 1–8)" so it fits cleanly in the header
    const lengthScale = totalScoreText.length > 10 ? Math.max(0.68, 10 / totalScoreText.length) : 1.0;
    let fontSize = Math.max(12, Math.round(config.baseFontSize * scaleFactor * lengthScale));
    const strokeWidth = Math.max(1.5, Number((config.baseStrokeWidth * scaleFactor).toFixed(1)));

    const isTopLeft = hasMetaPage === false;
    // Cover-page offset: shift slightly upward and leftward so the total score sits cleanly
    // in the header above/left of the candidate info box border.
    const marginRight = isTopLeft
      ? Math.max(10, Math.round(config.marginRight * scaleFactor))
      : Math.max(20, Math.round(Math.max(145 * scaleFactor, imageWidth * 0.10)));
    let marginTop = isTopLeft
      ? Math.max(10, Math.round(config.marginTop * scaleFactor))
      : Math.max(8, Math.round(36 * scaleFactor));

    let textX: number, textAnchor: string;
    if (isTopLeft) {
      textX = marginRight;
      textAnchor = "start";
    } else {
      textX = imageWidth - marginRight;
      textAnchor = "end";
    }

    const underlineOffset = Math.max(3, Math.round(config.underlineOffset * scaleFactor));
    const underlineSpacing = Math.max(2, Math.round(config.underlineSpacing * scaleFactor));

    // Collision-free top-left placement: check inkMap & occupiedRects so wider scores (e.g. "51/108")
    // do not overlap printed Q1 header text on tightly cropped pages.
    if (isTopLeft && (inkMap || (occupiedRects && occupiedRects.length > 0))) {
      const computeScoreRect = (x: number, topY: number, fSize: number): Rect2D => {
        const w = this.estimateTextWidth(totalScoreText, fSize);
        const h = fSize + underlineOffset + underlineSpacing + strokeWidth;
        return { x, y: topY, w, h };
      };

      const scoreCandidateCost = (x: number, topY: number, fSize: number, sizePenalty: number): number => {
        const rect = computeScoreRect(x, topY, fSize);
        const ink = inkMap ? inkMap.getInkDensity(rect.x, rect.y, rect.w, rect.h) : 0;
        const overlapsOccupied = occupiedRects
          ? occupiedRects.some(r => this.rectsOverlap(rect, r, Math.round(8 * scaleFactor)))
          : false;
        const distPenalty = (Math.abs(x - marginRight) / Math.max(1, imageWidth)) * 40 +
          (Math.abs(topY - marginTop) / Math.max(1, imageHeight)) * 30;
        return (overlapsOccupied ? 10000 : 0) + (ink > 0.06 ? 1500 + ink * 2000 : ink * 800) + sizePenalty + distPenalty;
      };

      const defaultRect = computeScoreRect(textX, marginTop, fontSize);
      const defaultInk = inkMap ? inkMap.getInkDensity(defaultRect.x, defaultRect.y, defaultRect.w, defaultRect.h) : 0;
      const defaultCollides = occupiedRects
        ? occupiedRects.some(r => this.rectsOverlap(defaultRect, r, Math.round(8 * scaleFactor)))
        : false;

      if (defaultInk > 0.06 || defaultCollides) {
        let best = { x: textX, topY: marginTop, fSize: fontSize, cost: scoreCandidateCost(textX, marginTop, fontSize, 0) };
        const fontSizesToTry: Array<{ fSize: number; penalty: number }> = [
          { fSize: fontSize, penalty: 0 },
          { fSize: Math.max(12, Math.round(fontSize * 0.85)), penalty: 12 }
        ];
        const topYsToTry = [
          Math.max(6, Math.round(marginTop * 0.45)),
          marginTop,
          Math.round(marginTop * 1.35)
        ];
        // Scan across top header up to 68% width (leaving top-right clear for the page score circle)
        const maxHeaderX = Math.round(imageWidth * 0.68);
        const stepX = Math.max(20, Math.round(60 * scaleFactor));

        for (const { fSize, penalty } of fontSizesToTry) {
          const estW = this.estimateTextWidth(totalScoreText, fSize);
          for (const ty of topYsToTry) {
            for (let cx = Math.max(8, Math.round(marginRight * 0.5)); cx + estW <= maxHeaderX; cx += stepX) {
              const cost = scoreCandidateCost(cx, ty, fSize, penalty);
              if (cost < best.cost) {
                best = { x: cx, topY: ty, fSize, cost };
              }
            }
          }
        }

        textX = best.x;
        marginTop = best.topY;
        fontSize = best.fSize;
      }
    }

    const fractionMatch = String(totalScoreText).trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(.*)$/);
    const isStackedFraction = Boolean(fractionMatch);
    const numStr = fractionMatch ? fractionMatch[1] : '';
    const denStr = fractionMatch ? fractionMatch[2] : '';
    const suffixStr = fractionMatch ? fractionMatch[3].trim() : '';

    // Compute stacked fraction dimensions (or single-line fallback)
    const numFontSize = isStackedFraction ? Math.max(12, Math.round(fontSize * 0.78)) : fontSize;
    const denFontSize = isStackedFraction ? Math.max(11, Math.round(fontSize * 0.70)) : fontSize;
    const suffixFontSize = Math.max(10, Math.round(fontSize * 0.42));
    const fracBarGap = Math.max(3, Math.round(fontSize * 0.14));
    const fracBarStroke = Math.max(1.8, Number((strokeWidth * 0.9).toFixed(1)));

    const fractionColWidth = isStackedFraction
      ? Math.max(
          this.estimateTextWidth(numStr, numFontSize),
          this.estimateTextWidth(denStr, denFontSize),
          Math.round(fontSize * 0.95)
        ) + Math.round(fontSize * 0.24)
      : this.estimateTextWidth(totalScoreText, fontSize);
    const suffixWidth = suffixStr ? this.estimateTextWidth(` ${suffixStr}`, suffixFontSize) : 0;
    const estimatedTextWidth = fractionColWidth + suffixWidth;

    let underlineStartX: number, underlineEndX: number;
    if (isTopLeft) {
      underlineStartX = textX;
      underlineEndX = textX + estimatedTextWidth;
    } else {
      underlineStartX = textX - estimatedTextWidth;
      underlineEndX = textX;
    }

    const scoreBlockHeight = isStackedFraction
      ? numFontSize + fracBarGap * 2 + fracBarStroke + denFontSize
      : fontSize;
    const textY = marginTop + scoreBlockHeight;
    const underlineY1 = textY + underlineOffset;
    const underlineY2 = textY + underlineOffset + underlineSpacing;

    // Optional teacher-style red handwritten grade stamp on Meta / Front Cover page for past papers
    const cleanGrade = typeof gradeText === 'string' ? gradeText.trim() : '';
    const shouldDrawGrade = Boolean(!isTopLeft && hasMetaPage && cleanGrade && cleanGrade !== 'N/A' && cleanGrade !== 'Partial Paper');
    let gradeSvg = '';
    let groupLeftX = underlineStartX;
    let totalHeight = scoreBlockHeight + underlineOffset + underlineSpacing + strokeWidth;

    if (shouldDrawGrade) {
      const isNumericGrade = /^\d+(\.\d+)?$/.test(cleanGrade);
      const gradeDisplay = isNumericGrade ? `Grade ${cleanGrade}` : cleanGrade;
      const gradeFontSize = isNumericGrade
        ? Math.max(12, Math.round(fontSize * 0.92))
        : Math.max(fontSize, Math.round(fontSize * 1.15));
      const verticalGap = Math.max(10, Math.round(fontSize * 0.28));
      const gradeY = underlineY2 + verticalGap + gradeFontSize;
      const estimatedGradeWidth = this.estimateTextWidth(gradeDisplay, gradeFontSize);
      groupLeftX = Math.min(underlineStartX, Math.max(8, textX - estimatedGradeWidth));
      totalHeight = (gradeY - marginTop) + Math.round(gradeFontSize * 0.15);

      gradeSvg = `<text x="${textX}" y="${gradeY}" text-anchor="end" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${gradeFontSize}" font-weight="bold">${this.escapeXml(gradeDisplay)}</text>`;
    }

    if (occupiedRects) {
      occupiedRects.push({
        x: groupLeftX,
        y: marginTop,
        w: underlineEndX - groupLeftX,
        h: totalHeight
      });
    }

    const pivotX = Math.round((groupLeftX + underlineEndX) / 2);
    const pivotY = Math.round(marginTop + totalHeight * 0.5);

    let scoreSvg = '';
    if (isStackedFraction) {
      const fracCenterX = Math.round(underlineStartX + fractionColWidth / 2);
      const numY = Math.round(marginTop + numFontSize);
      const barY = Math.round(numY + fracBarGap);
      const denY = Math.round(barY + fracBarGap + denFontSize * 0.88);
      const barInset = Math.round(fontSize * 0.06);
      scoreSvg =
        `<text x="${fracCenterX}" y="${numY}" text-anchor="middle" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${numFontSize}" font-weight="bold">${this.escapeXml(numStr)}</text>` +
        `<line x1="${underlineStartX + barInset}" y1="${barY}" x2="${underlineStartX + fractionColWidth - barInset}" y2="${barY}" stroke="#ff0000" stroke-width="${fracBarStroke}" stroke-linecap="round" opacity="0.95"/>` +
        `<text x="${fracCenterX}" y="${denY}" text-anchor="middle" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${denFontSize}" font-weight="bold">${this.escapeXml(denStr)}</text>`;
      if (suffixStr) {
        const suffixX = underlineStartX + fractionColWidth + Math.round(fontSize * 0.14);
        const suffixY = Math.round(barY + suffixFontSize * 0.35);
        scoreSvg += `<text x="${suffixX}" y="${suffixY}" text-anchor="start" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${suffixFontSize}" font-weight="bold">${this.escapeXml(suffixStr)}</text>`;
      }
    } else {
      scoreSvg = `<text x="${textX}" y="${textY}" text-anchor="${textAnchor}" dominant-baseline="baseline" fill="#ff0000" font-family="${this.CONFIG.fontFamily}" font-size="${fontSize}" font-weight="bold">${this.escapeXml(totalScoreText)}</text>`;
    }

    const underline1 = `<line x1="${underlineStartX}" y1="${underlineY1}" x2="${underlineEndX}" y2="${underlineY1}" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;
    const underline2 = `<line x1="${underlineStartX}" y1="${underlineY2}" x2="${underlineEndX}" y2="${underlineY2}" stroke="#ff0000" stroke-width="${strokeWidth}" opacity="0.9"/>`;

    return `<g transform="rotate(-2.5, ${pivotX}, ${pivotY})">${gradeSvg}${scoreSvg}${underline1}${underline2}</g>`;
  }

  private static createRubricStampsSVG(
    rubricStamps: RubricStampItem[],
    imageWidth: number,
    imageHeight: number,
    occupiedRects: Rect2D[],
    studentWorkRects: Rect2D[],
    inkMap?: InkDensityMap
  ): string {
    if (!rubricStamps || rubricStamps.length === 0) return '';
    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const fontSize = Math.max(18, Math.round(28 * scaleFactor));
    const padX = Math.max(16, Math.round(24 * scaleFactor));
    const padY = Math.max(12, Math.round(18 * scaleFactor));
    const lineHeight = Math.round(fontSize * 1.35);
    const margin = Math.max(24, Math.round(40 * scaleFactor));

    let maxWorkBottomY = 0;
    studentWorkRects.forEach(r => {
      if (r.y + r.h > maxWorkBottomY) maxWorkBottomY = r.y + r.h;
    });

    if (inkMap) {
      const stripX = Math.round(imageWidth * 0.12);
      const stripW = Math.round(imageWidth * 0.85) - stripX;
      const stripH = Math.round(28 * scaleFactor);
      const scanStep = Math.max(12, Math.round(18 * scaleFactor));
      const scanStartY = Math.round(imageHeight * 0.88);
      const scanEndY = Math.round(imageHeight * 0.15);

      for (let sy = scanStartY; sy >= scanEndY; sy -= scanStep) {
        const density = inkMap.getInkDensity(stripX, sy, stripW, stripH);
        if (density > 0.10) {
          const lowestInkY = sy + stripH;
          maxWorkBottomY = Math.max(maxWorkBottomY, lowestInkY);
          break;
        }
      }
    }

    let svg = '';
    rubricStamps.forEach((stamp, idx) => {
      const fullLabel = stamp.questionNumber
        ? `Q${stamp.questionNumber}: ${stamp.stampText}`
        : stamp.stampText;
      const lines = fullLabel.split(/\n+/).flatMap(l => this.breakTextIntoMultiLines(l.trim(), 52));
      const maxLineWidth = Math.max(...lines.map(l => this.estimateTextWidth(l, fontSize)), 220 * scaleFactor);
      const boxW = Math.min(imageWidth - margin * 2, maxLineWidth + padX * 2);
      const boxH = lines.length * lineHeight + padY * 2;

      const boxX = Math.max(margin, imageWidth - boxW - margin);

      const minPossibleY = Math.max(margin, Math.round(imageHeight * 0.15));
      const maxPossibleY = Math.max(minPossibleY, imageHeight - boxH - margin);
      const effectiveBottomY = Math.max(stamp.targetY || 0, maxWorkBottomY);
      const isPageFull = effectiveBottomY > 0 && (effectiveBottomY + Math.round(24 * scaleFactor) + boxH > imageHeight - margin);

      let preferredY: number;
      if (isPageFull) {
        // Full page: place in clean bottom margin between answer box bottom and barcode footer
        preferredY = Math.min(maxPossibleY, imageHeight - boxH - Math.round(95 * scaleFactor));
      } else if (effectiveBottomY > 0) {
        preferredY = Math.min(maxPossibleY, effectiveBottomY + Math.round(24 * scaleFactor) + idx * (boxH + Math.round(16 * scaleFactor)));
      } else {
        preferredY = Math.max(minPossibleY, imageHeight - boxH - margin - idx * (boxH + Math.round(16 * scaleFactor)));
      }

      const clampedPreferredY = Math.max(minPossibleY, Math.min(preferredY, maxPossibleY));

      // Build candidate list starting below work or bottom margin, evaluating ink density
      const candidates: number[] = [clampedPreferredY];
      const stepY = Math.max(16, Math.round(20 * scaleFactor));

      for (let cy = clampedPreferredY + stepY; cy <= maxPossibleY; cy += stepY) {
        candidates.push(cy);
      }
      const bottomGutterY = Math.max(minPossibleY, Math.min(imageHeight - boxH - Math.round(95 * scaleFactor), maxPossibleY));
      if (!candidates.includes(bottomGutterY)) {
        candidates.push(bottomGutterY);
      }
      for (let cy = clampedPreferredY - stepY; cy >= minPossibleY; cy -= stepY) {
        candidates.push(cy);
      }

      let bestCand: { y: number; cost: number } | null = null;
      const collisionPad = Math.max(5, Math.round(6 * scaleFactor));

      for (const candY of candidates) {
        const testRect: Rect2D = { x: boxX, y: candY, w: boxW, h: boxH };
        const overlapsOccupied = occupiedRects.some(r => this.rectsOverlap(testRect, r, collisionPad));
        if (overlapsOccupied) continue;

        const ink = inkMap ? inkMap.getInkDensity(boxX, candY, boxW, boxH) : 0;
        let workOverlap = 0;
        for (const sw of studentWorkRects) {
          workOverlap += this.rectIntersectionArea(testRect, sw);
        }
        const workOverlapRatio = Math.min(1, workOverlap / Math.max(1, boxW * boxH));
        const aboveWorkPenalty = (candY < effectiveBottomY + Math.round(12 * scaleFactor)) ? 2500 : 0;
        const distPenalty = Math.abs(candY - clampedPreferredY) * 0.15;

        const cost = ink * 1200 + workOverlapRatio * 800 + aboveWorkPenalty + distPenalty;

        if (!bestCand || cost < bestCand.cost) {
          bestCand = { y: candY, cost };
          if (ink < 0.03 && workOverlapRatio === 0 && aboveWorkPenalty === 0) {
            break;
          }
        }
      }

      const boxY = bestCand ? bestCand.y : clampedPreferredY;
      const finalRect: Rect2D = { x: boxX, y: boxY, w: boxW, h: boxH };
      occupiedRects.push(finalRect);

      const rx = Math.max(8, Math.round(12 * scaleFactor));
      const strokeW = Math.max(2, Math.round(3.5 * scaleFactor));
      svg += `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${rx}" fill="rgba(255, 250, 240, 0.94)" stroke="#b91c1c" stroke-width="${strokeW}" />`;
      lines.forEach((line, lIdx) => {
        const textY = boxY + padY + fontSize * 0.85 + lIdx * lineHeight;
        svg += `<text x="${boxX + padX}" y="${textY}" font-family="${this.CONFIG.fontFamily}" font-size="${fontSize}" font-weight="bold" fill="#991b1b">${this.escapeXml(line)}</text>`;
      });
    });

    return svg;
  }

  /**
   * Space-gated teacher-style checklist stamp for multi-criteria visual/graph sub-questions
   * (e.g. graph sketches, scatter plots, diagrams with >= 2 VISUAL marks).
   * Only activates when a genuinely clear, low-ink region is available around/inside the diagram;
   * otherwise returns empty for that sub-question so existing inline annotations render untouched.
   */
  private static createVisualChecklistStampsSVG(
    annotations: Annotation[],
    imageWidth: number,
    imageHeight: number,
    occupiedRects: Rect2D[],
    studentWorkRects: Rect2D[],
    inkMap?: InkDensityMap
  ): { stampSvg: string; consumedAnnotations: Set<Annotation> } {
    const consumedAnnotations = new Set<Annotation>();
    if (!annotations || annotations.length < 2) {
      return { stampSvg: '', consumedAnnotations };
    }

    const isVisualAnno = (a: Annotation): boolean => Boolean(
      (a as any).ocr_match_status === 'VISUAL' ||
      (a as any).isDrawing ||
      ((a as any).line_id && String((a as any).line_id).includes('visual_drawing')) ||
      ((a as any).linked_ocr_id && String((a as any).linked_ocr_id).includes('visual_drawing'))
    );

    const groupsBySubQ = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const subQ = String((a as any).subQuestion || '').trim();
      if (!subQ) continue;
      if (!groupsBySubQ.has(subQ)) groupsBySubQ.set(subQ, []);
      groupsBySubQ.get(subQ)!.push(a);
    }

    const scaleFactor = imageHeight / this.CONFIG.baseReferenceHeight;
    const headerFontSize = Math.max(15, Math.round(23 * scaleFactor));
    const rowFontSize = Math.max(14, Math.round(20 * scaleFactor));
    const padX = Math.max(10, Math.round(16 * scaleFactor));
    const padY = Math.max(8, Math.round(13 * scaleFactor));
    const headerLineH = Math.round(headerFontSize * 1.35);
    const rowLineH = Math.round(rowFontSize * 1.32);
    const rowGap = Math.max(4, Math.round(7 * scaleFactor));
    const checkBoxSize = Math.max(12, Math.round(17 * scaleFactor));
    const margin = Math.max(20, Math.round(32 * scaleFactor));
    const collisionPad = Math.max(6, Math.round(8 * scaleFactor));
    const maxBoxW = Math.min(Math.round(imageWidth * 0.30), Math.round(620 * scaleFactor));
    const minBoxW = Math.min(maxBoxW, Math.max(180, Math.round(280 * scaleFactor)));

    let stampSvg = '';

    for (const [subQ, group] of groupsBySubQ.entries()) {
      if (group.length < 2 || group.length > 5) continue;
      if (!group.every(a => a.action === 'tick' || a.action === 'cross')) continue;

      const visualMembers = group.filter(isVisualAnno);
      if (visualMembers.length < 2) continue;

      // Compute diagram bounding box from visual/drawing annotations in this sub-question
      let diagMinX = Infinity;
      let diagMinY = Infinity;
      let diagMaxX = -Infinity;
      let diagMaxY = -Infinity;
      for (const vm of visualMembers) {
        if (!vm.bbox || vm.bbox.length < 4) continue;
        const [bx, by, bw, bh] = vm.bbox;
        diagMinX = Math.min(diagMinX, bx);
        diagMinY = Math.min(diagMinY, by);
        diagMaxX = Math.max(diagMaxX, bx + Math.max(bw, 40));
        diagMaxY = Math.max(diagMaxY, by + Math.max(bh, 40));
      }
      if (!Number.isFinite(diagMinX) || !Number.isFinite(diagMinY)) continue;

      // Also expand diagram box if studentWorkRects overlap it (gives true visual footprint of the graph)
      const diagBox: Rect2D = {
        x: diagMinX,
        y: diagMinY,
        w: Math.max(80, diagMaxX - diagMinX),
        h: Math.max(80, diagMaxY - diagMinY)
      };

      // Build compact checklist rows — sum mark tokens (e.g. merged "B1 B1 B1" = 3 marks, "B0" = 1 mark)
      const countAnnotationMarks = (anno: Annotation): { earned: number; total: number } => {
        const rawText = String(anno.text || '').trim();
        const isTick = anno.action === 'tick';
        const tokens = rawText.match(/[A-Z]+(\d+)/gi);
        if (tokens && tokens.length > 0) {
          let earned = 0;
          let total = 0;
          for (const tok of tokens) {
            const numMatch = tok.match(/(\d+)$/);
            const val = numMatch ? parseInt(numMatch[1], 10) : (isTick ? 1 : 0);
            if (val > 0) {
              earned += val;
              total += val;
            } else {
              total += 1;
            }
          }
          return { earned: isTick ? earned : 0, total: Math.max(1, total) };
        }
        return { earned: isTick ? 1 : 0, total: 1 };
      };

      let earnedCount = 0;
      let totalCount = 0;
      for (const a of group) {
        const m = countAnnotationMarks(a);
        earnedCount += m.earned;
        totalCount += m.total;
      }
      const cleanSubLabel = subQ.replace(/^Q/i, '');
      const headerText = `Q${cleanSubLabel} Check (${earnedCount}/${totalCount})`;

      const textColIndent = checkBoxSize + Math.max(8, Math.round(10 * scaleFactor));
      const availableTextW = Math.max(120, maxBoxW - padX * 2 - textColIndent);
      const maxCharsPerLine = Math.max(18, Math.floor(availableTextW / (rowFontSize * 0.56)));

      type PreparedRow = {
        isTick: boolean;
        code: string;
        lines: string[];
      };

      const rows: PreparedRow[] = group.map(a => {
        const isTick = a.action === 'tick';
        const code = String(a.text || (isTick ? 'B1' : 'B0')).trim();
        const rawReason = String((a as any).reasoning || (a as any).content_desc || (isTick ? 'Correct' : 'Incorrect')).trim();
        const fullRowText = `${code} ${rawReason}`.trim();
        const wrapped = this.breakTextIntoMultiLines(fullRowText, maxCharsPerLine);
        const clampedLines = wrapped.slice(0, 2);
        if (wrapped.length > 2 && clampedLines[1]) {
          clampedLines[1] = clampedLines[1].replace(/\s+\S*$/, '').slice(0, Math.max(10, maxCharsPerLine - 1)) + '…';
        }
        return { isTick, code, lines: clampedLines };
      });

      const headerWidth = this.estimateTextWidth(headerText, headerFontSize);
      const maxRowTextW = Math.max(
        ...rows.flatMap(r => r.lines.map(l => this.estimateTextWidth(l, rowFontSize))),
        0
      );
      const boxW = Math.min(
        maxBoxW,
        Math.max(minBoxW, Math.ceil(Math.max(headerWidth, maxRowTextW + textColIndent) + padX * 2))
      );

      const headerSectionH = headerLineH + Math.max(6, Math.round(8 * scaleFactor));
      const rowsTotalH = rows.reduce((acc, r, idx) => {
        return acc + r.lines.length * rowLineH + (idx < rows.length - 1 ? rowGap : 0);
      }, 0);
      const boxH = padY * 2 + headerSectionH + rowsTotalH;

      // Space guard: never try to stamp if box doesn't even fit inside page margins
      if (boxW > imageWidth - margin * 2 || boxH > imageHeight - margin * 2) continue;

      // Build candidate positions: right gutter -> left gutter -> below diagram -> empty inner quadrant
      const gap = Math.max(14, Math.round(22 * scaleFactor));
      const minX = margin;
      const maxX = Math.max(minX, imageWidth - margin - boxW);
      const minY = margin;
      const maxY = Math.max(minY, imageHeight - margin - boxH);

      interface StampCandidate {
        x: number;
        y: number;
        isInnerQuadrant: boolean;
        priorityPenalty: number;
      }

      const candidates: StampCandidate[] = [];
      const addCand = (x: number, y: number, isInnerQuadrant: boolean, priorityPenalty: number) => {
        const cx = Math.round(Math.max(minX, Math.min(x, maxX)));
        const cy = Math.round(Math.max(minY, Math.min(y, maxY)));
        if (!candidates.some(c => Math.abs(c.x - cx) < 12 && Math.abs(c.y - cy) < 12)) {
          candidates.push({ x: cx, y: cy, isInnerQuadrant, priorityPenalty });
        }
      };

      const ySteps = [
        diagBox.y,
        diagBox.y + Math.round((diagBox.h - boxH) / 2),
        diagBox.y + diagBox.h - boxH,
        diagBox.y - Math.round(boxH * 0.4)
      ];

      // 1. Right gutter of diagram (and page right margin)
      const rightX = diagBox.x + diagBox.w + gap;
      for (const yPos of ySteps) {
        if (rightX <= maxX) addCand(rightX, yPos, false, 0);
        addCand(maxX, yPos, false, 20);
      }

      // 2. Left gutter of diagram
      const leftX = diagBox.x - gap - boxW;
      if (leftX >= minX) {
        for (const yPos of ySteps) {
          addCand(leftX, yPos, false, 35);
        }
      }

      // 3. Directly below diagram
      const belowY = diagBox.y + diagBox.h + gap;
      if (belowY <= maxY) {
        addCand(diagBox.x + diagBox.w - boxW, belowY, false, 45);
        addCand(diagBox.x, belowY, false, 50);
        addCand(maxX, belowY, false, 55);
      }

      // 4. Empty inner quadrants of diagram (only if diagram is large enough to hold stamp cleanly)
      if (diagBox.w >= boxW * 1.35 && diagBox.h >= boxH * 1.35) {
        const inset = Math.max(10, Math.round(14 * scaleFactor));
        addCand(diagBox.x + diagBox.w - boxW - inset, diagBox.y + inset, true, 65);
        addCand(diagBox.x + diagBox.w - boxW - inset, diagBox.y + diagBox.h - boxH - inset, true, 70);
        addCand(diagBox.x + inset, diagBox.y + inset, true, 75);
        addCand(diagBox.x + inset, diagBox.y + diagBox.h - boxH - inset, true, 80);
      }

      // Filter non-diagram student work rects so outer candidates don't cover algebra/tables
      const nonDiagWorkRects = studentWorkRects.filter(sw => !this.rectsOverlap(sw, diagBox, 10));

      let bestCand: { x: number; y: number; cost: number } | null = null;
      for (const cand of candidates) {
        const rect: Rect2D = { x: cand.x, y: cand.y, w: boxW, h: boxH };
        if (occupiedRects.some(r => this.rectsOverlap(rect, r, collisionPad))) continue;

        let nonDiagOverlapArea = 0;
        for (const sw of nonDiagWorkRects) {
          nonDiagOverlapArea += this.rectIntersectionArea(rect, sw);
        }
        const nonDiagOverlapRatio = nonDiagOverlapArea / Math.max(1, boxW * boxH);
        if (nonDiagOverlapRatio > 0.08) continue;

        const ink = inkMap ? inkMap.getInkDensity(cand.x, cand.y, boxW, boxH) : 0;
        const maxAllowedInk = cand.isInnerQuadrant ? 0.06 : 0.12;
        if (ink > maxAllowedInk) continue;

        const cost = ink * 1500 + nonDiagOverlapRatio * 1000 + cand.priorityPenalty;
        if (!bestCand || cost < bestCand.cost) {
          bestCand = { x: cand.x, y: cand.y, cost };
        }
      }

      // Automatic safe fallback: if page is too crowded, skip stamp and let inline marks render
      if (!bestCand) continue;

      const finalRect: Rect2D = { x: bestCand.x, y: bestCand.y, w: boxW, h: boxH };
      occupiedRects.push(finalRect);
      group.forEach(a => consumedAnnotations.add(a));

      const rx = Math.max(6, Math.round(10 * scaleFactor));
      const borderW = Math.max(1.5, Math.round(2.5 * scaleFactor * 10) / 10);
      const ratio = totalCount > 0 ? earnedCount / totalCount : 0;
      const headerColor = earnedCount === totalCount ? '#15803d' : (ratio < 0.4 ? '#b91c1c' : '#b45309');

      stampSvg += `<g class="visual-checklist-stamp">`;
      stampSvg += `<rect x="${finalRect.x}" y="${finalRect.y}" width="${boxW}" height="${boxH}" rx="${rx}" fill="rgba(255, 255, 255, 0.94)" stroke="#334155" stroke-width="${borderW}" />`;

      // Header + subtle divider
      const headerTextY = Math.round(finalRect.y + padY + headerFontSize * 0.85);
      stampSvg += `<text x="${finalRect.x + padX}" y="${headerTextY}" font-family="${this.CONFIG.fontFamily}" font-size="${headerFontSize}" font-weight="bold" fill="${headerColor}">${this.escapeXml(headerText)}</text>`;
      const dividerY = Math.round(finalRect.y + padY + headerLineH + Math.max(2, Math.round(3 * scaleFactor)));
      stampSvg += `<line x1="${finalRect.x + padX}" y1="${dividerY}" x2="${finalRect.x + boxW - padX}" y2="${dividerY}" stroke="#cbd5e1" stroke-width="${Math.max(1, Math.round(1.5 * scaleFactor))}" />`;

      // Checklist rows
      let cursorY = finalRect.y + padY + headerSectionH;
      const cbStroke = Math.max(1.2, Math.round(1.8 * scaleFactor * 10) / 10);
      const markStroke = Math.max(2, Math.round(2.6 * scaleFactor * 10) / 10);

      for (const row of rows) {
        const cbX = finalRect.x + padX;
        const cbY = Math.round(cursorY + (rowLineH - checkBoxSize) * 0.45);
        const cbRx = Math.max(2, Math.round(3 * scaleFactor));

        // Checkbox square
        stampSvg += `<rect x="${cbX}" y="${cbY}" width="${checkBoxSize}" height="${checkBoxSize}" rx="${cbRx}" fill="#ffffff" stroke="${row.isTick ? '#16a34a' : '#dc2626'}" stroke-width="${cbStroke}" />`;

        if (row.isTick) {
          const p1x = cbX + checkBoxSize * 0.22;
          const p1y = cbY + checkBoxSize * 0.54;
          const p2x = cbX + checkBoxSize * 0.44;
          const p2y = cbY + checkBoxSize * 0.76;
          const p3x = cbX + checkBoxSize * 0.82;
          const p3y = cbY + checkBoxSize * 0.26;
          stampSvg += `<polyline points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)}" fill="none" stroke="#16a34a" stroke-width="${markStroke}" stroke-linecap="round" stroke-linejoin="round" />`;
        } else {
          const x1 = cbX + checkBoxSize * 0.24;
          const y1 = cbY + checkBoxSize * 0.24;
          const x2 = cbX + checkBoxSize * 0.76;
          const y2 = cbY + checkBoxSize * 0.76;
          stampSvg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#dc2626" stroke-width="${markStroke}" stroke-linecap="round" />`;
          stampSvg += `<line x1="${x2.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#dc2626" stroke-width="${markStroke}" stroke-linecap="round" />`;
        }

        const textColor = row.isTick ? '#15803d' : '#b91c1c';
        row.lines.forEach((line, lIdx) => {
          const ty = Math.round(cursorY + rowFontSize * 0.85 + lIdx * rowLineH);
          stampSvg += `<text x="${finalRect.x + padX + textColIndent}" y="${ty}" font-family="${this.CONFIG.fontFamily}" font-size="${rowFontSize}" font-weight="${lIdx === 0 ? 'bold' : 'normal'}" fill="${textColor}">${this.escapeXml(line)}</text>`;
        });

        cursorY += row.lines.length * rowLineH + rowGap;
      }

      stampSvg += `</g>`;
    }

    return { stampSvg, consumedAnnotations };
  }

  private static getMarkTokenRank(token: string): number {
    const clean = token.replace(/[\[\]()]/g, '').trim().toUpperCase();
    if (/^d?B\d/i.test(clean)) return 1;
    if (/^d?P\d/i.test(clean)) return 2;
    if (/^d?M\d/i.test(clean)) return 3;
    if (/^d?C\d/i.test(clean)) return 4;
    if (/^d?A\d/i.test(clean)) return 5;
    return 6;
  }

  private static sortMergedMarkCodes(textA?: string, textB?: string): string {
    const tokens = [textA, textB]
      .filter((t): t is string => Boolean(t && t.trim()))
      .flatMap(t => t.trim().split(/\s+/))
      .filter(Boolean);
    if (tokens.length <= 1) return tokens.join(' ');
    return tokens
      .sort((a, b) => this.getMarkTokenRank(a) - this.getMarkTokenRank(b))
      .join(' ');
  }

  private static mergeReasoningStrings(r1?: string, r2?: string): string | undefined {
    const clean1 = (r1 || '').trim();
    const clean2 = (r2 || '').trim();
    if (!clean1) return clean2 || undefined;
    if (!clean2) return clean1 || undefined;
    if (clean1.toLowerCase() === clean2.toLowerCase()) return clean1;
    if (clean1.toLowerCase().includes(clean2.toLowerCase())) return clean1;
    if (clean2.toLowerCase().includes(clean1.toLowerCase())) return clean2;

    const isAnsOnly = (s: string) => /^(?:ans|correct)\s*:/i.test(s);
    // Always place the diagnostic reason first and "Ans: ..." second
    if (isAnsOnly(clean1) && !isAnsOnly(clean2)) {
      const ansPart = clean1.replace(/^Ans\s*:/i, 'ans:');
      return `${clean2.replace(/[;.,\s]+$/, '')}; ${ansPart}`;
    }
    if (!isAnsOnly(clean1) && isAnsOnly(clean2)) {
      const ansPart = clean2.replace(/^Ans\s*:/i, 'ans:');
      return `${clean1.replace(/[;.,\s]+$/, '')}; ${ansPart}`;
    }
    return `${clean1.replace(/[;.,\s]+$/, '')}; ${clean2}`;
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
        const newText = this.sortMergedMarkCodes(existing.text, anno.text);
        const mergedReasoning = this.mergeReasoningStrings(
          (existing as any).reasoning,
          (anno as any).reasoning
        );
        mergedInfos.set(key, {
          ...existing,
          text: newText,
          ...(mergedReasoning ? { reasoning: mergedReasoning } : {})
        } as Annotation);
      } else {
        mergedInfos.set(key, anno);
      }
    }
    return [...standalone, ...mergedInfos.values()];
  }
}