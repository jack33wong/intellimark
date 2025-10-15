import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';

export interface MarkingInputs {
  imageData: string;
  model: ModelType;
  processedImage: ProcessedImageResult;
  questionDetection?: any;
}

export class MarkingInstructionService {
  /**
   * Execute complete marking flow - moved from LLMOrchestrator
   */
  static async executeMarking(inputs: MarkingInputs): Promise<MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string }> {
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
      const annotationData = await this.generateFromOCR(
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

      const result: MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = { 
        annotations: placed.annotations as any, 
        usage: { llmTokens: annotationData.usageTokens || 0 },
        cleanedOcrText: cleanedOcrText,
        studentScore: annotationData.studentScore
      };
      return result;
    } catch (error) {
      console.error('❌ Marking flow failed:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      // Throw the real error instead of failing silently
      throw new Error(`Marking flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static async generateFromOCR(
    model: ModelType,
    ocrText: string,
    questionDetection?: any
  ): Promise<{ annotations: string; studentScore?: any; usageTokens: number }> {
    // Parse and format OCR text if it's JSON
    let formattedOcrText = ocrText;
    try {
      const parsedOcr = JSON.parse(ocrText);
      if (parsedOcr.question && parsedOcr.steps) {
        // Format the OCR text nicely
        formattedOcrText = `Question: ${parsedOcr.question}\n\nStudent's Work:\n${parsedOcr.steps.map((step: any, index: number) => 
          `${index + 1}. [${step.unified_step_id}] ${step.cleanedText}`
        ).join('\n')}`;
      }
    } catch (error) {
      // If parsing fails, use original text
      formattedOcrText = ocrText;
    }

    let systemPrompt = getPrompt('markingInstructions.basic.system');
    let userPrompt = getPrompt('markingInstructions.basic.user', formattedOcrText);
    
    if (questionDetection?.match?.markingScheme) {
      systemPrompt = getPrompt('markingInstructions.withMarkingScheme.system');

      // Add question detection context if available
      const ms = questionDetection.match.markingScheme.questionMarks as any;
      const schemeJson = JSON.stringify(ms, null, 2);
      userPrompt = getPrompt('markingInstructions.withMarkingScheme.user', formattedOcrText, schemeJson, questionDetection.match.marks);
    }

    
    // Log prompts and response for debugging
    console.log('🔍 [MARKING INSTRUCTION] User Prompt:');
    console.log(userPrompt);
    
    // Use the provided model parameter
    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true);
    
    const responseText = res.content;
    const usageTokens = res.usageTokens;
    
    // Log AI response
    console.log('🔍 [MARKING INSTRUCTION] AI Response:');
    console.log(responseText);
   
    try {
      const { JsonUtils } = await import('../../utils/JsonUtils');
      const parsed = JsonUtils.cleanAndValidateJSON(responseText, 'annotations');
      return { 
        annotations: parsed.annotations || [], 
        studentScore: parsed.studentScore,
        usageTokens 
      };
    } catch (error) {
      console.error('❌ LLM2 JSON parsing failed:', error);
      console.error('❌ Raw response that failed to parse:', responseText);
      throw new Error(`LLM2 failed to generate valid marking annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


