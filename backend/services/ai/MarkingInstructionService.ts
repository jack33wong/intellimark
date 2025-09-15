import type { ModelType } from '../../types/index';

export class MarkingInstructionService {
  static async generateFromOCR(
    model: ModelType,
    ocrText: string,
    questionDetection?: any
  ): Promise<{ annotations: string; usageTokens: number }> {
    let systemPrompt = `You are an AI assistant that generates marking annotations for student work.`;
    let userPrompt = `Here is the OCR TEXT:

    ${ocrText}
    
    Please analyze this work and generate appropriate marking annotations. Focus on mathematical correctness, method accuracy, and provide specific text matches for each annotation.`;
    
    if (questionDetection?.match?.markingScheme) {
      systemPrompt += `
      Your task is to:
      1. Analyze the student's work from the OCR text
      2. Generate appropriate marking annotations for different parts of the work
      3. Provide reasoning for each annotation decision

      CRITICAL OUTPUT RULES:
      - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
      - Output MUST strictly follow this format:

      {
        "annotations": [
          {
            "textMatch": "exact text from OCR that this annotation applies to",
            "step_id": "step_#", // REQUIRED when steps with step_id are provided in OCR text
            "action": "tick|cross|comment",
            "text": "M1|M1dep|A1|B1|C1|M0|A0|B0|C0|comment text",
            "reasoning": "Brief explanation of why this annotation was chosen"
          }
        ]
      }

      ANNOTATION RULES:
      - Use "tick" for correct, minor steps that do not correspond to a specific mark.
      - Use "cross" for incorrect steps or calculations.
      - Use "comment" to award marks (e.g., "M1", "A1").
      - The "text" field MUST be one of the following: "M1", "M1dep", "A1", "B1", "C1", "M0", "A0", "B0", "C0", or a brief "comment text".
      - "M0", "A0", etc. MUST be used with a "cross" action when a mark is not achieved due to an error.
      - When the OCR TEXT includes structured steps with step_id, you MUST include the corresponding step_id for each annotation by matching the text.
      - You MUST only create annotations for text found in the OCR TEXT. DO NOT hallucinate text that is not present.

      EXAMPLES:
      - For "|v| = 28/5 = 5.6ms^-1" you might create:
        * A "tick" for correct absolute value notation
        * A "tick" for correct calculation
        * A "comment" for "M1" if method is correct
        * Another "comment" for "A1" if answer is correct
      Return ONLY the JSON object.`;

      // Add question detection context if available
      const ms = questionDetection.match.markingScheme.questionMarks as any;
      const schemeJson = JSON.stringify(ms, null, 2)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
      userPrompt += `\n\nMARKING SCHEME CONTEXT:\n"""${schemeJson}"""`;
    } else {
      systemPrompt += `
      You will be provided with the problem and a structured list of the student's solution steps. Your task is to apply specific marking annotations to each step based on mathematical correctness.

      CRITICAL OUTPUT RULES:
      - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
      - Output MUST strictly follow this format:

      {
        "annotations": [
          {
            "textMatch": "exact text from OCR that this annotation applies to",
            "step_id": "step_#", // REQUIRED: match to the provided steps by step_id
            "action": "tick|cross|comment",
            "text": "comment text",
            "reasoning": "Brief explanation of why this annotation was chosen"
          }
        ]
      }

      ANNOTATION RULES:
      -Use "tick" for correct steps.
      -Use "cross" for mathematically incorrect steps.
      -Use "comment" for minor errors (e.g., spelling mistakes, poor notation) that do not invalidate the overall method.
      -Your reasoning must be specific and directly related to the correctness of the step.
      - You MUST only create annotations for text found in the OCR TEXT. DO NOT hallucinate text that is not present.
      - You MUST include the correct step_id for each annotation by matching the text to the provided steps.`;
    }

    
    // Force model to gemini for consistency
    const actualModel = 'gemini-2.5-pro';
    let responseText: string;
    let usageTokens = 0;
    
    if (actualModel === 'gemini-2.5-pro') {
      const { ModelProvider } = await import('./ModelProvider');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt);
      responseText = res.content;
      usageTokens = res.usageTokens;
    } else {
      const { ModelProvider } = await import('./ModelProvider');
      const res = await ModelProvider.callOpenAIText(systemPrompt, userPrompt, actualModel as any);
      responseText = res.content;
      usageTokens = res.usageTokens;
    }

    try {
      const { JsonUtils } = await import('./JsonUtils');
      JsonUtils.cleanAndValidateJSON(responseText, 'annotations');
      return { annotations: responseText, usageTokens }; // Return raw response for LLM3
    } catch (error) {
      console.error('❌ LLM2 JSON parsing failed:', error);
      throw new Error(`LLM2 failed to generate valid marking annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


