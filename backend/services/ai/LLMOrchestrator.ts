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

    // Log full raw OCR text (math block) prior to cleanup
    try {
      console.log('🧾 RAW OCR TEXT (pre-clean):');
      console.log('─'.repeat(80));
      console.log(processedImage.ocrText || '');
      console.log('─'.repeat(80));
      const boxes = processedImage.boundingBoxes || [];
      console.log(`🧮 OCR bounding boxes: ${boxes.length}`);
      if (boxes.length > 0) {
        console.log('📦 OCR math blocks (with coordinates):');
        const dump = boxes.map((b: any, i: number) => ({
          index: i,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          text: b.text
        }));
        console.log(JSON.stringify(dump, null, 2));
      }
    } catch {}

    try {
      // Step 0a: Assign step_id to original OCR text first
      const { OCRCleanupService } = await import('./OCRCleanupService');
      const stepAssignmentResult = await OCRCleanupService.assignStepIds(
        model,
        processedImage.ocrText || '',
        processedImage.boundingBoxes || []
      );

      // Step 0b: Clean up OCR text while preserving step_id references
      const cleanupResult = await OCRCleanupService.cleanOCRTextWithStepIds(
        model,
        stepAssignmentResult.originalWithStepIds
      );

      // Parse the step assignment result
      let stepAssignmentData;
      try {
        stepAssignmentData = JSON.parse(stepAssignmentResult.originalWithStepIds);
      } catch (error) {
        console.error('❌ Failed to parse step assignment JSON:', error);
        stepAssignmentData = { steps: [] };
      }

      // Parse the cleaned OCR to extract steps with step_id
      let cleanedData;
      try {
        cleanedData = JSON.parse(cleanupResult.cleanedText.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
      } catch (error) {
        console.error('❌ Failed to parse cleaned OCR JSON:', error);
        // Fallback to treating as plain text
        cleanedData = { steps: [{ step_id: 'step_1', text: cleanupResult.cleanedText }] };
      }

      // Step 1: Generate raw annotations from cleaned OCR text
      const { MarkingInstructionService } = await import('./MarkingInstructionService');
      const annotationData = await MarkingInstructionService.generateFromOCR(
        model,
        cleanupResult.cleanedText,
        questionDetection
      );

      // Re-opened: print raw AI response from marking LLM
      console.log('🔍 Raw annotation data from MarkingInstructionService:', annotationData);

      // Step 2: Map annotations to coordinates using bounding boxes and step_id mapping
      const { AnnotationMapper } = await import('./AnnotationMapper');
      const placed = await AnnotationMapper.mapAnnotations({
        ocrText: cleanupResult.cleanedText,
        boundingBoxes: (processedImage.boundingBoxes || []) as any,
        rawAnnotations: annotationData,
        imageDimensions: processedImage.imageDimensions,
        stepMapping: cleanedData.steps || [], // Pass the cleaned step mapping
        stepAssignment: stepAssignmentData.steps || [] // Pass the original step assignment for bbox matching
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


