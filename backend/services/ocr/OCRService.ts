/**
 * OCR Service
 * Implements Enhanced Hybrid Architecture: Extract -> Post-process -> Inject Signal -> Segment -> Filter
 */

import sharp from 'sharp';
import { getDebugMode } from '../../config/aiModels.js';
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
    debug: boolean
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
              const mathpixResult = await MathpixService.processImage(croppedBuffer, {}, debug);
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
    questionDetection?: any // Contains extractedQuestionText
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
        const mathpixResult = await MathpixService.processImage(imageBuffer, mathpixOptions, debug);
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
           const fallbackResult = await this.fallbackHybridStrategy(imageBuffer, dimensions, opts, debug);
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
        // NOTE: Process ALL OCR lines - question text filtering happens in segmentation stage
        // This prevents discarding valid student work (like Q2a) due to incorrect boundary detection
        
        // UNGROUP ARRAYS
        // IMPORTANT: Don't discard lines without coordinates here - we'll handle coordinate estimation later
        const ungroupedLines: any[] = [];
        
        rawLineData.forEach((line, idx) => {
             const text = line.latex_styled || line.text || '';
             
             // Q2a/Q2b diagnostic: Check BEFORE any processing
             const isQ2aBefore = text.includes('32/19') || text.includes('frac{32}{19}') || text.includes('\\frac{32}{19}');
             const isQ2bBefore = text.includes('35 / 24') || text.includes('35/24') || (text.includes('24') && text.includes('bot'));
             
             if (isQ2aBefore) {
                 console.log(`[Q2a DIAGNOSTIC] Found Q2a BEFORE ungrouping (line ${idx + 1}):`);
                 console.log(`[Q2a DIAGNOSTIC]   Text length: ${text.length}, has text: ${!!text}`);
                 console.log(`[Q2a DIAGNOSTIC]   Raw text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
             }
             if (isQ2bBefore) {
                 console.log(`[Q2b DIAGNOSTIC] Found Q2b BEFORE ungrouping (line ${idx + 1}):`);
                 console.log(`[Q2b DIAGNOSTIC]   Text length: ${text.length}, has text: ${!!text}`);
                 console.log(`[Q2b DIAGNOSTIC]   Raw text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
             }
             
             if (!text) {
                 if (isQ2aBefore) console.log(`[Q2a DIAGNOSTIC] ❌ Q2a line discarded: empty text`);
                 if (isQ2bBefore) console.log(`[Q2b DIAGNOSTIC] ❌ Q2b line discarded: empty text`);
                 return; // Only discard if text is missing, not if coords are missing
             }
             
             const coords = this.extractBoundingBox(line);

             if (text.includes('\\\\')) {
                 let cleanText = text.replace(/\\\[|\\\]|\\begin{array}\{.*\}|\\end{array}/g, '').trim();
                 const splitLines = cleanText.split(/\\\\/g).map(l => l.trim()).filter(Boolean);
                 
                 if (isQ2aBefore) console.log(`[Q2a DIAGNOSTIC] Line contains \\\\, splitting into ${splitLines.length} lines`);
                 if (isQ2bBefore) console.log(`[Q2b DIAGNOSTIC] Line contains \\\\, splitting into ${splitLines.length} lines`);
                 
                 // If we have coords, split them; otherwise estimate for each split line
                 if (coords) {
                 const avgHeight = coords.height / (splitLines.length || 1);
                 splitLines.forEach((splitText, index) => {
                     const newLine = { ...line, latex_styled: splitText, text: splitText };
                     const newCoords = { ...coords, y: coords.y + (index * avgHeight), height: avgHeight };
                     newLine.region = newCoords; // Store coords for extraction
                     ungroupedLines.push(newLine);
                         if (isQ2aBefore && splitText.includes('32/19')) {
                             console.log(`[Q2a DIAGNOSTIC] ✅ Q2a split line ${index + 1} added to ungroupedLines`);
                         }
                         if (isQ2bBefore && splitText.includes('35/24')) {
                             console.log(`[Q2b DIAGNOSTIC] ✅ Q2b split line ${index + 1} added to ungroupedLines`);
                         }
                     });
                 } else {
                     // No coords - just push split lines as-is (coords will be estimated later)
                     splitLines.forEach((splitText) => {
                         const newLine = { ...line, latex_styled: splitText, text: splitText };
                         ungroupedLines.push(newLine);
                         if (isQ2aBefore && splitText.includes('32/19')) {
                             console.log(`[Q2a DIAGNOSTIC] ✅ Q2a split line (no coords) added to ungroupedLines`);
                         }
                         if (isQ2bBefore && splitText.includes('35/24')) {
                             console.log(`[Q2b DIAGNOSTIC] ✅ Q2b split line (no coords) added to ungroupedLines`);
                         }
                     });
                 }
             } else {
                 ungroupedLines.push(line); // Keep line even if no coords - will estimate later
                 if (isQ2aBefore) console.log(`[Q2a DIAGNOSTIC] ✅ Q2a line added to ungroupedLines (no splitting)`);
                 if (isQ2bBefore) console.log(`[Q2b DIAGNOSTIC] ✅ Q2b line added to ungroupedLines (no splitting)`);
             }
        });

        // APPLY FILTER WITH CORRECT ORDER
        const studentWorkLines = ungroupedLines.filter((line, idx) => {
            const text = line.latex_styled || line.text || '';
            
            // Q2a/Q2b diagnostic: Check BEFORE cleaning
            const isQ2aBeforeFilter = text.includes('32/19') || text.includes('frac{32}{19}') || text.includes('\\frac{32}{19}');
            const isQ2bBeforeFilter = text.includes('35/24') || text.includes('35 / 24') || (text.includes('24') && text.includes('bot'));
            
            if (isQ2aBeforeFilter) {
                console.log(`[Q2a DIAGNOSTIC] Q2a line ${idx + 1} entering FILTER stage:`);
                console.log(`[Q2a DIAGNOSTIC]   Original text: "${text}"`);
            }
            if (isQ2bBeforeFilter) {
                console.log(`[Q2b DIAGNOSTIC] Q2b line ${idx + 1} entering FILTER stage:`);
                console.log(`[Q2b DIAGNOSTIC]   Original text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
            }
            
            // Remove LaTeX delimiters \[ \] and also standalone brackets [ ] that come with newlines
            // Format can be: \[...\] or [\n...\n\] or [...]
            let cleanedText = text.replace(/\\\[|\\\]/g, ''); // Remove \[ and \]
            cleanedText = cleanedText.replace(/^\s*\[\s*|\s*\]\s*$/g, ''); // Remove leading [ and trailing ] with whitespace
            cleanedText = cleanedText.trim();
            
            if (isQ2aBeforeFilter) {
                console.log(`[Q2a DIAGNOSTIC]   After cleaning: "${cleanedText}"`);
            }
            if (isQ2bBeforeFilter) {
                console.log(`[Q2b DIAGNOSTIC]   After cleaning: "${cleanedText.substring(0, 100)}${cleanedText.length > 100 ? '...' : ''}"`);
            }
            
            // Q2a specific debugging: Check for "32/19" or "frac{32}{19}" pattern (more flexible)
            // Check both original and cleaned text to catch any format, accounting for escaped backslashes
            // Patterns: "32/19", "frac{32}{19}", "\\frac{32}{19}", etc.
            const has32over19 = text.includes('32/19') || 
                               text.includes('frac{32}{19}') || 
                               text.includes('\\frac{32}{19}') ||
                               cleanedText.includes('32/19') || 
                               cleanedText.includes('frac{32}{19}') ||
                               cleanedText.includes('\\frac{32}{19}');
            const hasEqualsAndFraction = (text.includes('=') && (text.includes('frac{32}{19}') || text.includes('\\frac{32}{19}') || text.includes('32/19'))) ||
                                       (cleanedText.includes('=') && (cleanedText.includes('frac{32}{19}') || cleanedText.includes('\\frac{32}{19}') || cleanedText.includes('32/19')));
            const isQ2aPattern = has32over19 || hasEqualsAndFraction;
            
            if (isQ2aPattern) {
                console.log(`[Q2a DEBUG OCR] ✅ MATCH: Found Q2a pattern in line ${idx + 1}:`);
                console.log(`[Q2a DEBUG OCR]   Original text: "${text}"`);
                console.log(`[Q2a DEBUG OCR]   Cleaned text: "${cleanedText}"`);
                console.log(`[Q2a DEBUG OCR]   Has coords: ${!!this.extractBoundingBox(line)}`);
            } else if (isQ2aBeforeFilter) {
                console.log(`[Q2a DIAGNOSTIC] ❌ NO MATCH: Pattern detection failed for Q2a line ${idx + 1}`);
                console.log(`[Q2a DIAGNOSTIC]   has32over19: ${has32over19}`);
                console.log(`[Q2a DIAGNOSTIC]   hasEqualsAndFraction: ${hasEqualsAndFraction}`);
            }
            
            if (!cleanedText) {
                if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ❌ FILTERED: Q2a line discarded: empty after cleaning`);
                if (isQ2aBeforeFilter) console.log(`[Q2a DIAGNOSTIC] ❌ FILTERED: Line ${idx + 1} discarded: empty after cleaning`);
                return false; // Discard empty lines
            }

            // --- 1. Explicit Discard Rules ---
            const lowerCaseText = cleanedText.toLowerCase();
            if (lowerCaseText.includes("total for question")) {
                 if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ❌ FILTERED: Q2a line discarded: contains "total for question"`);
                 if (isQ2aBeforeFilter) console.log(`[Q2a DIAGNOSTIC] ❌ FILTERED: Line ${idx + 1} discarded: contains "total for question"`);
                 return false;
            }
            // Stricter check for standalone numbers (likely page numbers/metadata)
            if (/^\s*\d+\s*$/.test(cleanedText) && cleanedText.length <= 3) { // Allow longer numbers
                 if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ❌ FILTERED: Q2a line discarded: standalone number`);
                 if (isQ2aBeforeFilter) console.log(`[Q2a DIAGNOSTIC] ❌ FILTERED: Line ${idx + 1} discarded: standalone number`);
                 return false;
            }

            // --- 2. Inclusionary Rules ---
            // Rule 2a: Keep if it contains an equals sign.
            if (cleanedText.includes('=')) {
                if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ✅ KEPT: Q2a line KEPT: contains equals sign`);
                if (isQ2aBeforeFilter) console.log(`[Q2a DIAGNOSTIC] ✅ KEPT: Line ${idx + 1} KEPT: contains equals sign`);
                return true; // Definitely student work
            }
            // Rule 2b: Keep if it's a math expression (number + operator/variable).
            const hasNumber = /\d/.test(cleanedText);
            const hasOperatorOrVariable = /[+\-^*/÷×nxyz£$€]/.test(cleanedText);
            if (hasNumber && hasOperatorOrVariable) {
                 // Additional check: Ensure it doesn't look like long prose accidentally matching
                 const wordCount = cleanedText.split(/\s+/).length;
                 if (wordCount < 7) { // Heuristic: Keep shorter math expressions
                     return true; // Likely student work (final answer etc.)
                 }
            }
            // Rule 2c: Keep if it's just a standalone number or currency amount.
            const isSingleNumOrCurrency = /^\s*[£$€]?[\d.,]+\s*$/.test(cleanedText.replace(/\\text\{.*?\}/g, ''));
            if (isSingleNumOrCurrency) {
                // Heuristic: Avoid keeping very large numbers that might be noise/IDs unless they follow an equals
                 if (cleanedText.length < 10) { // Avoid overly long standalone numbers
                     return true; // Likely student work (intermediate/final answer)
                 }
            }

            // --- If it hasn't been KEPT yet, proceed to checks for DISCARDING ambiguous lines ---

            // --- 3. Margin Filtering (Only for lines not kept above) ---
            const coords = this.extractBoundingBox(line);
             if (coords) {
                const marginThresholdVertical = 0.05;
                const marginThresholdHorizontal = 0.10;
                if (coords.y < dimensions.height * marginThresholdVertical ||
                    coords.y + coords.height > dimensions.height * (1 - marginThresholdVertical) ||
                    coords.x + coords.width > dimensions.width * (1 - marginThresholdHorizontal)
                ) {
                    if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ❌ Q2a line discarded: near margin`);
                    return false; // Discard ambiguous lines near margin
                }
            }

            // --- 4. Discard Remaining Ambiguous Prose ---
            if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ❌ FILTERED: Q2a line discarded: ambiguous prose`);
            if (isQ2aBeforeFilter) console.log(`[Q2a DIAGNOSTIC] ❌ FILTERED: Line ${idx + 1} discarded: ambiguous prose (no inclusion rules matched)`);
            if (isQ2bBeforeFilter) console.log(`[Q2b DIAGNOSTIC] ❌ FILTERED: Line ${idx + 1} discarded: ambiguous prose (no inclusion rules matched)`);
            return false; // Discard anything else that didn't pass inclusion
        });
        
        // Q2a/Q2b diagnostic: Check if lines made it through filter
        const q2aInFiltered = studentWorkLines.some((line, idx) => {
            const text = line.latex_styled || line.text || '';
            return text.includes('32/19') || text.includes('frac{32}{19}') || text.includes('\\frac{32}{19}');
        });
        const q2bInFiltered = studentWorkLines.some((line, idx) => {
            const text = line.latex_styled || line.text || '';
            return text.includes('35/24') || text.includes('35 / 24') || (text.includes('24') && text.includes('bot'));
        });
        if (!q2aInFiltered) {
            console.log(`[Q2a DIAGNOSTIC] ⚠️ Q2a line NOT in filtered studentWorkLines (was filtered out)`);
        } else {
            console.log(`[Q2a DIAGNOSTIC] ✅ Q2a line IS in filtered studentWorkLines`);
        }
        if (!q2bInFiltered) {
            console.log(`[Q2b DIAGNOSTIC] ⚠️ Q2b line NOT in filtered studentWorkLines (was filtered out)`);
        } else {
            console.log(`[Q2b DIAGNOSTIC] ✅ Q2b line IS in filtered studentWorkLines`);
        }

        // PREPARE FINAL MATHBLOCKS
        const processedLines: any[] = [];
        
        for (let i = 0; i < studentWorkLines.length; i++) {
             const line = studentWorkLines[i];
             const text = line.latex_styled || line.text || '';
             
             // Q2a/Q2b diagnostic: Check BEFORE processing
             const isQ2aInProcessing = text.includes('32/19') || text.includes('frac{32}{19}') || text.includes('\\frac{32}{19}');
             const isQ2bInProcessing = text.includes('35/24') || text.includes('35 / 24') || (text.includes('24') && text.includes('bot'));
             
             if (isQ2aInProcessing) {
                 console.log(`[Q2a DIAGNOSTIC] Q2a line ${i + 1} entering COORDINATE ESTIMATION stage:`);
                 console.log(`[Q2a DIAGNOSTIC]   Text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
             }
             if (isQ2bInProcessing) {
                 console.log(`[Q2b DIAGNOSTIC] Q2b line ${i + 1} entering COORDINATE ESTIMATION stage:`);
                 console.log(`[Q2b DIAGNOSTIC]   Text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
             }
             
             if (!text) {
                 if (isQ2aInProcessing) console.log(`[Q2a DIAGNOSTIC] ❌ Line ${i + 1} discarded: empty text`);
                 if (isQ2bInProcessing) console.log(`[Q2b DIAGNOSTIC] ❌ Line ${i + 1} discarded: empty text`);
                 continue;
             }
             
             // Remove LaTeX delimiters \[ \] and also standalone brackets [ ] that come with newlines
             let cleanedText = text.replace(/\\\[|\\\]/g, ''); // Remove \[ and \]
             cleanedText = cleanedText.replace(/^\s*\[\s*|\s*\]\s*$/g, ''); // Remove leading [ and trailing ] with whitespace
             cleanedText = cleanedText.trim();
             if (!cleanedText) {
                 if (isQ2aInProcessing) console.log(`[Q2a DIAGNOSTIC] ❌ Line ${i + 1} discarded: empty after cleaning`);
                 if (isQ2bInProcessing) console.log(`[Q2b DIAGNOSTIC] ❌ Line ${i + 1} discarded: empty after cleaning`);
                 continue;
             }
             
             let coords = this.extractBoundingBox(line);
             
             // If coordinates are missing, detect if it's student work and estimate coordinates
             if (!coords) {
                 // Q2a specific debugging: Check both before and after cleaning patterns
                 const isQ2aPattern = cleanedText.includes('=\\frac{32}{19}') || cleanedText === '=\\frac{32}{19}' || cleanedText.includes('=32/19') || cleanedText.includes('frac{32}{19}');
                 if (isQ2aPattern) {
                     console.log(`[Q2a DEBUG OCR] Line ${i + 1} has no coords, checking if it's student work...`);
                 }
                 if (isQ2aInProcessing) {
                     console.log(`[Q2a DIAGNOSTIC] Line ${i + 1} has no coords, will check student work detection`);
                 }
                 if (isQ2bInProcessing) {
                     console.log(`[Q2b DIAGNOSTIC] Line ${i + 1} has no coords, will check student work detection`);
                 }
                 
                 // Enhanced student work detection: check for common student work patterns
                 // This should catch cases like "=\frac{32}{19}", "= 5", "x + 3", etc.
                 const hasEquals = cleanedText.includes('=');
                 const hasOperator = /[+\-×÷*/]/.test(cleanedText);
                 const hasNumber = /\d/.test(cleanedText);
                 const hasFraction = /\\frac\{/.test(cleanedText);
                 const hasAligned = /\\begin\{aligned\}/.test(text) || /\\end\{aligned\}/.test(text);
                 
                 const isStudentWork = hasEquals || hasOperator || hasNumber || hasFraction || hasAligned;
                 
                 if (isQ2aPattern) {
                     console.log(`[Q2a DEBUG OCR] Student work detection: hasEquals=${hasEquals}, hasOperator=${hasOperator}, hasNumber=${hasNumber}, hasFraction=${hasFraction}, hasAligned=${hasAligned}`);
                     console.log(`[Q2a DEBUG OCR] isStudentWork=${isStudentWork}`);
                 }
                 
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
                             if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] Found previous line ${j + 1} with coords at Y=${nearbyCoords.y.toFixed(0)}, estimating below`);
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
                                 if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] Found next line ${j + 1} with coords at Y=${nearbyCoords.y.toFixed(0)}, estimating above`);
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
                         if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] No nearby coords found, using index-based estimate: Y=${estimatedY.toFixed(0)}`);
                     } else {
                         if (isQ2aPattern) console.log(`[Q2a DEBUG OCR] ✅ Found nearby coords from line ${nearbyLineIndex + 1}, using: ${estimationMethod}`);
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
                     
                     if (isQ2aPattern) {
                         console.log(`[Q2a DEBUG OCR] ✅ Estimated coordinates for student work (${estimationMethod}): Y=${estimatedY.toFixed(0)}, text="${cleanedText.substring(0, 40)}..."`);
                     }
                     if (isQ2aInProcessing) {
                         console.log(`[Q2a DIAGNOSTIC] ✅ Line ${i + 1} coordinates estimated, will be added to processedLines`);
                     }
                     if (isQ2bInProcessing) {
                         console.log(`[Q2b DIAGNOSTIC] ✅ Line ${i + 1} coordinates estimated, will be added to processedLines`);
                     }
                 } else {
                     // Not clearly student work, skip it
                     if (isQ2aPattern) {
                         console.log(`[Q2a DEBUG OCR] ❌ Skipping line without coords (not student work): "${cleanedText.substring(0, 50)}..."`);
                         console.log(`[Q2a DEBUG OCR]   Reason: None of the student work patterns matched`);
                     }
                     if (isQ2aInProcessing) {
                         console.log(`[Q2a DIAGNOSTIC] ❌ Line ${i + 1} SKIPPED: not detected as student work (no coords, no student work indicators)`);
                     }
                     if (isQ2bInProcessing) {
                         console.log(`[Q2b DIAGNOSTIC] ❌ Line ${i + 1} SKIPPED: not detected as student work (no coords, no student work indicators)`);
                     }
                     continue;
                 }
             } else {
                 if (isQ2aInProcessing) {
                     console.log(`[Q2a DIAGNOSTIC] ✅ Line ${i + 1} has coords, will be added to processedLines`);
                 }
                 if (isQ2bInProcessing) {
                     console.log(`[Q2b DIAGNOSTIC] ✅ Line ${i + 1} has coords, will be added to processedLines`);
                 }
             }
             
             // Use cleaned text (without LaTeX delimiters) for the final block
             processedLines.push({ text: cleanedText || text, coords });
        }
        
        // Q2a/Q2b diagnostic: Check final processed lines
        const q2aInFinal = processedLines.some((line, idx) => {
            const text = line.text || '';
            return text.includes('32/19') || text.includes('frac{32}{19}') || text.includes('\\frac{32}{19}');
        });
        const q2bInFinal = processedLines.some((line, idx) => {
            const text = line.text || '';
            return text.includes('35/24') || text.includes('35 / 24') || (text.includes('24') && text.includes('bot'));
        });
        if (!q2aInFinal) {
            console.log(`[Q2a DIAGNOSTIC] ⚠️ Q2a line NOT in final processedLines (was filtered out during coordinate estimation)`);
        } else {
            console.log(`[Q2a DIAGNOSTIC] ✅ Q2a line IS in final processedLines`);
        }
        if (!q2bInFinal) {
            console.log(`[Q2b DIAGNOSTIC] ⚠️ Q2b line NOT in final processedLines (was filtered out during coordinate estimation)`);
        } else {
            console.log(`[Q2b DIAGNOSTIC] ✅ Q2b line IS in final processedLines`);
        }
        mathBlocks = processedLines.map(line => ({
            googleVisionText: line.text, mathpixLatex: line.text, confidence: line.confidence || 1.0,
            mathpixConfidence: line.confidence || 1.0, mathLikenessScore: 1.0, coordinates: line.coords
        } as MathBlock));
    }


    // --- Final Data Structuring and Return (No changes from here onwards) ---
    const sortedMathBlocks = [...mathBlocks].sort((a, b) => {
       const aY = a.coordinates.y;
       const aHeight = a.coordinates.height;
       const aBottom = aY + aHeight;
       const bY = b.coordinates.y;
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
      boundingBox: [ block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height ],
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