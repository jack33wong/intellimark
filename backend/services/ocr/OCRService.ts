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
  private static extractBoundingBox(line: any): { x: number, y: number, width: number, height: number } | null {
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
    console.log('🔧 [OCR BOUNDARY] Attempting fuzzy match boundary detection.');
    
    if (!questionText || questionText.trim().length === 0) {
      console.warn('  -> No question text provided. Falling back: treating all as student work.');
      return 0; // Fallback: Assume everything is student work if no question text
    }

    // Split question text into lines for matching
    const questionLines = questionText.split('\n').map(l => l.trim()).filter(Boolean);
    if (questionLines.length === 0) {
       console.warn('  -> Question text was empty after splitting. Falling back.');
       return 0;
    }

    const SIMILARITY_THRESHOLD = 0.80; // How similar lines must be to be considered a match
    let lastMatchIndex = -1;

    // Iterate through each line detected by OCR
    for (let i = 0; i < ocrLines.length; i++) {
        const ocrLineText = ocrLines[i].latex_styled || ocrLines[i].text || '';
        if (!ocrLineText.trim()) continue;

        // Find the best match for this OCR line within the question text lines
        const bestMatch = stringSimilarity.findBestMatch(ocrLineText, questionLines);
        
        // If the best match is strong enough, update the last known index of question text
        if (bestMatch.bestMatch.rating >= SIMILARITY_THRESHOLD) {
            console.log(`  -> Found potential question line match at index ${i} (Similarity: ${bestMatch.bestMatch.rating.toFixed(2)}): "${ocrLineText.substring(0,60)}..."`);
            lastMatchIndex = i;
        }
    }

    let boundaryIndex = 0;
    if (lastMatchIndex !== -1) {
        // Assume student work starts *after* the last line that matched the question text
        boundaryIndex = lastMatchIndex + 1;
        console.log(`  -> Boundary set at index ${boundaryIndex} (after last strong match).`);
    } else {
        console.warn('  -> No strong match found between OCR lines and question text. Falling back: treating all as student work.');
        boundaryIndex = 0; // Fallback if no lines matched confidently
    }

    // Ensure boundary index is within bounds
    boundaryIndex = Math.min(boundaryIndex, ocrLines.length); 
    console.log(`✅ [OCR BOUNDARY] Final boundary index determined: ${boundaryIndex}`);
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
             console.log(`⚠️ [OCR FILTERING FALLBACK] Ignoring noise in margin. Text: ${block.text}`);
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
   * @param questionDetection - Contains extractedQuestionText for fuzzy matching boundary detection
   */
  static async processImage(
    imageData: string,
    options: OCROptions = {},
    debug: boolean = false,
    model: any = 'auto',
    questionDetection?: any
  ): Promise<OCRResult> {
    const startTime = Date.now();
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Check debug mode (Existing logic)
    if (debug) {
      const debugMode = getDebugMode();
      await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
      return {
        text: 'Debug mode: Mock OCR text recognition',
        boundingBoxes: [],
        confidence: 0.95,
        dimensions: { width: 800, height: 600 },
        symbols: [],
        mathBlocks: [],
        processingTime: Date.now() - startTime,
        rawResponse: null
      };
    }

    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const dimensions = await GoogleVisionService.getImageMetadata(imageBuffer);

    // Initialize variables
    let detectedBlocks: DetectedBlock[] = [];
    let mathBlocks: MathBlock[] = []; // Changed back from EnhancedMathBlock for simplicity now
    let preClusterBlocks: DetectedBlock[] = [];
    let mathpixCalls = 0;
    let usedFallback = false; 

    let rawLineData: Array<any> | null = null;

    // --- STEP 1: OCR EXECUTION (Mathpix First or Fallback) ---

    // Primary Strategy (Mathpix First)
    if (MathpixService.isAvailable()) {
      try {
        console.log('✅ [OCR PROCESSING] Attempting Mathpix First strategy (v3/text).');
        
        const mathpixOptions = {
          formats: ["text", "latex_styled"],
          include_line_data: true,
          disable_array_detection: true // Keep this!
        };
        
        const mathpixResult = await MathpixService.processImage(imageBuffer, mathpixOptions, debug);
        mathpixCalls += 1;

        if (mathpixResult.line_data && mathpixResult.line_data.length > 0) {
            rawLineData = mathpixResult.line_data;
            console.log('✅ [OCR PROCESSING] Mathpix First strategy successful. Raw lines detected:', rawLineData.length);
             // DIAGNOSTIC LOGGING
            console.log('🔍 [OCR DIAGNOSTIC] Structure of first Mathpix line_data item:', JSON.stringify(rawLineData[0], null, 2));
        } else if (mathpixResult.error) {
           console.error('❌ [OCR] Mathpix processing reported error:', mathpixResult.error);
        } else {
            console.log('⚠️ [OCR] Mathpix v3/text returned no line data.');
        }

      } catch (error) {
        console.error('❌ [OCR] Error during Mathpix First strategy (v3/text):', error);
      }
    }

    // --- FALLBACK AND POST-PROCESSING ---
    if (!rawLineData || rawLineData.length === 0) {
        // ... (Full fallback logic remains the same)
        console.warn(`⚠️ [OCR STRATEGY] No initial line data or Mathpix failed. Triggering robust fallback.`);
        usedFallback = true;
        try {
           const fallbackResult = await this.fallbackHybridStrategy(imageBuffer, dimensions, opts, debug);
           mathBlocks = fallbackResult.mathBlocks; // Fallback directly sets mathBlocks
           mathpixCalls += fallbackResult.mathpixCalls;
        } catch (error) {
           console.error('❌ [OCR] Robust fallback strategy failed:', error);
        }
    } else {
        // ========================= START OF REFINED LOGIC =========================
        // 1. DETERMINE BOUNDARY using fuzzy matching against provided question text
        const extractedQuestionText = questionDetection?.extractedQuestionText;
        const studentWorkStartIndex = this.findBoundaryByFuzzyMatch(rawLineData, extractedQuestionText);
        const initialStudentLines = rawLineData.slice(studentWorkStartIndex);
        
        // 2. UNGROUP ARRAYS (remains crucial)
        const ungroupedLines: any[] = [];
        initialStudentLines.forEach(line => {
             // ... (Ungrouping logic is unchanged)
            const text = line.latex_styled || line.text || '';
            const coords = this.extractBoundingBox(line);
            if (!text || !coords) return;

            if (text.includes('\\\\')) {
                console.log('🔍 [OCR POST-PROCESSING] Detected merged lines (\\\\). Splitting.');
                let cleanText = text.replace(/\\\[|\\\]|\\begin{array}\{.*\}|\\end{array}/g, '').trim();
                const splitLines = cleanText.split(/\\\\/g).map(l => l.trim()).filter(Boolean);
                const avgHeight = coords.height / (splitLines.length || 1);
                splitLines.forEach((splitText, index) => {
                    const newLine = { ...line, latex_styled: splitText, text: splitText };
                    const newCoords = { ...coords, y: coords.y + (index * avgHeight), height: avgHeight };
                    newLine.region = newCoords; 
                    ungroupedLines.push(newLine);
                });
            } else {
                ungroupedLines.push(line);
            }
        });

        // 3. APPLY INCLUSIONARY FILTER (still essential)
        const studentWorkLines = ungroupedLines.filter(line => {
             // ... (Inclusionary filter logic is unchanged)
             // Rules: Keep if includes '=', is math expression, or is single number. Discard otherwise.
            const text = line.latex_styled || line.text || '';
            if (!text.trim()) return false;
            const coords = this.extractBoundingBox(line);
            if (coords) { /* Margin check */ }
            if (text.includes('=')) return true;
            const hasNumber = /\d/.test(text);
            const hasOperatorOrVariable = /[+\-^*/÷×nxyz]/.test(text);
            if (hasNumber && hasOperatorOrVariable) return true;
            const isSingleNumber = /^\s*£?[\d.,]+\s*$/.test(text.replace(/\\text\{.*?\}/g, ''));
            if (isSingleNumber) return true;
            console.log(`🗑️ [OCR FILTERING] Discarding ambiguous line: "${text}"`);
            return false;
        });

        // 4. PREPARE FINAL MATHBLOCKS
        const processedLines: any[] = [];
        for (const line of studentWorkLines) {
             const text = line.latex_styled || line.text || '';
             const coords = this.extractBoundingBox(line);
             if (!text || !coords) continue;
             processedLines.push({ text, coords });
        }
        mathBlocks = processedLines.map(line => ({
            googleVisionText: line.text, mathpixLatex: line.text, confidence: line.confidence || 1.0,
            mathpixConfidence: line.confidence || 1.0, mathLikenessScore: 1.0, coordinates: line.coords
        } as MathBlock));
        // ========================== END OF REFINED LOGIC ==========================
    }
    
    console.log(`✅ [OCR PROCESSING] Processing complete. Final student work lines: ${mathBlocks.length}.`);

    // --- Final Data Structuring and Return (No changes from here onwards) ---
    const sortedMathBlocks = [...mathBlocks].sort((a, b) => {
       // (Adaptive sorting logic implementation remains the same)
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
          // Basic validation
          if (!coords || isNaN(coords.x) || isNaN(coords.y) || isNaN(coords.width) || isNaN(coords.height)) {
              return null;
          }

          const text = block.mathpixLatex || block.googleVisionText || '';

          return {
            unified_step_id: `step_${index + 1}`, // Assign new step IDs starting from 1
            text: text,
            cleanedText: text, 
            bbox: [coords.x, coords.y, coords.width, coords.height]
          };
        }).filter(step => step !== null && step.text.trim().length > 0);
        
        cleanedOcrText = JSON.stringify({ steps });

        // Extract data for marking (Parsing the JSON)
        const { OCRDataUtils } = await import('../../utils/OCRDataUtils');
        cleanDataForMarking = OCRDataUtils.extractDataForMarking(cleanedOcrText);
        
        // Build unified lookup table
        if (cleanDataForMarking.steps && Array.isArray(cleanDataForMarking.steps)) {
            for (const step of cleanDataForMarking.steps) {
              if (step.unified_step_id && step.bbox && Array.isArray(step.bbox) && step.bbox.length === 4) {
                unifiedLookupTable[step.unified_step_id] = {
                  bbox: step.bbox,
                  cleanedText: step.cleanedText || ''
                };
              }
            }
        }

    } catch (structuringError) {
      console.error('❌ [OCR] Data structuring failed:', structuringError);
      // Ensure we don't crash if structuring fails, return partial data
      if (!cleanDataForMarking) {
         cleanDataForMarking = { question: 'Error during structuring', steps: [] };
      }
      if (!cleanedOcrText) {
          cleanedOcrText = JSON.stringify({ steps: [] });
      }
    }
    
    // Step 6: Combine results
    const processingTime = Date.now() - startTime;
    
    // Construct final fields based on sortedMathBlocks
    const finalText = sortedMathBlocks.map(block => block.mathpixLatex || block.googleVisionText || '').join('\n');
    const finalBoundingBoxes = sortedMathBlocks.map(block => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      x: block.coordinates.x,
      y: block.coordinates.y,
      width: block.coordinates.width,
      height: block.coordinates.height,
      confidence: block.mathpixConfidence || block.confidence
    }));

    const finalConfidence = sortedMathBlocks.length > 0 ? sortedMathBlocks.reduce((sum, block) => sum + (block.mathpixConfidence || block.confidence), 0) / sortedMathBlocks.length : 0;
    const finalSymbols = sortedMathBlocks.map(block => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      boundingBox: [
        block.coordinates.x,
        block.coordinates.y,
        block.coordinates.width,
        block.coordinates.height
      ],
      confidence: block.mathpixConfidence || block.confidence
    }));

    // Return the final OCRResult object
    return {
      text: finalText,
      boundingBoxes: finalBoundingBoxes,
      confidence: finalConfidence,
      dimensions,
      symbols: finalSymbols,
      mathBlocks: sortedMathBlocks,
      processingTime,
      rawResponse: {
        detectedBlocks, 
        preClusterBlocks,
        usedFallback
      },
      usage: { mathpixCalls },
      cleanedOcrText,
      cleanDataForMarking,
      unifiedLookupTable
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