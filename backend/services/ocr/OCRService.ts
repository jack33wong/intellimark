/**
 * OCR Service
 * Implements Enhanced Hybrid Architecture: Extract -> Post-process -> Inject Signal -> Segment -> Filter
 */

import sharp from 'sharp';

import type { ProcessedVisionResult } from '../../types/index.js';
import { MathpixService } from './MathpixService.js';
// Ensure MathBlock type is correctly imported/defined
import { detectMathBlocks, getCropOptions, type MathBlock } from './MathDetectionService.js';
import { GoogleVisionService } from './GoogleVisionService.js';
import type { DetectedBlock } from './BlockClusteringService.js';
// Import OCRCleanupService for direct use
import { OCRCleanupService } from './OCRCleanupService.js';
// ========================= START OF NEW DEPENDENCY =========================
import * as stringSimilarity from 'string-similarity';
import { sanitizeOcrArtifacts } from '../../utils/TextNormalizationUtils.js';
// ========================== END OF NEW DEPENDENCY ==========================


// (Interfaces OCRResult, OCROptions, and type exports remain the same as in the prompt)
export interface OCRResult {
  text: string;
  boundingBoxes: any[];
  confidence: number;
  dimensions: { width: number; height: number };
  symbols: Array<{
    text: string;
    boundingBox: any;
    confidence: number;
  }>;
  mathBlocks: MathBlock[];
  processingTime: number;
  rawResponse?: any;
  usage?: { mathpixCalls: number };
  cleanedOcrText?: string;
  cleanDataForMarking?: any;
  unifiedLookupTable?: Record<string, { bbox: number[]; cleanedText: string }>;
}

export interface OCROptions {
  // enablePreprocessing is handled in Stage 1, so we ignore it here if passed.
  mathThreshold?: number;
  minMathBlockSize?: number;
  maxMathBlockSize?: number;
  dbscanEpsPx?: number;
  dbscanMinPts?: number;
}

export class OCRService {
  // MODIFIED: Update DEFAULT_OPTIONS for better fallback clustering.
  // Increasing dbscanEpsPx (Epsilon) helps group handwritten elements that are further apart horizontally.
  private static readonly DEFAULT_OPTIONS: Required<Omit<OCROptions, 'enablePreprocessing'>> = {
    mathThreshold: 0.35,
    minMathBlockSize: 20,
    maxMathBlockSize: 2000,
    dbscanEpsPx: 60, // Increased from 40 to 60
    dbscanMinPts: 2
  };

  /**
   * Helper function to robustly extract bounding box from various Mathpix v3/text line_data formats.
   * (This is the robust version that handles 'cnt')
   */
  public static extractBoundingBox(line: any): { x: number, y: number, width: number, height: number } | null {
    const region = line.region;

    const isValidNumber = (val: any): boolean => val != null && !isNaN(Number(val));

    // (Formats 1, 2, 3 remain the same)
    if (region) {
      if (isValidNumber(region.top_left_x) && isValidNumber(region.top_left_y) && isValidNumber(region.width) && isValidNumber(region.height)) {
        return {
          x: Number(region.top_left_x),
          y: Number(region.top_left_y),
          width: Number(region.width),
          height: Number(region.height)
        };
      }
      if (isValidNumber(region.x) && isValidNumber(region.y) && (isValidNumber(region.w) || isValidNumber(region.width)) && (isValidNumber(region.h) || isValidNumber(region.height))) {
        return {
          x: Number(region.x),
          y: Number(region.y),
          width: Number(region.w ?? region.width),
          height: Number(region.h ?? region.height)
        };
      }
    }

    if (isValidNumber(line.x) && isValidNumber(line.y) && isValidNumber(line.width) && isValidNumber(line.height)) {
      return {
        x: Number(line.x),
        y: Number(line.y),
        width: Number(line.width),
        height: Number(line.height)
      };
    }

    // Format 4: Contours/Points (Handles 'cnt')
    const points = line.cnt || line.contours || line.points;
    if (points && Array.isArray(points) && points.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      points.forEach(point => {
        const x = Array.isArray(point) ? point[0] : point.x;
        const y = Array.isArray(point) ? point[1] : point.y;

        if (isValidNumber(x) && isValidNumber(y)) {
          minX = Math.min(minX, Number(x));
          minY = Math.min(minY, Number(y));
          maxX = Math.max(maxX, Number(x));
          maxY = Math.max(maxY, Number(y));
        }
      });

      if (minX !== Infinity) {
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY
        };
      }
    }

