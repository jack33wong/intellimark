/**
 * LLMOrchestrator
 * Non-breaking wrapper that uses existing AIMarkingService internals to produce
 * the same SimpleMarkingInstructions shape. This will be progressively
 * refactored to own prompts and parsing, but for now it centralizes the flow.
 */

import type {
  ModelType,
  ProcessedImageResult as SimpleProcessedImageResult,
  MarkingInstructions as SimpleMarkingInstructions
} from '../../types/index.js';

export interface MarkingInputs {
  imageData: string;
  model: ModelType;
  processedImage: SimpleProcessedImageResult;
  // Use broad type to avoid coupling to specific question detection shapes
  questionDetection?: any;
}

export class LLMOrchestrator {
  /**
   * Execute marking flow and return existing SimpleMarkingInstructions.
   * Uses the new modular services directly.
   */
  static async executeMarking(inputs: MarkingInputs): Promise<SimpleMarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string }> {
    const { imageData: _imageData, model, processedImage, questionDetection } = inputs;

    // OCR processing completed - all OCR cleanup now done in Stage 3 OCRPipeline

    try {
      // Get cleaned OCR data from OCRPipeline (now includes all OCR cleanup)
      const cleanDataForMarking = (processedImage as any).cleanDataForMarking;
      const cleanedOcrText = (processedImage as any).cleanedOcrText;
      const unifiedLookupTable = (processedImage as any).unifiedLookupTable;
      
      if (!cleanDataForMarking || !cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        throw new Error('Cannot generate annotations without steps - OCR cleanup failed in OCRPipeline');
      }

      // Step 1: Generate raw annotations from cleaned OCR text
      const { MarkingInstructionService } = await import('./MarkingInstructionService');
      
      const annotationData = await MarkingInstructionService.generateFromOCR(
        model,
        JSON.stringify(cleanDataForMarking),
        questionDetection
      );
      
      if (!annotationData.annotations || !Array.isArray(annotationData.annotations) || annotationData.annotations.length === 0) {
        throw new Error('AI failed to generate valid annotations array');
      }

      // Step 2: Map annotations to coordinates using pre-built unified lookup table
      const { AnnotationMapper } = await import('../../utils/AnnotationMapper');
      
      // Transform bounding boxes for annotation mapping
      const transformedBoundingBoxes = (processedImage.boundingBoxes || []).map((block: any, index: number) => {
        let x = block.boundingBox?.x || block.coordinates?.x || block.x;
        let y = block.boundingBox?.y || block.coordinates?.y || block.y;
        let width = block.boundingBox?.width || block.coordinates?.width || block.width;
        let height = block.boundingBox?.height || block.coordinates?.height || block.height;
        let text = block.boundingBox?.text || block.coordinates?.text || block.text;
        
        return {
          x: Number(x),
          y: Number(y),
          width: Number(width),
          height: Number(height),
          text: text || block.googleVisionText || block.mathpixLatex || '',
          confidence: block.confidence || 0
        };
      });
      
      const placed = await AnnotationMapper.mapAnnotations({
        ocrText: cleanedOcrText,
        boundingBoxes: transformedBoundingBoxes,
        rawAnnotations: annotationData,
        imageDimensions: processedImage.imageDimensions,
        unifiedLookupTable: unifiedLookupTable
      });

      const result: SimpleMarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = { 
        annotations: placed.annotations as any, 
        usage: { llmTokens: annotationData.usageTokens || 0 },
        cleanedOcrText: cleanedOcrText,
        studentScore: annotationData.studentScore
      };
      return result;
    } catch (error) {
      console.error('❌ New 2-step LLM flow failed:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      // Throw the real error instead of failing silently
      throw new Error(`LLM marking flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


