import type { ProcessedImageResult } from '../../types/index.js';

export interface OCROptions {
  enablePreprocessing?: boolean;
  mathThreshold?: number;
  minMathBlockSize?: number;
  maxMathBlockSize?: number;
  dbscanEpsPx?: number;
  dbscanMinPts?: number;
}

export interface OCRResult extends ProcessedImageResult {
  mathpixCalls?: number;
  processingTime?: number;
  rawResponse?: any;
}

/**
 * OCRPipeline - Centralized OCR processing for Stage 3
 * This pipeline orchestrates the entire OCR flow including:
 * - HybridOCRService processing
 * - Math block sorting
 * - Data structure normalization
 */
export class OCRPipeline {
  /**
   * Process image through complete OCR pipeline
   * Returns the exact same data structure as processImageWithRealOCR
   */
  static async processImage(
    imageData: string,
    options: OCROptions = {},
    debug: boolean = false,
    model: string = 'auto',
    questionDetection?: any
  ): Promise<OCRResult> {
    const startTime = Date.now();
    
    try {
      // Step 1: Get hybrid OCR result (same logic as getHybridOCRResult)
      const { HybridOCRService } = await import('./hybridOCRService.js');

      const hybridResult = await HybridOCRService.processImage(imageData, {
        enablePreprocessing: true,
        mathThreshold: 0.10,
        ...options
      }, debug);

      // Step 2: Sort math blocks with intelligent sorting (same logic as getHybridOCRResult)
      const sortedMathBlocks = [...hybridResult.mathBlocks].sort((a, b) => {
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

      const sortedHybridResult = {
        ...hybridResult,
        mathBlocks: sortedMathBlocks
      };

      // Step 3: Return exact same data structure as processImageWithRealOCR
      const processingTime = Date.now() - startTime;
      
      return {
        ocrText: sortedHybridResult.text,
        boundingBoxes: (sortedHybridResult.mathBlocks || []) as any,
        imageDimensions: sortedHybridResult.dimensions,
        confidence: sortedHybridResult.confidence,
        mathpixCalls: sortedHybridResult.usage?.mathpixCalls || 0,
        processingTime,
        rawResponse: sortedHybridResult.rawResponse
      };
      
    } catch (error) {
      console.error('❌ [OCR PIPELINE] Error processing image:', error);
      throw error;
    }
  }

  /**
   * Get service status
   */
  static getServiceStatus(): any {
    const { HybridOCRService } = require('./hybridOCRService.js');
    return HybridOCRService.getServiceStatus();
  }

  /**
   * Check if OCR pipeline is available
   */
  static isAvailable(): boolean {
    const { HybridOCRService } = require('./hybridOCRService.js');
    return HybridOCRService.isAvailable();
  }
}