    return null;
  }

  // --- NEW: Helper for boundary detection using fuzzy matching ---
  private static findBoundaryByFuzzyMatch(
    ocrLines: Array<any>,
    questionText: string | undefined
  ): number {

    if (!questionText || questionText.trim().length === 0) {
      console.warn('  -> No question text provided. Treating all as student work.');
      return 0; // Keep this initial fallback
    }

    const questionLines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
    if (questionLines.length === 0) {
      console.warn('  -> Question text was empty after splitting. Falling back.');
      return 0;
    }

    const SIMILARITY_THRESHOLD = 0.80;
    let lastMatchIndex = -1;

    for (let i = 0; i < ocrLines.length; i++) {
      const ocrLineText = ocrLines[i].latex_styled || ocrLines[i].text || '';
      if (!ocrLineText.trim()) continue;
      const bestMatch = stringSimilarity.findBestMatch(ocrLineText, questionLines);
      if (bestMatch.bestMatch.rating >= SIMILARITY_THRESHOLD) {
        lastMatchIndex = i;
      }
    }

    let boundaryIndex = 0;
    if (lastMatchIndex !== -1) {
      // Fuzzy match succeeded
      boundaryIndex = lastMatchIndex + 1;
    } else {
      // ========================= START OF FIX =========================
      // Fuzzy match failed, attempt Keyword Fallback
      console.warn('  -> Fuzzy match failed. Attempting keyword fallback boundary detection.');
      const instructionKeywords = ['work out', 'calculate', 'explain', 'show that', 'find the', 'write down'];
      let lastInstructionIndex = -1;
      // Search backwards through all lines for the last instruction
      for (let i = ocrLines.length - 1; i >= 0; i--) {
        const text = (ocrLines[i].latex_styled || ocrLines[i].text || '').toLowerCase();
        // Check for keywords, ensure it's likely prose (more than 2 words), and lacks '='
        if (text.split(/\s+/).length > 2 && !text.includes('=') && instructionKeywords.some(kw => text.includes(kw))) {
          lastInstructionIndex = i;
          break; // Found the last instruction line
        }
      }

      if (lastInstructionIndex !== -1) {
        // Keyword fallback succeeded
        boundaryIndex = lastInstructionIndex + 1;
      } else {
        // Both fuzzy and keyword failed - absolute fallback
        console.warn('  -> Keyword fallback also failed. Treating all as student work.');
        boundaryIndex = 0;
      }
      // ========================== END OF FIX ==========================
    }

    boundaryIndex = Math.min(boundaryIndex, ocrLines.length);
    return boundaryIndex;
  }
  // --- END OF NEW HELPER ---


  /**
   * Fallback strategy using Google Vision robust recognition and fragmented Mathpix calls.
   * Used when the primary "Mathpix First" strategy fails. (The original implementation).
   */
  private static async fallbackHybridStrategy(
    imageBuffer: Buffer,
    dimensions: { width: number, height: number },
    opts: Required<Omit<OCROptions, 'enablePreprocessing'>>,
    debug: boolean,
    tracker?: any // Add tracker here
  ): Promise<{ mathBlocks: MathBlock[], mathpixCalls: number, detectedBlocks: DetectedBlock[], preClusterBlocks: DetectedBlock[] }> {
    console.warn('⚠️ [OCR FALLBACK] Falling back to Google Vision robust recognition (Hybrid Strategy).');
    let detectedBlocks: DetectedBlock[] = [];
    let mathBlocks: MathBlock[] = [];
    let preClusterBlocks: DetectedBlock[] = [];
    let mathpixCalls = 0;

    try {
      // Step F1: Perform robust three-pass Google Vision recognition
      const robust = await GoogleVisionService.performRobustRecognition(imageBuffer, opts.dbscanEpsPx, opts.dbscanMinPts);
      preClusterBlocks = robust.preClusterBlocks;

      // FIX: Step F1.5: Apply Spatial Filtering to Google Vision results
      const marginThresholdVertical = 0.05; // 5% top and bottom
      const marginThresholdHorizontal = 0.10; // 10% right

      const filteredBlocks = robust.finalBlocks.filter(block => {
        const coords = block.geometry;
        // Calculate max coordinates from min + width/height
        const maxX = coords.minX + coords.width;
        const maxY = coords.minY + coords.height;

        // Check against dimensions for margin filtering
        if (coords.minY < dimensions.height * marginThresholdVertical || // Top margin
          maxY > dimensions.height * (1 - marginThresholdVertical) || // Bottom margin
          maxX > dimensions.width * (1 - marginThresholdHorizontal) // Right margin
        ) {
          return false;
        }
        return true;
      });

      detectedBlocks = filteredBlocks; // Use filtered blocks for subsequent steps

      // Convert detected blocks to standard format (required by detectMathBlocks)
      const visionResult: ProcessedVisionResult = {
        text: detectedBlocks.map(block => block.text || '').join('\n'),
        boundingBoxes: detectedBlocks.map(block => ({
          text: block.text || '',
          x: block.geometry.minX,
          y: block.geometry.minY,
          width: block.geometry.width,
          height: block.geometry.height,
          confidence: block.confidence || 0
        })),
        confidence: detectedBlocks.reduce((sum, block) => sum + (block.confidence || 0), 0) / detectedBlocks.length || 0,
        dimensions: dimensions,
        symbols: detectedBlocks.map(block => ({
          text: block.text || '',
          boundingBox: {
            x: block.geometry.minX,
            y: block.geometry.minY,
            width: block.geometry.width,
            height: block.geometry.height,
            text: block.text || ''
          },
          confidence: block.confidence || 0
        }))
      };

      // Step F2: Detect math blocks from robust recognition results
      mathBlocks = detectMathBlocks(visionResult);

      // Step F3: Process math blocks with Mathpix (Fragmented approach)
      if (mathBlocks.length > 0 && MathpixService.isAvailable()) {
        try {
          const seen = new Set<string>();
          const queue = [...mathBlocks].sort((a, b) => (b.suspicious === true ? 1 : 0) - (a.suspicious === true ? 1 : 0) || b.mathLikenessScore - a.mathLikenessScore);

          for (let i = 0; i < queue.length; i++) {
            const mathBlock = queue[i];
            const coords = mathBlock.coordinates;

            // Validate coordinates before cropping (Original validation logic)
            if (!coords ||
              typeof coords.x !== 'number' || isNaN(coords.x) ||
              typeof coords.y !== 'number' || isNaN(coords.y) ||
              typeof coords.width !== 'number' || isNaN(coords.width) ||
              typeof coords.height !== 'number' || isNaN(coords.height) ||
              coords.width <= 0 || coords.height <= 0) {
              console.warn(`⚠️ [OCR FALLBACK] Skipping math block ${i + 1}: Invalid coordinates`, coords);
              continue;
            }

            const cropOptions = getCropOptions(coords);
            const sig = `${cropOptions.left}-${cropOptions.top}-${cropOptions.width}-${cropOptions.height}`;
            if (seen.has(sig)) continue;
            seen.add(sig);

            try {
              // Smart Math Block Triage
              const shouldSkipMathpix = mathBlock.confidence >= 0.9;

              if (shouldSkipMathpix) {
                mathBlock.mathpixLatex = mathBlock.googleVisionText;
              } else {
                // Crop and process with Mathpix
                const croppedBuffer = await sharp(imageBuffer).extract(cropOptions).png().toBuffer();
                // Pass tracker to MathpixService.processImage
                const mathpixResult = await MathpixService.processImage(croppedBuffer, {}, tracker);
                mathpixCalls += 1;

                if (mathpixResult.latex_styled && !mathpixResult.error) {
                  mathBlock.mathpixLatex = mathpixResult.latex_styled;
                  mathBlock.mathpixConfidence = mathpixResult.confidence;
                } else {
                  console.warn(`⚠️ [OCR FALLBACK] Mathpix failed for block ${i + 1}, using Google Vision text`);
                  mathBlock.mathpixLatex = mathBlock.googleVisionText;
                }
              }

              // Rate limiting delay
              if (i < queue.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 200));
              }

            } catch (cropError) {
              console.error(`❌ [OCR FALLBACK] Failed to process math block ${i + 1}:`, cropError);
            }
          }

          mathBlocks.splice(0, mathBlocks.length, ...queue);

        } catch (error) {
          console.error('❌ [OCR FALLBACK] Mathpix processing failed during fallback:', error);
        }
      }

    } catch (error) {
      console.error(`❌ [OCR FALLBACK ERROR] Google Vision failed during fallback:`, error instanceof Error ? error.message : 'Unknown error');
      if (mathBlocks.length === 0) {
        // If the fallback fails completely, we must report the error.
        throw new Error('OCR processing failed completely: Mathpix First failed and Google Vision fallback also failed.');
      }
    }

    return { mathBlocks, mathpixCalls, detectedBlocks, preClusterBlocks };
  }


  /**
   * Process image through complete OCR pipeline
   * @param imageData - Base64 encoded image data (Already pre-processed from Stage 1)
   * @param questionDetection - (Optional, currently unused) Previously used for boundary detection, now all OCR lines are processed
   */
  static async processImage(
    imageData: string,
    options: OCROptions = {},
    debug: boolean = false,
    model: any = 'auto',
    questionDetection?: any, // Contains extractedQuestionText
    tracker?: any // Add tracker here
  ): Promise<OCRResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };

    let imageBuffer: Buffer;
    if (imageData.startsWith('data:')) {
      const base64Data = imageData.split(',')[1];
      if (!base64Data) throw new Error('Invalid data URL format for OCR input');
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else {
      imageBuffer = Buffer.from(imageData, 'base64');
    }
    const dimensions = await GoogleVisionService.getImageMetadata(imageBuffer);

    let detectedBlocks: DetectedBlock[] = [];
    let mathBlocks: MathBlock[] = [];
    let preClusterBlocks: DetectedBlock[] = [];
    let mathpixCalls = 0;
    let usedFallback = false;
    let rawLineData: Array<any> | null = null;

    // --- PRIMARY STRATEGY: Mathpix First (v3/text) ---
    if (MathpixService.isAvailable()) {
      try {
        const mathpixOptions = {
          formats: ["text", "latex_styled"],
          include_line_data: true,
          disable_array_detection: true
        };
        // Pass tracker to MathpixService.processImage
        const mathpixResult = await MathpixService.processImage(imageBuffer, mathpixOptions, tracker);
        mathpixCalls += 1;

        if (mathpixResult.line_data && mathpixResult.line_data.length > 0) {
          rawLineData = mathpixResult.line_data;
        } else {
          rawLineData = null; // Ensure fallback is triggered
        }
      } catch (error) {
        console.error('❌ [OCR] Error during Mathpix First strategy (v3/text):', error);
        rawLineData = null; // Ensure fallback on error
      }
    }
    // --- End of Primary Strategy ---


    // --- FALLBACK AND POST-PROCESSING ---

    // ========================= START OF MODIFICATION =========================
    // MODIFIED: Trigger fallback ONLY if the initial Mathpix call failed completely.
    if (!rawLineData || rawLineData.length === 0) {
      console.warn(`⚠️ [OCR STRATEGY] No valid line data from initial Mathpix call. Triggering robust fallback.`);
      usedFallback = true;
      try {
        // Pass tracker to fallbackHybridStrategy
        const fallbackResult = await this.fallbackHybridStrategy(imageBuffer, dimensions, opts, debug, tracker);
        mathBlocks = fallbackResult.mathBlocks; // Fallback directly sets mathBlocks
        mathpixCalls += fallbackResult.mathpixCalls;
        // Also capture detectedBlocks and preClusterBlocks if needed for rawResponse
        detectedBlocks = fallbackResult.detectedBlocks;
        preClusterBlocks = fallbackResult.preClusterBlocks;
      } catch (error) {
        console.error('❌ [OCR] Robust fallback strategy failed:', error);
        mathBlocks = []; // Ensure mathBlocks is empty on complete failure
      }
      // ========================== END OF MODIFICATION ==========================

    } else {
      // PRIMARY PATH: Mathpix succeeded, now process the result.
      // NOTE: Minimal metadata filtering only - all heuristic filtering removed
      // Question text filtering and accurate filtering happen in segmentation stage where we have question context
      // This prevents discarding valid student work (like Q2a, Q4a comma-separated numbers) due to incorrect heuristic rules

      // UNGROUP ARRAYS
      // IMPORTANT: Don't discard lines without coordinates here - we'll handle coordinate estimation later
      const ungroupedLines: any[] = [];

      rawLineData.forEach((line, idx) => {
        const text = line.latex_styled || line.text || '';

        if (!text) {
          return; // Only discard if text is missing, not if coords are missing
        }

        const coords = this.extractBoundingBox(line);
        const hasOriginalCoords = !!coords; // Define flag based on coords presence

        if (text.includes('\\\\')) {
          // Remove LaTeX delimiters and environment tags, but keep the actual content
          let cleanText = text
            .replace(/\\\[|\\\]/g, '') // Remove \[ and \]
            .replace(/\\begin\{array\}\{.*?\}|\\end\{array\}/g, '') // Remove \begin{array}{...} and \end{array}
            .replace(/\\begin\{aligned\}|\\end\{aligned\}/g, '') // Remove \begin{aligned} and \end{aligned}
            .trim();
          const splitLines = cleanText.split(/\\\\/g).map(l => l.trim()).filter(Boolean);

          // If we have coords, split them; otherwise estimate for each split line
          if (coords) {
            const avgHeight = coords.height / (splitLines.length || 1);
            splitLines.forEach((splitText, index) => {
              const newLine = { ...line, latex_styled: splitText, text: splitText, hasOriginalCoords, isSplitBlock: true, region: undefined }; // Clear region as it's now split
              const newCoords = { ...coords, y: coords.y + (index * avgHeight), height: avgHeight };
              newLine.region = newCoords; // Store coords for extraction
              ungroupedLines.push(newLine);
            });
          } else {
            // No coords - just push split lines as-is (coords will be estimated later)
            splitLines.forEach((splitText) => {
              const newLine = { ...line, latex_styled: splitText, text: splitText, hasOriginalCoords: false, isSplitBlock: true, region: undefined };
              ungroupedLines.push(newLine);
            });
          }
        } else {
          ungroupedLines.push({ ...line, hasOriginalCoords, isSplitBlock: false }); // Keep line even if no coords - will estimate later
        }
      });

      // MINIMAL METADATA FILTERING ONLY
      // All heuristic filtering (margin, ambiguous prose, math expression checks) is removed
      // Accurate filtering happens in segmentation stage where we have question context


      const studentWorkLines = ungroupedLines.filter((line, idx) => {
        const text = line.latex_styled || line.text || '';

        // Remove LaTeX delimiters \[ \] and also standalone brackets [ ] that come with newlines
        // Format can be: \[...\] or [\n...\n\] or [...]
        let cleanedText = text.replace(/\\\[|\\\]/g, ''); // Remove \[ and \]
        cleanedText = cleanedText.replace(/^\s*\[\s*|\s*\]\s*$/g, ''); // Remove leading [ and trailing ] with whitespace
        cleanedText = cleanedText.trim();

        // 1. Discard empty lines (after cleaning)
        if (!cleanedText) {
          return false;
        }

        const lowerCaseText = cleanedText.toLowerCase();

        // 2. Filter ONLY known metadata/noise patterns (very conservative - keep everything else)
        // Design principle: Only filter explicit metadata patterns, let segmentation handle everything else
        const knownMetadataPatterns = [
          /total\s+for\s+question/i,                    // "Total for Question 5 is 4 marks"
          /^turn\s+over$/i,                             // "Turn over" (exact match)
          /do\s+not\s+write\s+(in\s+)?this\s+area/i,  // "Do not write in this area" / "Do not write this area"
          /^bar\s*code$/i,                              // "Bar code" or "Barcode" (exact match)
          /^page\s+\d+$/i,                              // "Page 7" (exact match with number)
        ];

        for (const pattern of knownMetadataPatterns) {
          if (pattern.test(cleanedText)) {
            return false; // Known metadata - filter it
          }
        }

        // 3. Keep everything else - let segmentation filter based on question context
        // This includes:
        // - Standalone numbers like "40", "7" (let segmentation decide with context)
        // - Mark allocations like "(3)", "(1)" (let segmentation decide with context)
        // - Question text (segmentation will filter it)
        // - Student work (must keep)
        // - Any ambiguous content (let segmentation decide)
        return true;
      });



      // PREPARE FINAL MATHBLOCKS
      const processedLines: any[] = [];

      for (let i = 0; i < studentWorkLines.length; i++) {
        const line = studentWorkLines[i];
        const text = line.latex_styled || line.text || '';

        if (!text) {
          continue;
        }

        // Remove LaTeX delimiters \[ \] and also standalone brackets [ ] that come with newlines
        let cleanedText = text.replace(/\\\[|\\\]/g, ''); // Remove \[ and \]
        cleanedText = cleanedText.replace(/^\s*\[\s*|\s*\]\s*$/g, ''); // Remove leading [ and trailing ] with whitespace
        cleanedText = cleanedText.trim();
        if (!cleanedText) {
          continue;
        }

        let coords = this.extractBoundingBox(line);
        const hasOriginalCoords = (line as any).hasOriginalCoords; // Propagate the flag
        const isSplitBlock = (line as any).isSplitBlock; // Propagate the flag

        // If coordinates are missing, detect if it's student work and estimate coordinates
        if (!coords) {
          // Enhanced student work detection: check for common student work patterns
          // This should catch cases like "=\frac{32}{19}", "= 5", "x + 3", comma-separated numbers, etc.
          const hasEquals = cleanedText.includes('=');
          const hasOperator = /[+\-×÷*/]/.test(cleanedText);
          const hasNumber = /\d/.test(cleanedText);
          const hasFraction = /\\frac\{/.test(cleanedText);
          const hasAligned = /\\begin\{aligned\}/.test(text) || /\\end\{aligned\}/.test(text);
          // Pattern for comma-separated numbers (e.g., "10, 13, 11, 14, 16, 17" for Q4a)
          const hasCommaSeparatedNumbers = /\d+,\s*\d+/.test(cleanedText);

          const isStudentWork = hasEquals || hasOperator || hasNumber || hasFraction || hasAligned || hasCommaSeparatedNumbers;

          if (isStudentWork) {
            // Try to estimate from previous/next lines with coordinates
            let estimatedY = dimensions.height * 0.5; // Default to middle of page
            let estimatedHeight = 30; // Default height
            let estimationMethod = 'default';

            // Look for nearby lines with coordinates (check both before and after)
            // Strategy: Check previous lines first (more likely to be above), then next lines
            let foundNearbyCoords = false;
            let nearbyLineIndex = -1;

            // Check previous lines first (i-1, i-2)
            for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
              const nearbyLine = studentWorkLines[j];
              const nearbyCoords = this.extractBoundingBox(nearbyLine);
              if (nearbyCoords) {
                nearbyLineIndex = j;
                estimatedY = nearbyCoords.y;
                estimatedHeight = nearbyCoords.height;
                // Previous line - estimate this is below it
                estimatedY += nearbyCoords.height + 10;
                estimationMethod = `below line ${j + 1} (Y=${nearbyCoords.y.toFixed(0)})`;
                foundNearbyCoords = true;
                break;
              }
            }

            // If no previous line found, check next lines
            if (!foundNearbyCoords) {
              for (let j = i + 1; j < Math.min(studentWorkLines.length, i + 3); j++) {
                const nearbyLine = studentWorkLines[j];
                const nearbyCoords = this.extractBoundingBox(nearbyLine);
                if (nearbyCoords) {
                  nearbyLineIndex = j;
                  estimatedY = nearbyCoords.y;
                  estimatedHeight = nearbyCoords.height;
                  // Next line - estimate this is above it
                  estimatedY -= nearbyCoords.height + 10;
                  estimationMethod = `above line ${j + 1} (Y=${nearbyCoords.y.toFixed(0)})`;
                  foundNearbyCoords = true;
                  break;
                }
              }
            }

            // If no nearby coords found, use a smarter default based on line index
            if (!foundNearbyCoords) {
              // Estimate Y position based on line index (assuming lines are roughly evenly spaced)
              const avgLineHeight = 40; // Average line height
              const estimatedLineIndex = i; // Use current index as estimate
              estimatedY = estimatedLineIndex * avgLineHeight + 100; // Start from top with margin
              estimatedHeight = avgLineHeight;
              estimationMethod = `index-based (line ${i + 1}, Y=${estimatedY.toFixed(0)})`;
            }

            // Estimate width based on text length (rough heuristic)
            const estimatedWidth = Math.min(cleanedText.length * 15, dimensions.width * 0.8);
            const estimatedX = dimensions.width * 0.1; // Left margin

            coords = {
              x: estimatedX,
              y: estimatedY,
              width: estimatedWidth,
              height: estimatedHeight
            };
          } else {
            // Not clearly student work, skip it
            continue;
          }
        }

        // Use cleaned text (without LaTeX delimiters) AND sanitize artifacts for the final block
        const sanitizedText = sanitizeOcrArtifacts(cleanedText || text);
        processedLines.push({ text: sanitizedText, coords, hasOriginalCoords, isSplitBlock });
      }

      mathBlocks = processedLines.map(line => ({
        googleVisionText: line.text, mathpixLatex: line.text, confidence: line.confidence || 1.0,
        mathpixConfidence: line.confidence || 1.0, mathLikenessScore: 1.0, coordinates: line.coords,
        hasLineData: line.hasOriginalCoords && !line.isSplitBlock // true if coords from Mathpix AND not multi-line AND not split
      } as MathBlock));
    }


    // --- Final Data Structuring and Return (No changes from here onwards) ---
    // Preserve MathPix reading order for blocks with null Y coordinates
    // This allows us to use order-based interpolation for drawing positions
    const sortedMathBlocks = [...mathBlocks].sort((a, b) => {
      const aY = a.coordinates?.y;
      const bY = b.coordinates?.y;

      // If both have Y coordinates, use existing overlap detection logic
      if (aY != null && bY != null) {
        const aHeight = a.coordinates.height;
        const aBottom = aY + aHeight;
        const bHeight = b.coordinates.height;
        const bBottom = bY + bHeight;
        const overlapThreshold = usedFallback ? 0.1 : 0.3;
        const verticalOverlap = Math.min(aBottom, bBottom) - Math.max(aY, bY);
        if (verticalOverlap > 0) {
          const aOverlapRatio = verticalOverlap / aHeight;
          const bOverlapRatio = verticalOverlap / bHeight;
          if (aOverlapRatio >= overlapThreshold || bOverlapRatio >= overlapThreshold) {
            return a.coordinates.x - b.coordinates.x;
          }
        }
        return aY - bY;
      }

      // If one has Y and one doesn't, put null Y at the end (preserves relative order)
      if (aY == null && bY == null) {
        // Both null - preserve original MathPix order (stable sort)
        return 0;
      }
      if (aY == null) return 1; // a goes after b
      if (bY == null) return -1; // b goes after a

      return 0; // Shouldn't reach here
    });


    let cleanedOcrText = '';
    let cleanDataForMarking: any = null;
    let unifiedLookupTable: Record<string, { bbox: number[]; cleanedText: string }> = {};

    try {
      const steps = sortedMathBlocks.map((block, index) => {
        const coords = block.coordinates;
        if (!coords || isNaN(coords.x) || isNaN(coords.y) || isNaN(coords.width) || isNaN(coords.height)) return null;
        const text = block.mathpixLatex || block.googleVisionText || '';
        return {
          unified_step_id: `step_${index + 1}`, text: text, cleanedText: text,
          bbox: [coords.x, coords.y, coords.width, coords.height]
        };
      }).filter(step => step !== null && step.text.trim().length > 0);
      cleanedOcrText = JSON.stringify({ steps });
      const { OCRDataUtils } = await import('../../utils/OCRDataUtils.js');
      cleanDataForMarking = OCRDataUtils.extractDataForMarking(cleanedOcrText);
      if (cleanDataForMarking.steps && Array.isArray(cleanDataForMarking.steps)) {
        for (const step of cleanDataForMarking.steps) {
          if (step.unified_step_id && step.bbox && Array.isArray(step.bbox) && step.bbox.length === 4) {
            unifiedLookupTable[step.unified_step_id] = { bbox: step.bbox, cleanedText: step.cleanedText || '' };
          }
        }
      }
    } catch (structuringError) {
      console.error('❌ [OCR] Data structuring failed:', structuringError);
      if (!cleanDataForMarking) cleanDataForMarking = { question: 'Error during structuring', steps: [] };
      if (!cleanedOcrText) cleanedOcrText = JSON.stringify({ steps: [] });
    }

    const processingTime = Date.now() - startTime;
    const finalText = sortedMathBlocks.map(block => block.mathpixLatex || block.googleVisionText || '').join('\n');
    const finalBoundingBoxes = sortedMathBlocks.map(block => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      x: block.coordinates.x, y: block.coordinates.y, width: block.coordinates.width, height: block.coordinates.height,
      confidence: block.mathpixConfidence || block.confidence
    }));
    const finalConfidence = sortedMathBlocks.length > 0 ? sortedMathBlocks.reduce((sum, block) => sum + (block.mathpixConfidence || block.confidence), 0) / sortedMathBlocks.length : 0;
    const finalSymbols = sortedMathBlocks.map(block => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      boundingBox: [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height],
      confidence: block.mathpixConfidence || block.confidence
    }));

    return {
      text: finalText, boundingBoxes: finalBoundingBoxes, confidence: finalConfidence, dimensions,
      symbols: finalSymbols, mathBlocks: sortedMathBlocks, processingTime,
      rawResponse: { detectedBlocks, preClusterBlocks, usedFallback, rawLineData },
      usage: { mathpixCalls }, cleanedOcrText, cleanDataForMarking, unifiedLookupTable
    };
  }

  /**
   * Get service status (Remains the same)
   */
  static getServiceStatus(): {
    googleVision: any;
    mathpix: any;
    hybrid: boolean;
    robustRecognition: boolean;
  } {
    const mathpixStatus = MathpixService.getServiceStatus();
    const googleVisionAvailable = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

    return {
      googleVision: { available: googleVisionAvailable },
      mathpix: mathpixStatus,
      hybrid: googleVisionAvailable && mathpixStatus.available,
      robustRecognition: googleVisionAvailable
    };
  }

  /**
   * Check if OCR service is available
   */
  static isAvailable(): boolean {
    // Optimal performance requires both, but the system can function with either due to the strategies.
    return !!process.env.GOOGLE_APPLICATION_CREDENTIALS || MathpixService.isAvailable();
  }
}