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
  if (!input || typeof input !== 'object') {
    return null;
  }
  
  // ========================= SINGLE IMAGE PIPELINE FORMAT =========================
  if (input.markingScheme && typeof input.markingScheme === 'string') {
    try {
      const parsed = JSON.parse(input.markingScheme);
      
      const normalized = {
        marks: parsed.marks || [],
        totalMarks: input.match?.marks || 0,
        questionNumber: input.match?.questionNumber || '1'
      };
      
      return normalized;
    } catch (error) {
      return null;
    }
  }
  
  // ========================= UNIFIED PIPELINE FORMAT =========================
  if (input.questionMarks && input.totalMarks !== undefined) {
    
    // Extract marks array from questionMarks.marks
    const marksArray = input.questionMarks.marks || [];
    
    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1'
    };
    
    
    return normalized;
  }
  
  // ========================= FALLBACK: MATCH OBJECT FORMAT =========================
  if (input.match?.markingScheme?.questionMarks) {
    console.log("  - match.marks:", input.match.marks);
    
    const normalized = {
      marks: Array.isArray(input.match.markingScheme.questionMarks) ? input.match.markingScheme.questionMarks : [],
      totalMarks: input.match.marks || 0,
      questionNumber: input.match.questionNumber || '1'
    };
    
    
    return normalized;
  }
  
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
      
      // Normalize the marking scheme data to a standard format
      const normalizedScheme = normalizeMarkingScheme(questionDetection);
      
      if (normalizedScheme) {
      } else {
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
      
      const enrichedAnnotations = annotationData.annotations.map(anno => {
        const aiStepId = (anno as any).step_id?.trim();
        if (!aiStepId) {
          console.warn(`[ENRICHMENT] AI annotation has missing step_id:`, anno);
          return null;
        }
        
        // Find matching step in cleanDataForMarking.steps
        const matchingStep = cleanDataForMarking.steps.find((step: any) => 
          step.unified_step_id?.trim() === aiStepId
        );
        
        if (matchingStep && matchingStep.bbox) {
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
    
    // Determine which prompt to use based on whether we have a meaningful marking scheme
    const hasMarkingScheme = normalizedScheme !== null && 
                            normalizedScheme !== undefined && 
                            normalizedScheme.marks.length > 0;
    
    if (normalizedScheme) {
    }
    
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
      } catch (error) {
        schemeJson = '{}';
      }
      
      // Get the total marks from the normalized scheme
      const totalMarks = normalizedScheme.totalMarks;
      
      // Convert JSON marking scheme to plain text bullets for the prompt
      const schemePlainText = formatMarkingSchemeAsBullets(schemeJson);
      
      userPrompt = prompt.user(formattedOcrText, schemePlainText, totalMarks);
      // ========================== END OF FIX ==========================
    } else {
      // Use the basic prompt
      const prompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = prompt.system;
      userPrompt = prompt.user(formattedOcrText);
    }
    
    // ========================== END: USE SINGLE PROMPT ==========================

    // Log what's being sent to AI for debugging
    console.log('📝 [AI PROMPT] OCR Text (first 200 chars):', formattedOcrText.substring(0, 200) + '...');
    if (hasMarkingScheme) {
      // Convert JSON marking scheme to plain text bullets for logging
      const schemePlainText = formatMarkingSchemeAsBullets(JSON.stringify({ marks: normalizedScheme.marks }, null, 2));
      console.log('📝 [AI PROMPT] Marking Scheme (plain text):');
      console.log(schemePlainText);
    } else {
      console.log('📝 [AI PROMPT] No marking scheme - using basic prompt');
    }

    let aiResponseString = ''; // Declare outside try block for error logging
    
    try {
      // Use the provided model parameter
      const { ModelProvider } = await import('../../utils/ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true);
      
      aiResponseString = res.content;
      const usageTokens = res.usageTokens;


      // Parse the AI response (Add robust parsing/cleanup)
      let jsonString = aiResponseString;
      const jsonMatch = aiResponseString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
           jsonString = jsonMatch[1];
      }

      const parsedResponse = JSON.parse(jsonString);

      // Log clean AI response
      console.log('🤖 [AI RESPONSE] Clean response received:');
      console.log('  - Annotations count:', parsedResponse.annotations?.length || 0);
      console.log('  - Student score:', parsedResponse.studentScore || 'None');
      console.log('  - Usage tokens:', usageTokens);

      // Return the correct MarkingInstructions structure
      const markingResult = {
          annotations: parsedResponse.annotations || [], // Default to empty array if missing
          studentScore: parsedResponse.studentScore || null,
          usageTokens
      };
      
      
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


