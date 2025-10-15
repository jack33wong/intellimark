/**
 * Hybrid OCR Service
 * Orchestrates Google Cloud Vision API with Mathpix for optimal OCR results
 * Uses robust three-pass recognition strategy for maximum accuracy
 */

import sharp from 'sharp';
import { getDebugMode } from '../../config/aiModels.js';
import type { ProcessedVisionResult } from '../../types/index.js';
import { MathpixService } from './MathpixService.js';
import { detectMathBlocks, getCropOptions, type MathBlock } from './MathDetectionService.js';
import { GoogleVisionService } from './GoogleVisionService.js';
import type { DetectedBlock } from './BlockClusteringService.js';

export interface HybridOCRResult {
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
}

// Re-export MathBlock type for backward compatibility
export type { MathBlock } from './MathDetectionService.js';

export interface HybridOCROptions {
  enablePreprocessing?: boolean;
  mathThreshold?: number;
  minMathBlockSize?: number;
  maxMathBlockSize?: number;
  dbscanEpsPx?: number;
  dbscanMinPts?: number;
}

export class HybridOCRService {
  private static readonly DEFAULT_OPTIONS: Required<HybridOCROptions> = {
    enablePreprocessing: true,
    mathThreshold: 0.35,
    minMathBlockSize: 20,
    maxMathBlockSize: 2000,
    dbscanEpsPx: 40,
    dbscanMinPts: 2
  };


  /**
   * Process image with hybrid OCR approach using robust three-pass recognition
   * @param imageData - Base64 encoded image data
   * @param options - Processing options
   */
  static async processImage(
    imageData: string,
    options: HybridOCROptions = {},
    debug: boolean = false
  ): Promise<HybridOCRResult> {
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

    // Step 4: Combine results
    const processingTime = Date.now() - startTime;
    

    // Create final result from math blocks
    const finalText = mathBlocks.map(block => block.googleVisionText || block.mathpixLatex || '').join('\n');
    const finalBoundingBoxes = mathBlocks.map(block => ({
      text: block.googleVisionText || block.mathpixLatex || '',
      x: block.coordinates.x,
      y: block.coordinates.y,
      width: block.coordinates.width,
      height: block.coordinates.height,
      confidence: block.mathpixConfidence || block.confidence  // Use Mathpix confidence if available, fail fast if missing
    }));

    const finalConfidence = mathBlocks.reduce((sum, block) => sum + (block.mathpixConfidence || block.confidence), 0) / mathBlocks.length;
    const finalSymbols = mathBlocks.map(block => ({
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
      mathBlocks: mathBlocks,
      processingTime,
      rawResponse: {
        detectedBlocks,
        // Expose pre-cluster blocks for visualization
        preClusterBlocks
      },
      usage: { mathpixCalls }
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
   * Check if hybrid OCR is available
   */
  static isAvailable(): boolean {
    return !!process.env.GOOGLE_APPLICATION_CREDENTIALS && MathpixService.isAvailable();
  }
}


