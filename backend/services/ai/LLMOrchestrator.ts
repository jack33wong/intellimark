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

    // OCR processing completed

    try {
      // Step 0a: Assign step_id to original OCR text first
      const { OCRCleanupService } = await import('./OCRCleanupService.js');
      
      // Transform mathBlocks to the expected format for assignStepIds
      // Handle both data structures: nested boundingBox and flat properties
      console.log('🔍 [DEBUG] LLMOrchestrator received boundingBoxes:', processedImage.boundingBoxes?.length || 0);
      if (processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
        console.log('🔍 [DEBUG] First block structure:', JSON.stringify(processedImage.boundingBoxes[0], null, 2));
      }
      
      const transformedBoundingBoxes = (processedImage.boundingBoxes || []).map((block: any, index: number) => {
        // Handle the new OptimizedOCRService format: {x, y, width, height} directly on block
        let x = block.x;
        let y = block.y;
        let width = block.width;
        let height = block.height;
        let text = block.text;
        
        // Debug: Log the raw block data for the first few blocks
        if (index < 3) {
          console.log(`🔍 [DEBUG] Block ${index} raw data:`, {
            x: block.x,
            y: block.y,
            width: block.width,
            height: block.height,
            text: block.text?.substring(0, 30) + '...',
            hasBoundingBox: !!block.boundingBox,
            boundingBoxKeys: block.boundingBox ? Object.keys(block.boundingBox) : []
          });
        }
        
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
      
      const stepAssignmentResult = await OCRCleanupService.assignStepIds(
        model,
        processedImage.ocrText || '',
        transformedBoundingBoxes
      );
      
      // Step 0b: Clean up OCR text while preserving step_id references
      // NOTE: Since we now filter blocks in Step 3, we can skip AI cleanup here to avoid duplication
      const extractedQuestionText = inputs.questionDetection?.extractedQuestionText || '';
      let cleanupResult;
      let totalTokens = 0;
      
      // Skip AI cleanup if blocks were already filtered in Step 3
      if (inputs.processedImage?.boundingBoxes && inputs.processedImage.boundingBoxes.length < 20) {
        console.log('📊 [SKIP AI CLEANUP] Blocks already filtered in Step 3, formatting OCR text');
        
        // Format raw OCR text into the expected JSON structure
        const rawOcrText = inputs.processedImage.ocrText || '';
        const formattedOcrData = {
          question: extractedQuestionText || "Unknown question",
          steps: inputs.processedImage.boundingBoxes.map((bbox, index) => ({
            unified_step_id: `step_${index + 1}`,
            bbox: [bbox.x, bbox.y, bbox.x + bbox.width, bbox.y + bbox.height],
            cleanedText: rawOcrText.split('\n')[index] || `Step ${index + 1}`
          }))
        };
        
        cleanupResult = { cleanedText: JSON.stringify(formattedOcrData) };
      } else {
        console.log('📊 [AI CLEANUP] Running AI-based question/answer separation');
        cleanupResult = await OCRCleanupService.cleanOCRTextWithStepIds(
          model,
          stepAssignmentResult.originalWithStepIds,
          extractedQuestionText
        );
        totalTokens = cleanupResult.usageTokens || 0;
      }

      // Parse the step assignment result (not used in current implementation)
      try {
        JSON.parse(stepAssignmentResult.originalWithStepIds);
      } catch (error) {
        console.error('❌ Failed to parse step assignment JSON:', error);
      }

      // Parse the cleaned OCR data using utility
      const { OCRDataUtils } = await import('./OCRDataUtils');
      const cleanDataForMarking = OCRDataUtils.extractDataForMarking(cleanupResult.cleanedText);

      // Step 1: Generate raw annotations from cleaned OCR text
      const { MarkingInstructionService } = await import('./MarkingInstructionService');
      
      if (!cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        throw new Error('Cannot generate annotations without steps - OCR cleanup failed');
      }
      
      
      const annotationData = await MarkingInstructionService.generateFromOCR(
        model,
        JSON.stringify(cleanDataForMarking),
        questionDetection
      );
      totalTokens += annotationData.usageTokens || 0;
      
      if (!annotationData.annotations || !Array.isArray(annotationData.annotations) || annotationData.annotations.length === 0) {
        throw new Error('AI failed to generate valid annotations array');
      }

      // Step 2: Map annotations to coordinates using pre-built unified lookup table
      const { AnnotationMapper } = await import('./AnnotationMapper');
      
      // Build the complete unified lookup table from cleaned data
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
      
      const placed = await AnnotationMapper.mapAnnotations({
        ocrText: cleanupResult.cleanedText,
        boundingBoxes: transformedBoundingBoxes, // Use the same transformed bounding boxes
        rawAnnotations: annotationData,
        imageDimensions: processedImage.imageDimensions,
        unifiedLookupTable: unifiedLookupTable // Pass the complete pre-built lookup table
      });

      const result: SimpleMarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = { 
        annotations: placed.annotations as any, 
        usage: { llmTokens: totalTokens },
        cleanedOcrText: cleanupResult.cleanedText,
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


