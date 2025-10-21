import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';

// ========================= START: NORMALIZED DATA STRUCTURE =========================
interface NormalizedMarkingScheme {
  marks: any[];           // The marking scheme array
  totalMarks: number;     // Total marks for the question
  questionNumber: string; // Question identifier
}

// ========================= START: NORMALIZATION FUNCTION =========================
function normalizeMarkingScheme(input: any): NormalizedMarkingScheme | null {
  console.log("🔍 [NORMALIZATION DEBUG] Starting normalization with input:");
  console.log("  - Input type:", typeof input);
  console.log("  - Input keys:", input ? Object.keys(input) : 'null/undefined');
  
  if (!input || typeof input !== 'object') {
    console.log("❌ [NORMALIZATION DEBUG] Input is null, undefined, or not an object");
    return null;
  }
  
  // ========================= SINGLE IMAGE PIPELINE FORMAT =========================
  if (input.markingScheme && typeof input.markingScheme === 'string') {
    console.log("✅ [NORMALIZATION DEBUG] Detected single image pipeline format");
    console.log("  - markingScheme type:", typeof input.markingScheme);
    console.log("  - markingScheme length:", input.markingScheme.length);
    console.log("  - match.marks:", input.match?.marks);
    console.log("  - match.questionNumber:", input.match?.questionNumber);
    
    try {
      const parsed = JSON.parse(input.markingScheme);
      console.log("  - Parsed markingScheme keys:", Object.keys(parsed));
      
      const normalized = {
        marks: parsed.marks || [],
        totalMarks: input.match?.marks || 0,
        questionNumber: input.match?.questionNumber || '1'
      };
      
      console.log("✅ [NORMALIZATION DEBUG] Single image normalization result:");
      console.log("  - marks array length:", normalized.marks.length);
      console.log("  - totalMarks:", normalized.totalMarks);
      console.log("  - questionNumber:", normalized.questionNumber);
      
      return normalized;
    } catch (error) {
      console.error("❌ [NORMALIZATION DEBUG] Failed to parse markingScheme JSON:", error);
      return null;
    }
  }
  
  // ========================= UNIFIED PIPELINE FORMAT =========================
  if (input.questionMarks && input.totalMarks !== undefined) {
    console.log("✅ [NORMALIZATION DEBUG] Detected unified pipeline format");
    console.log("  - questionMarks type:", typeof input.questionMarks);
    console.log("  - questionMarks keys:", input.questionMarks ? Object.keys(input.questionMarks) : 'null/undefined');
    console.log("  - totalMarks:", input.totalMarks);
    console.log("  - questionNumber:", input.questionNumber);
    
    // Extract marks array from questionMarks.marks
    const marksArray = input.questionMarks.marks || [];
    console.log("  - extracted marks array length:", marksArray.length);
    
    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1'
    };
    
    console.log("✅ [NORMALIZATION DEBUG] Unified pipeline normalization result:");
    console.log("  - marks array length:", normalized.marks.length);
    console.log("  - totalMarks:", normalized.totalMarks);
    console.log("  - questionNumber:", normalized.questionNumber);
    
    return normalized;
  }
  
  // ========================= FALLBACK: MATCH OBJECT FORMAT =========================
  if (input.match?.markingScheme?.questionMarks) {
    console.log("✅ [NORMALIZATION DEBUG] Detected fallback match object format");
    console.log("  - match.markingScheme.questionMarks type:", typeof input.match.markingScheme.questionMarks);
    console.log("  - match.marks:", input.match.marks);
    console.log("  - match.questionNumber:", input.match.questionNumber);
    
    const normalized = {
      marks: Array.isArray(input.match.markingScheme.questionMarks) ? input.match.markingScheme.questionMarks : [],
      totalMarks: input.match.marks || 0,
      questionNumber: input.match.questionNumber || '1'
    };
    
    console.log("✅ [NORMALIZATION DEBUG] Fallback normalization result:");
    console.log("  - marks array length:", normalized.marks.length);
    console.log("  - totalMarks:", normalized.totalMarks);
    console.log("  - questionNumber:", normalized.questionNumber);
    
    return normalized;
  }
  
  console.log("❌ [NORMALIZATION DEBUG] No recognized format found");
  console.log("  - Available properties:", Object.keys(input));
  return null;
}
// ========================== END: NORMALIZATION FUNCTION ==========================

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
      // ========================= START: CLEAN NORMALIZATION =========================
      console.log("🔍 [MARKING INSTRUCTION] About to normalize questionDetection:");
      console.log("  - questionDetection type:", typeof questionDetection);
      console.log("  - questionDetection:", questionDetection ? 'exists' : 'null/undefined');
      
      // Normalize the marking scheme data to a standard format
      const normalizedScheme = normalizeMarkingScheme(questionDetection);
      
      if (normalizedScheme) {
        console.log("✅ [MARKING INSTRUCTION] Successfully normalized marking scheme");
        console.log("  - Question Number:", normalizedScheme.questionNumber);
        console.log("  - Total Marks:", normalizedScheme.totalMarks);
        console.log("  - Marks Array Length:", normalizedScheme.marks.length);
      } else {
        console.log("⚠️ [MARKING INSTRUCTION] No marking scheme found or normalization failed");
        console.log("  - This will result in using the basic prompt instead of withMarkingScheme");
      }
      // ========================== END: CLEAN NORMALIZATION ==========================
      
      const annotationData = await this.generateFromOCR(
        model,
        cleanedOcrText, // Use the plain text directly instead of JSON
        normalizedScheme // Pass the normalized scheme instead of raw questionDetection
      );
      
      if (!annotationData.annotations || !Array.isArray(annotationData.annotations) || annotationData.annotations.length === 0) {
        throw new Error('AI failed to generate valid annotations array');
      }

      // ========================= START: ANNOTATION ENRICHMENT =========================
      // Enrich annotations with bbox coordinates for single image pipeline
      console.log("🔍 [ANNOTATION ENRICHMENT] Starting enrichment for single image pipeline");
      console.log(`  - Raw annotations count: ${annotationData.annotations.length}`);
      console.log(`  - Steps data count: ${cleanDataForMarking.steps.length}`);
      
      const enrichedAnnotations = annotationData.annotations.map(anno => {
        const aiStepId = (anno as any).step_id?.trim();
        if (!aiStepId) {
          console.warn(`[ENRICHMENT] AI annotation has missing step_id:`, anno);
          return null;
        }
        
        console.log(`[ENRICHMENT] Looking for step_id: "${aiStepId}"`);
        
        // Find matching step in cleanDataForMarking.steps
        const matchingStep = cleanDataForMarking.steps.find((step: any) => 
          step.unified_step_id?.trim() === aiStepId
        );
        
        if (matchingStep && matchingStep.bbox) {
          console.log(`[ENRICHMENT] Found match for "${aiStepId}" with bbox: [${matchingStep.bbox.join(', ')}]`);
          return {
            ...anno,
            bbox: matchingStep.bbox as [number, number, number, number],
            pageIndex: 0 // Single image is always page 0
          };
        } else {
          console.warn(`[ENRICHMENT] No matching step found for "${aiStepId}"`);
          return null;
        }
      }).filter(anno => anno !== null);
      
      console.log(`✅ [ANNOTATION ENRICHMENT] Enriched ${enrichedAnnotations.length} out of ${annotationData.annotations.length} annotations`);
      // ========================== END: ANNOTATION ENRICHMENT ==========================
      
      const result: MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = { 
        annotations: enrichedAnnotations, // ✅ Return enriched annotations with bbox coordinates
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
    normalizedScheme?: NormalizedMarkingScheme | null
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

    // ========================= START: USE SINGLE PROMPT =========================
    // Use the centralized prompt from prompts.ts
    const { AI_PROMPTS } = await import('../../config/prompts.js');
    
    // Determine which prompt to use based on whether we have a normalized marking scheme
    const hasMarkingScheme = normalizedScheme !== null && normalizedScheme !== undefined;
    
    console.log("🔍 [MARKING INSTRUCTION] Prompt selection:");
    console.log("  - hasMarkingScheme:", hasMarkingScheme);
    console.log("  - normalizedScheme:", normalizedScheme ? 'exists' : 'null/undefined');
    
    let systemPrompt: string;
    let userPrompt: string;
    
    if (hasMarkingScheme) {
      // Use the withMarkingScheme prompt
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = prompt.system;
      
      // Format marking scheme for the prompt using normalized data
      let schemeJson = '';
      try {
        // Convert normalized scheme to JSON format for the prompt
        schemeJson = JSON.stringify({ marks: normalizedScheme.marks }, null, 2);
        console.log("✅ [MARKING INSTRUCTION] Using normalized marking scheme");
        console.log("  - Marks array length:", normalizedScheme.marks.length);
        console.log("  - Total marks:", normalizedScheme.totalMarks);
        console.log("  - Question number:", normalizedScheme.questionNumber);
      } catch (error) {
        console.warn("⚠️ Error formatting normalized marking scheme for prompt:", error);
        schemeJson = '{}';
      }
      
      // Get the total marks from the normalized scheme
      const totalMarks = normalizedScheme.totalMarks;
      
      console.log("🔍 [MARKING INSTRUCTION] Total marks calculation:");
      console.log(`  -> Final totalMarks: ${totalMarks}`);
      
      console.log("🔍 [MARKING INSTRUCTION] Scheme JSON being passed to prompt:");
      console.log(schemeJson.substring(0, 500) + (schemeJson.length > 500 ? "..." : ""));
      
      // ========================= START OF FIX =========================
      // Convert JSON marking scheme to plain text bullets for the prompt
      const schemePlainText = formatMarkingSchemeAsBullets(schemeJson);
      console.log("🔍 [MARKING INSTRUCTION] Scheme plain text being passed to prompt:");
      console.log(schemePlainText.substring(0, 500) + (schemePlainText.length > 500 ? "..." : ""));
      
      userPrompt = prompt.user(formattedOcrText, schemePlainText, totalMarks);
      // ========================== END OF FIX ==========================
    } else {
      // Use the basic prompt
      const prompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = prompt.system;
      userPrompt = prompt.user(formattedOcrText);
    }
    
    console.log("🔍 [MARKING INSTRUCTION] Using prompt:", hasMarkingScheme ? 'withMarkingScheme' : 'basic');
    console.log("🔍 [MARKING INSTRUCTION] User prompt (first 500 chars):\n", userPrompt.substring(0, 500) + "...");
    // ========================== END: USE SINGLE PROMPT ==========================

    let aiResponseString = ''; // Declare outside try block for error logging
    
    try {
      // Use the provided model parameter
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true);
      
      aiResponseString = res.content;
      const usageTokens = res.usageTokens;

      // ========================= START: RAW RESPONSE LOGGING =========================
      console.log("------------------------------------------");
      console.log("[DEBUG - AI RAW RESPONSE] Raw string received from AI:");
      console.log(aiResponseString);
      console.log("------------------------------------------");
      // ========================== END: RAW RESPONSE LOGGING ==========================

      // Parse the AI response (Add robust parsing/cleanup)
      let jsonString = aiResponseString;
      const jsonMatch = aiResponseString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
           console.log("[DEBUG - AI RAW RESPONSE] Extracted JSON block from markdown.");
           jsonString = jsonMatch[1];
      } else {
           console.log("[DEBUG - AI RAW RESPONSE] No JSON markdown block detected, attempting direct parse.");
      }

      const parsedResponse = JSON.parse(jsonString);

      // ========================= START: PARSED RESPONSE LOGGING =========================
      console.log("[DEBUG - AI PARSED RESPONSE] Parsed response object:");
      console.dir(parsedResponse, { depth: 3 });
      // Specifically check the annotations array
      if (parsedResponse.annotations) {
          console.log(`[DEBUG - AI PARSED RESPONSE] Annotations array length: ${parsedResponse.annotations.length}`);
      } else {
           console.warn("[DEBUG - AI PARSED RESPONSE] Parsed response MISSING 'annotations' key!");
      }
      // ========================== END: PARSED RESPONSE LOGGING ==========================

      // Return the correct MarkingInstructions structure
      const markingResult = {
          annotations: parsedResponse.annotations || [], // Default to empty array if missing
          studentScore: parsedResponse.studentScore || null,
          usageTokens
      };
      
      console.log("[DEBUG MARKING RESULT] Returning from MarkingInstructionService:", {
        hasAnnotations: (markingResult.annotations?.length || 0) > 0,
        annotationsLength: markingResult.annotations?.length || 0,
        hasStudentScore: !!markingResult.studentScore,
        studentScore: markingResult.studentScore
      });
      
      return markingResult;

    } catch (error) {
         console.error("❌ Error calling AI for marking instructions or parsing response:", error);
         // Log the raw response string if parsing failed
         if (error instanceof SyntaxError) {
             console.error("❌ RAW AI RESPONSE STRING that failed to parse:", aiResponseString);
         }
         throw new Error(`AI marking instruction generation failed: ${error instanceof Error ? error.message : 'Unknown AI error'}`);
    }
  }
}


