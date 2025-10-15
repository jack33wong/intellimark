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
  // OCR cleanup results
  cleanedOcrText?: string;
  cleanDataForMarking?: any;
  unifiedLookupTable?: Record<string, { bbox: number[]; cleanedText: string }>;
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
    model: any = 'auto',
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

      // Step 3: OCR Cleanup (moved from LLMOrchestrator)
      const { OCRCleanupService } = await import('./OCRCleanupService.js');
      
      // Transform mathBlocks to the expected format for assignStepIds
      const transformedBoundingBoxes = (sortedHybridResult.mathBlocks || []).map((block: any, index: number) => {
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
      
      // Step 3a: Assign step IDs
      const stepAssignmentResult = await OCRCleanupService.assignStepIds(
        model,
        sortedHybridResult.text || '',
        transformedBoundingBoxes
      );
      
      // Step 3b: Clean up OCR text while preserving step_id references
      const extractedQuestionText = questionDetection?.extractedQuestionText || '';
      const cleanupResult = await OCRCleanupService.cleanOCRTextWithStepIds(
        model,
        stepAssignmentResult.originalWithStepIds,
        extractedQuestionText
      );
      
      // Step 3c: Extract data for marking
      const { OCRDataUtils } = await import('../../utils/OCRDataUtils');
      const cleanDataForMarking = OCRDataUtils.extractDataForMarking(cleanupResult.cleanedText);
      
      // Step 3d: Build unified lookup table
      const unifiedLookupTable: Record<string, { bbox: number[]; cleanedText: string }> = {};
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

      // Step 4: Return comprehensive OCR result
      const processingTime = Date.now() - startTime;
      
      return {
        ocrText: sortedHybridResult.text,
        boundingBoxes: (sortedHybridResult.mathBlocks || []) as any,
        imageDimensions: sortedHybridResult.dimensions,
        confidence: sortedHybridResult.confidence,
        mathpixCalls: sortedHybridResult.usage?.mathpixCalls || 0,
        processingTime,
        rawResponse: sortedHybridResult.rawResponse,
        // OCR cleanup results
        cleanedOcrText: cleanupResult.cleanedText,
        cleanDataForMarking,
        unifiedLookupTable
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
