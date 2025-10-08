import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';

export class MarkingInstructionService {
  static async generateFromOCR(
    model: ModelType,
    ocrText: string,
    questionDetection?: any
  ): Promise<{ annotations: string; usageTokens: number }> {
    let systemPrompt = getPrompt('markingInstructions.basic.system');
    let userPrompt = getPrompt('markingInstructions.basic.user', ocrText);
    
    if (questionDetection?.match?.markingScheme) {
      systemPrompt = getPrompt('markingInstructions.withMarkingScheme.system');

      // Add question detection context if available
      const ms = questionDetection.match.markingScheme.questionMarks as any;
      const schemeJson = JSON.stringify(ms, null, 2)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
      userPrompt = getPrompt('markingInstructions.withMarkingScheme.user', ocrText, schemeJson);
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
        ]
      }

      ANNOTATION RULES:
      - Use "tick" for correct steps (including working steps and awarded marks like "M1", "A1").
      - Use "cross" for incorrect steps or calculations.
      - The "text" field can contain mark codes like "M1", "M1dep", "A1", "B1", "C1", "M0", "A0", "B0", "C0", or be empty.
      - "M0", "A0", etc. MUST be used with a "cross" action when a mark is not achieved due to an error.
      - CRITICAL: Both "tick" and "cross" actions can have text labels (mark codes) if applicable.
      - CRITICAL: If no specific mark code applies, leave the text field empty.
      - You MUST only create annotations for text found in the OCR TEXT. DO NOT hallucinate text that is not present.
      - You MUST include the correct step_id for each annotation by matching the text to the provided steps.`;
    }

    
    // Log prompts and response for production debugging
    
    // Use the provided model parameter
    const { ModelProvider } = await import('./ModelProvider.js');
    const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, model, true);
    
    const responseText = res.content;
    const usageTokens = res.usageTokens;

    try {
      const { JsonUtils } = await import('./JsonUtils');
      const parsed = JsonUtils.cleanAndValidateJSON(responseText, 'annotations');
      return { annotations: parsed.annotations || [], usageTokens };
    } catch (error) {
      console.error('❌ LLM2 JSON parsing failed:', error);
      console.error('❌ Raw response that failed to parse:', responseText);
      throw new Error(`LLM2 failed to generate valid marking annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


