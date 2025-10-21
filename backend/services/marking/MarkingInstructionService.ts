import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';

// Import the formatting function
function formatMarkingSchemeAsBullets(schemeJson: string): string {
  try {
    // Parse the JSON marking scheme
    const scheme = JSON.parse(schemeJson);
    
    if (!scheme.marks || !Array.isArray(scheme.marks)) {
      return schemeJson; // Return original if not in expected format
    }
    
    // Convert each mark to a bullet point
    const bullets = scheme.marks.map((mark: any) => {
      const markCode = mark.mark || 'M1';
      const answer = mark.answer || '';
      return `- **[${markCode}]** ${answer}`;
    });
    
    return bullets.join('\n');
  } catch (error) {
    // If parsing fails, return the original JSON
    return schemeJson;
  }
}

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
      // ========================= START OF FIX =========================
      // Use the plain text OCR text that was passed in, not the JSON format from OCR service
      const cleanedOcrText = (processedImage as any).ocrText || (processedImage as any).cleanedOcrText;
      // ========================== END OF FIX ==========================
      const unifiedLookupTable = (processedImage as any).unifiedLookupTable;
      
      if (!cleanDataForMarking || !cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        throw new Error('Cannot generate annotations without steps - OCR cleanup failed in OCRPipeline');
      }

      // Step 1: Generate raw annotations from cleaned OCR text
      // ========================= START OF FIX 2 =========================
      // Format the marking scheme data for the AI prompt
      let formattedQuestionDetection = questionDetection;
      
      // If we have a marking scheme, format it properly for generateFromOCR
      if (questionDetection && typeof questionDetection === 'object') {
        // The questionDetection is already the marking scheme object from the router
        // We need to format it to match what generateFromOCR expects
        formattedQuestionDetection = {
          questionMarks: questionDetection, // The marking scheme is passed directly
          totalMarks: questionDetection.marks ? questionDetection.marks.length : 0
        };
      }
      // ========================== END OF FIX 2 ==========================
      
      const annotationData = await this.generateFromOCR(
        model,
        cleanedOcrText, // Use the plain text directly instead of JSON
        formattedQuestionDetection
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
    
    // ========================= START OF DEBUG =========================
    console.log("🔍 [MARKING INSTRUCTION DEBUG] questionDetection object:");
    console.log(JSON.stringify(questionDetection, null, 2));
    console.log("🔍 [MARKING INSTRUCTION DEBUG] questionDetection?.match:", questionDetection?.match);
    console.log("🔍 [MARKING INSTRUCTION DEBUG] questionDetection?.match?.markingScheme:", questionDetection?.match?.markingScheme);
    // ========================== END OF DEBUG ==========================

    // ========================= START OF FIX =========================
    // Check for marking scheme in the correct location
    const hasMarkingScheme = questionDetection?.questionMarks || questionDetection?.match?.markingScheme;
    
    if (hasMarkingScheme) {
      console.log("✅ [MARKING INSTRUCTION] Using withMarkingScheme prompt");
      systemPrompt = getPrompt('markingInstructions.withMarkingScheme.system');

      // Format marking scheme data into plain text string
      let markingSchemeContext = "MARKING SCHEME CONTEXT:\n";
      
      try {
        // Try both possible locations for the marking scheme
        const ms = questionDetection.questionMarks || questionDetection.match?.markingScheme?.questionMarks;
        console.log("🔍 [MARKING INSTRUCTION DEBUG] ms (questionMarks):", JSON.stringify(ms, null, 2));
        
        // Handle the correct structure: ms should be the full marks array from fullexampaper.questions[x].marks
        if (ms && Array.isArray(ms)) {
          // ms is the full marks array from fullexampaper.questions[x].marks
          console.log("🔍 [MARKING INSTRUCTION DEBUG] ms is the full marks array with", ms.length, "items");
          ms.forEach((markItem: any) => {
            const markCode = markItem.mark || 'M1';
            const answer = markItem.answer || markItem.comments || '';
            markingSchemeContext += `- **[${markCode}]** ${answer}\n`;
          });
        }
        // Fallback: if ms is an object with a marks property (legacy structure)
        else if (ms && typeof ms === 'object' && ms.marks && Array.isArray(ms.marks)) {
          console.log("🔍 [MARKING INSTRUCTION DEBUG] Found ms.marks array with", ms.marks.length, "items (legacy structure)");
          ms.marks.forEach((markItem: any) => {
            const markCode = markItem.mark || 'M1';
            const answer = markItem.answer || markItem.comments || '';
            markingSchemeContext += `- **[${markCode}]** ${answer}\n`;
          });
        }
        // Fallback: try to format as JSON and use the existing function
        else if (ms && typeof ms === 'object') {
          console.log("🔍 [MARKING INSTRUCTION DEBUG] Using fallback JSON formatting");
          const schemeJson = JSON.stringify(ms, null, 2);
          markingSchemeContext += formatMarkingSchemeAsBullets(schemeJson);
        } else {
          console.warn("⚠️ Marking scheme data is missing or invalid.");
          markingSchemeContext += "No valid scheme provided.\n";
        }
        
        // Add total marks if available
        // IMPORTANT: Use question-specific marks from fullexampaper.questions[x].marks array
        let totalMarks = null;
        
        // The correct structure: ms should be the full marks array from fullexampaper.questions[x].marks
        if (ms && Array.isArray(ms)) {
          // ms is the full marks array - count the number of mark objects
          totalMarks = ms.length;
          console.log(`🔍 [MARKING INSTRUCTION DEBUG] Calculated total marks from fullexampaper.questions[x].marks array: ${totalMarks}`);
        }
        // Fallback: if ms is an object with a marks property
        else if (ms && ms.marks && Array.isArray(ms.marks)) {
          // ms.marks is the full marks array
          totalMarks = ms.marks.length;
          console.log(`🔍 [MARKING INSTRUCTION DEBUG] Calculated total marks from ms.marks array: ${totalMarks}`);
        }
        // Fallback to other possible locations
        else if (questionDetection.match?.marks) {
          totalMarks = questionDetection.match.marks;
          console.log(`🔍 [MARKING INSTRUCTION DEBUG] Using match.marks: ${totalMarks}`);
        }
        // Last resort: use exam-level total (but log a warning)
        else if (questionDetection.totalMarks) {
          console.warn(`⚠️ [MARKING INSTRUCTION] Using exam-level total marks (${questionDetection.totalMarks}) instead of question-specific marks. This may be incorrect.`);
          totalMarks = questionDetection.totalMarks;
        }
        
        if (totalMarks) {
          markingSchemeContext += `\n**TOTAL MARKS:** ${totalMarks}`;
        }
        
      } catch (error) {
        console.error("❌ Error formatting marking scheme:", error);
        markingSchemeContext += "Error formatting marking scheme.\n";
      }
      
      // Create the user prompt with plain text marking scheme
      userPrompt = `Here is the OCR TEXT:

${formattedOcrText}

${markingSchemeContext}

Please analyze this work based ONLY on the provided MARKING SCHEME CONTEXT and generate appropriate marking annotations. Focus on mathematical correctness, method accuracy, and provide specific text matches for each annotation. Return ONLY a valid JSON object containing "annotations" and "studentScore". Do not generate any feedback text.`;
      
      console.log("🔍 [MARKING INSTRUCTION DEBUG] Final userPrompt (first 1000 chars):");
      console.log(userPrompt.substring(0, 1000) + (userPrompt.length > 1000 ? "..." : ""));
      // ========================== END OF FIX ==========================
    } else {
      console.log("❌ [MARKING INSTRUCTION] No marking scheme found, using basic prompt");
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


