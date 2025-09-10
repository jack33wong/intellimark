/**
 * LLMOrchestrator
 * Non-breaking wrapper that uses existing AIMarkingService internals to produce
 * the same SimpleMarkingInstructions shape. This will be progressively
 * refactored to own prompts and parsing, but for now it centralizes the flow.
 */

import type {
  ModelType as SimpleModelType,
  ProcessedImageResult as SimpleProcessedImageResult,
  MarkingInstructions as SimpleMarkingInstructions
} from '../../types/index';

export interface MarkingInputs {
  imageData: string;
  model: SimpleModelType;
  processedImage: SimpleProcessedImageResult;
  // Use broad type to avoid coupling to specific question detection shapes
  questionDetection?: any;
}

export class LLMOrchestrator {
  /**
   * Execute marking flow and return existing SimpleMarkingInstructions.
   * Uses the new modular services directly.
   */
  static async executeMarking(inputs: MarkingInputs): Promise<SimpleMarkingInstructions> {
    const { imageData, model, processedImage, questionDetection } = inputs;

    console.log('🔍 ===== STEP 1: GENERATE MARKING ANNOTATIONS =====');
    try {
      // Step 1: Generate raw annotations from OCR text
      const { MarkingInstructionService } = await import('./MarkingInstructionService');
      const annotationData = await MarkingInstructionService.generateFromOCR(
        model,
        processedImage.ocrText || '',
        questionDetection
      );

      // Step 2: Map annotations to coordinates using bounding boxes
      const { AnnotationMapper } = await import('./AnnotationMapper');
      const placed = await AnnotationMapper.mapAnnotations({
        ocrText: processedImage.ocrText || '',
        boundingBoxes: (processedImage.boundingBoxes || []) as any,
        rawAnnotations: annotationData,
        imageDimensions: processedImage.imageDimensions
      });

      const result: SimpleMarkingInstructions = { annotations: placed.annotations as any };
      return result;
    } catch (error) {
      console.error('❌ New 2-step LLM flow failed:', error);
      // Fallback to basic annotations if the new flow fails
      return { annotations: [] };
    }
  }
}


