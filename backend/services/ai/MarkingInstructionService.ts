import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';

export class MarkingInstructionService {
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
    } else {
      systemPrompt += `
      You will be provided with the problem and a structured list of the student's solution steps. Your task is to apply specific marking annotations to each step based on mathematical correctness.

      **CRITICAL OUTPUT RULES:**

      Your entire response will be passed directly into a JSON parser.
      The parser will fail if there are ANY extraneous characters or formatting.
      Your response MUST begin with the character { and end with the character }.
      Do not include any explanation or introductory text.
      Return only the raw, valid JSON object.

      Output MUST strictly follow this format:

      {
        "annotations": [
          {
            "textMatch": "exact text from OCR that this annotation applies to",
            "step_id": "step_#", // REQUIRED: match to the provided steps by step_id
            "action": "tick|cross",
            "text": "M1|M1dep|A1|B1|C1|M0|A0|B0|C0|",
            "reasoning": "Brief explanation of why this annotation was chosen"
          }
        ],
        "studentScore": {
          "totalMarks": 6,
          "awardedMarks": 4,
          "scoreText": "4/6"
        }
      }

      ANNOTATION RULES:
      - Use "tick" for correct steps (including working steps and awarded marks like "M1", "A1").
      - Use "cross" for incorrect steps or calculations.
      - The "text" field can contain mark codes like "M1", "M1dep", "A1", "B1", "C1", "M0", "A0", "B0", "C0", or be empty.
      - "M0", "A0", etc. MUST be used with a "cross" action when a mark is not achieved due to an error.
      - CRITICAL: Both "tick" and "cross" actions can have text labels (mark codes) if applicable.
      - CRITICAL: If no specific mark code applies, leave the text field empty.
      - You MUST only create annotations for text found in the OCR TEXT. DO NOT hallucinate text that is not present.
      - You MUST include the correct step_id for each annotation by matching the text to the provided steps.

      SCORING RULES:
      - Calculate the total marks available for this question (sum of all mark codes like M1, A1, B1, etc.)
      - Calculate the awarded marks (sum of marks the student actually achieved)
      - Format the score as "awardedMarks/totalMarks" (e.g., "4/6")
      - If no marking scheme is available, estimate reasonable marks based on mathematical correctness`;
    }

    
    // Log prompts and response for production debugging
    console.log('🔍 [MARKING INSTRUCTION] User Prompt:');
    console.log(userPrompt);
    
    // Use the provided model parameter
    const { ModelProvider } = await import('./ModelProvider.js');
    const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true);
    
    const responseText = res.content;
    const usageTokens = res.usageTokens;
    
    // Log AI response
    console.log('🔍 [MARKING INSTRUCTION] AI Response:');
    console.log(responseText);

    try {
      const { JsonUtils } = await import('./JsonUtils');
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


