/**
 * OCR Service
 * Complete OCR pipeline that orchestrates Google Cloud Vision API with Mathpix
 * Includes robust three-pass recognition, math block processing, and OCR cleanup
 */

import sharp from 'sharp';
import { getDebugMode } from '../../config/aiModels.js';
import type { ProcessedVisionResult } from '../../types/index.js';
import { MathpixService } from './MathpixService.js';
import { detectMathBlocks, getCropOptions, type MathBlock } from './MathDetectionService.js';
import { GoogleVisionService } from './GoogleVisionService.js';
import type { DetectedBlock } from './BlockClusteringService.js';

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
  // OCR cleanup results (from OCRPipeline)
  cleanedOcrText?: string;
  cleanDataForMarking?: any;
  unifiedLookupTable?: Record<string, { bbox: number[]; cleanedText: string }>;
}

// Re-export MathBlock type for backward compatibility
export type { MathBlock } from './MathDetectionService.js';

export interface OCROptions {
  enablePreprocessing?: boolean;
  mathThreshold?: number;
  minMathBlockSize?: number;
  maxMathBlockSize?: number;
  dbscanEpsPx?: number;
  dbscanMinPts?: number;
}

export class OCRService {
  private static readonly DEFAULT_OPTIONS: Required<OCROptions> = {
    enablePreprocessing: true,
    mathThreshold: 0.35,
    minMathBlockSize: 20,
    maxMathBlockSize: 2000,
    dbscanEpsPx: 40,
    dbscanMinPts: 2
  };


