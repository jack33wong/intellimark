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
  static async executeMarking(inputs: MarkingInputs): Promise<SimpleMarkingInstructions & { usage?: { llmTokens: number } }> {
    const { imageData: _imageData, model, processedImage, questionDetection } = inputs;

    // Log full raw OCR text (math block) prior to cleanup
    try {
      const boxes = processedImage.boundingBoxes || [];
      // OCR math blocks log removed for cleaner output
    } catch {}

    try {
      // Step 0a: Assign step_id to original OCR text first
      const { OCRCleanupService } = await import('./OCRCleanupService.js');
      
      // Transform mathBlocks to the expected format for assignStepIds
      // Handle both data structures: nested boundingBox and flat properties
      const transformedBoundingBoxes = (processedImage.boundingBoxes || []).map((block: any, index: number) => {
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
      
      const stepAssignmentResult = await OCRCleanupService.assignStepIds(
        model,
        processedImage.ocrText || '',
        transformedBoundingBoxes
      );
      
      // Step 0b: Clean up OCR text while preserving step_id references
      const cleanupResult = await OCRCleanupService.cleanOCRTextWithStepIds(
        model,
        stepAssignmentResult.originalWithStepIds
      );
      let totalTokens = cleanupResult.usageTokens || 0;

      // Parse the step assignment result (not used in current implementation)
      try {
        JSON.parse(stepAssignmentResult.originalWithStepIds);
      } catch (error) {
        console.error('❌ Failed to parse step assignment JSON:', error);
      }

      // Parse the cleaned OCR to extract steps with step_id and cleaned text
      let cleanedData;
      try {
        // Use JsonUtils for robust JSON cleaning and parsing
        const { JsonUtils } = await import('./JsonUtils');
        
        if (!cleanupResult.cleanedText || cleanupResult.cleanedText.trim() === '') {
          throw new Error('OCR cleanup returned empty text');
        }
        
        cleanedData = JsonUtils.cleanAndValidateJSON(cleanupResult.cleanedText, 'steps');
        
        if (!cleanedData.steps || cleanedData.steps.length === 0) {
          console.error('❌ [OCR DEBUG] No steps found in cleaned data!');
          console.error('❌ [OCR DEBUG] Full cleaned data structure:', JSON.stringify(cleanedData, null, 2));
          throw new Error('OCR cleanup failed to extract any steps');
        }
        
      } catch (error) {
        console.error('❌ [OCR DEBUG] Failed to parse cleaned OCR JSON with JsonUtils:', error);
        console.error('❌ [OCR DEBUG] Error details:', error instanceof Error ? error.message : 'Unknown error');
        console.error('❌ [OCR DEBUG] Raw cleaned text (first 1000 chars):', cleanupResult.cleanedText.substring(0, 1000));
        
        // Try manual parsing as fallback
        try {
          let jsonText = cleanupResult.cleanedText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();
          
          // Try to extract JSON from the response if it's embedded in text
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }
          
          
          cleanedData = JSON.parse(jsonText);
          
          // Validate the parsed data structure
          if (!cleanedData.steps || !Array.isArray(cleanedData.steps)) {
            throw new Error('Invalid data structure: missing or invalid steps array');
          }
          
          
        } catch (manualError) {
          console.error('❌ Manual JSON parsing also failed:', manualError);
          
          // Final fallback: Create a single step with the raw cleaned text
          cleanedData = { 
            question: "Unknown question",
            steps: [{ 
              unified_step_id: 'step_1', 
              original_text: cleanupResult.cleanedText,
              cleaned_text: cleanupResult.cleanedText,
              bbox: [0, 0, 100, 30]
            }] 
          };
          
        }
      }

      // Step 1: Generate raw annotations from cleaned OCR text
      const { MarkingInstructionService } = await import('./MarkingInstructionService');
      
      // Create a clean copy for marking service (remove original_text to avoid confusing the AI)
      const cleanDataForMarking = {
        question: cleanedData.question || "Unknown question",
        steps: cleanedData.steps?.map((step: any) => ({
          unified_step_id: step.unified_step_id,
          bbox: step.bbox,
          cleaned_text: step.cleaned_text
        })) || []
      };
      
      if (!cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        console.error('❌ [AI DEBUG] No steps available for annotation generation!');
        console.error('❌ [AI DEBUG] This will cause the AI to generate empty annotations');
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
      

      // Print raw cleaned OCR text from cleanup service
      

      // Step 2: Map annotations to coordinates using pre-built unified lookup table
      const { AnnotationMapper } = await import('./AnnotationMapper');
      
      // Build the complete unified lookup table from cleaned data
      const unifiedLookupTable: Record<string, { bbox: number[]; cleanedText: string }> = {};
      if (cleanedData.steps && Array.isArray(cleanedData.steps)) {
        for (const step of cleanedData.steps) {
          if (step.unified_step_id && step.bbox && Array.isArray(step.bbox) && step.bbox.length === 4) {
            unifiedLookupTable[step.unified_step_id] = {
              bbox: step.bbox,
              cleanedText: step.cleaned_text || ''
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

      const result: SimpleMarkingInstructions & { usage?: { llmTokens: number } } = { annotations: placed.annotations as any, usage: { llmTokens: totalTokens } };
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