  /**
   * Process image through complete OCR pipeline
   * Includes Google Vision recognition, Mathpix processing, and OCR cleanup
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   * @param debug - Debug mode flag
   * @param model - Model type for processing
   * @param questionDetection - Question detection data for cleanup
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
    
    // Check debug mode - return mock response if enabled
    if (debug) {
      // Simulate processing delay
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

    // Convert base64 to buffer
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Step 1: Perform robust three-pass Google Vision recognition
    let detectedBlocks: DetectedBlock[] = [];
    let mathBlocks: MathBlock[] = [];
    let preClusterBlocks: DetectedBlock[] = [];
    
    try {
      const robust = await GoogleVisionService.performRobustRecognition(imageBuffer, opts.dbscanEpsPx, opts.dbscanMinPts);
      detectedBlocks = robust.finalBlocks;
      preClusterBlocks = robust.preClusterBlocks;
      

      // Convert detected blocks to our standard format
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
        dimensions: { width: 0, height: 0 }, // Will be updated from image metadata
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


      // Get image dimensions
      visionResult.dimensions = await GoogleVisionService.getImageMetadata(imageBuffer);

      // Step 2: Detect math blocks from robust recognition results
      mathBlocks = detectMathBlocks(visionResult);
      
    } catch (error) {
      console.error(`❌ [OCR PROCESSING ERROR] Google Vision failed:`, error instanceof Error ? error.message : 'Unknown error');
      console.error(`❌ [ERROR DETAILS]`, error);
      
      // Fallback to Mathpix-only processing
      if (MathpixService.isAvailable()) {
        try {
          const imageBuffer = Buffer.from(imageData.split(',')[1], 'base64');
          const mathpixResult = await MathpixService.processImage(imageBuffer, {}, debug);
          console.log('✅ [OCR PROCESSING] Mathpix fallback completed');
          if (mathpixResult.latex_styled) {
            const dimensions = await GoogleVisionService.getImageMetadata(imageBuffer);
            
            // Create a minimal result structure for Mathpix-only processing
            const visionResult: ProcessedVisionResult = {
              text: mathpixResult.latex_styled || '',
              boundingBoxes: [],
              confidence: mathpixResult.confidence || 0.5,
              dimensions,
              symbols: []
            };
            
            // Create a single math block for the entire image
            mathBlocks = [{
              googleVisionText: mathpixResult.latex_styled || '',
              mathpixLatex: mathpixResult.latex_styled,
              confidence: mathpixResult.confidence || 0.5,
              mathLikenessScore: 1.0,
              coordinates: { x: 0, y: 0, width: 100, height: 100 }
            } as MathBlock];
            
          }
        } catch (mathpixError) {
          console.error('❌ [OCR PROCESSING ERROR] Mathpix fallback also failed:', mathpixError instanceof Error ? mathpixError.message : 'Unknown error');
          console.error('❌ [ERROR DETAILS]', mathpixError);
          throw new Error(`OCR processing failed completely: Google Vision failed and Mathpix fallback also failed. ${mathpixError instanceof Error ? mathpixError.message : 'Unknown error'}`);
        }
      }
    }

    // Step 3: Process math blocks with Mathpix if available
    let mathpixCalls = 0;
    if (mathBlocks.length > 0 && MathpixService.isAvailable()) {
      try {
        // Dedupe by bbox signature and prioritize suspicious or high-score blocks
        const seen = new Set<string>();
        const queue = [...mathBlocks].sort((a, b) => (b.suspicious === true ? 1 : 0) - (a.suspicious === true ? 1 : 0) || b.mathLikenessScore - a.mathLikenessScore);

        for (let i = 0; i < queue.length; i++) {
          const mathBlock = queue[i];
          
          // Validate coordinates before cropping
          const coords = mathBlock.coordinates;
          if (!coords || 
              typeof coords.x !== 'number' || isNaN(coords.x) ||
              typeof coords.y !== 'number' || isNaN(coords.y) ||
              typeof coords.width !== 'number' || isNaN(coords.width) ||
              typeof coords.height !== 'number' || isNaN(coords.height) ||
              coords.width <= 0 || coords.height <= 0) {
            console.warn(`⚠️ Skipping math block ${i + 1}: Invalid coordinates`, coords);
            continue;
          }
          
          const cropOptions = getCropOptions(coords);
          const sig = `${cropOptions.left}-${cropOptions.top}-${cropOptions.width}-${cropOptions.height}`;
          if (seen.has(sig)) continue;
          seen.add(sig);
          
          try {
            // Phase 1: Smart Math Block Triage
            // Skip Mathpix if Google Vision confidence >= 90%
            const shouldSkipMathpix = mathBlock.confidence >= 0.9;
            
            if (shouldSkipMathpix) {
              mathBlock.mathpixLatex = mathBlock.googleVisionText;
            } else {
              // Crop the image to the math block
              const croppedBuffer = await sharp(imageBuffer)
                .extract(cropOptions)
                .png()
                .toBuffer();
              
              // Process with Mathpix
              const mathpixResult = await MathpixService.processImage(croppedBuffer, {}, debug);
              mathpixCalls += 1;
              
              if (mathpixResult.latex_styled && !mathpixResult.error) {
                mathBlock.mathpixLatex = mathpixResult.latex_styled;
                mathBlock.mathpixConfidence = mathpixResult.confidence;  // NEW: Set mathpix confidence
                // DON'T overwrite mathBlock.confidence (keep original Google Vision confidence)
              } else {
                // Fallback to Google Vision text if Mathpix fails
                console.warn(`⚠️ Mathpix failed for block ${i + 1}, using Google Vision text`);
                mathBlock.mathpixLatex = mathBlock.googleVisionText;
                // No mathpixConfidence set (Mathpix failed)
              }
            }
            
            // Small delay to avoid rate limiting
            if (i < queue.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
            
          } catch (cropError) {
            console.error(`❌ Failed to crop math block ${i + 1}:`, cropError);
          }
        }
        
        // Update mathBlocks with the modified queue
        mathBlocks.splice(0, mathBlocks.length, ...queue);
        
      } catch (error) {
        console.error('❌ Mathpix processing failed:', error);
      }
    } else if (mathBlocks.length > 0) {
      // No Mathpix available, use Google Vision results directly
    }

    // Step 4: Sort math blocks with intelligent sorting (from OCRPipeline)
    const sortedMathBlocks = [...mathBlocks].sort((a, b) => {
      const aY = a.coordinates.y;
      const aHeight = a.coordinates.height;
      const aBottom = aY + aHeight;
      const bY = b.coordinates.y;
      const bHeight = b.coordinates.height;
      const bBottom = bY + bHeight;
      
      // Check if boxes are on the same line (overlap vertically by 30% or more)
      const overlapThreshold = 0.3;
      const verticalOverlap = Math.min(aBottom, bBottom) - Math.max(aY, bY);
      
      if (verticalOverlap > 0) {
        // Calculate overlap ratio for both boxes
        const aOverlapRatio = verticalOverlap / aHeight;
        const bOverlapRatio = verticalOverlap / bHeight;
        
        if (aOverlapRatio >= overlapThreshold || bOverlapRatio >= overlapThreshold) {
          // If boxes are on the same line, sort by x-coordinate (left to right)
          return a.coordinates.x - b.coordinates.x;
        }
      }
      
      // Otherwise, sort by y-coordinate (top to bottom)
      return aY - bY;
    });

    // Step 5: OCR Cleanup (from OCRPipeline)
    let cleanedOcrText = '';
    let cleanDataForMarking: any = null;
    let unifiedLookupTable: Record<string, { bbox: number[]; cleanedText: string }> = {};

    try {
      const { OCRCleanupService } = await import('./OCRCleanupService.js');
      
      // Transform mathBlocks to the expected format for assignStepIds
      const transformedBoundingBoxes = (sortedMathBlocks || []).map((block: any, index: number) => {
        let x = block.boundingBox?.x || block.coordinates?.x || block.x;
        let y = block.boundingBox?.y || block.coordinates?.y || block.y;
        let width = block.boundingBox?.width || block.coordinates?.width || block.width;
        let height = block.boundingBox?.height || block.coordinates?.height || block.height;
        let text = block.boundingBox?.text || block.coordinates?.text || block.text;
        
        // Validate coordinates
        if (x === undefined || y === undefined || width === undefined || height === undefined) {
          throw new Error(`Block ${index} has invalid coordinates: x=${x}, y=${y}, width=${width}, height=${height}`);
        }
        
        if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
          throw new Error(`Block ${index} has NaN coordinates: x=${x}, y=${y}, width=${width}, height=${height}`);
        }
        
        if (x < 0 || y < 0 || width <= 0 || height <= 0) {
          throw new Error(`Block ${index} has invalid coordinate values: x=${x}, y=${y}, width=${width}, height=${height}`);
        }
        
        return {
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height),
          text: text || block.googleVisionText || block.mathpixLatex || '',
          confidence: block.confidence || 0
        };
      });
      
      // Step 5a: Assign step IDs
      const stepAssignmentResult = await OCRCleanupService.assignStepIds(
        model,
        mathBlocks.map(block => block.googleVisionText || block.mathpixLatex || '').join('\n'),
        transformedBoundingBoxes
      );
      
      // Step 5b: Clean up OCR text while preserving step_id references
      const extractedQuestionText = questionDetection?.extractedQuestionText || '';
      const cleanupResult = await OCRCleanupService.cleanOCRTextWithStepIds(
        model,
        stepAssignmentResult.originalWithStepIds,
        extractedQuestionText
      );
      
      // Step 5c: Extract data for marking
      const { OCRDataUtils } = await import('../../utils/OCRDataUtils');
      cleanDataForMarking = OCRDataUtils.extractDataForMarking(cleanupResult.cleanedText);
      
      // Step 5d: Build unified lookup table
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

      cleanedOcrText = cleanupResult.cleanedText;
    } catch (cleanupError) {
      console.warn('⚠️ OCR cleanup failed, using raw results:', cleanupError);
      // Continue with raw results if cleanup fails
    }

    // Step 6: Combine results
    const processingTime = Date.now() - startTime;
    
    // Create final result from sorted math blocks
    const finalText = sortedMathBlocks.map(block => block.googleVisionText || block.mathpixLatex || '').join('\n');
    const finalBoundingBoxes = sortedMathBlocks.map(block => ({
      text: block.googleVisionText || block.mathpixLatex || '',
      x: block.coordinates.x,
      y: block.coordinates.y,
      width: block.coordinates.width,
      height: block.coordinates.height,
      confidence: block.mathpixConfidence || block.confidence
    }));

    const finalConfidence = sortedMathBlocks.reduce((sum, block) => sum + (block.mathpixConfidence || block.confidence), 0) / sortedMathBlocks.length;
    const finalSymbols = sortedMathBlocks.map(block => ({
      text: block.googleVisionText || block.mathpixLatex || '',
      boundingBox: [
        block.coordinates.x,
        block.coordinates.y,
        block.coordinates.width,
        block.coordinates.height
      ],
      confidence: block.mathpixConfidence || block.confidence
    }));

    // Get image dimensions
    const dimensions = await GoogleVisionService.getImageMetadata(imageBuffer);
    
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
        // Expose pre-cluster blocks for visualization
        preClusterBlocks
      },
      usage: { mathpixCalls },
      // OCR cleanup results
      cleanedOcrText,
      cleanDataForMarking,
      unifiedLookupTable
    };
  }

  /**
   * Get service status
   */
  static getServiceStatus(): {
    googleVision: any;
    mathpix: any;
    hybrid: boolean;
    robustRecognition: boolean;
  } {
    const mathpixStatus = MathpixService.getServiceStatus();
    
    // Check if Google Vision credentials are available
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
    return !!process.env.GOOGLE_APPLICATION_CREDENTIALS && MathpixService.isAvailable();
  }
}


