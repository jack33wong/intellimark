import type { ModelType } from '../../types/index';

export class MarkingInstructionService {
  static async generateFromOCR(
    model: ModelType,
    ocrText: string,
    questionDetection?: any
  ): Promise<{ annotations: string }> {
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
            "action": "tick|cross|comment",
            "text": "M1|M0|A1|A0|B1|B0|C1|C0|comment text",
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

      MARKING CRITERIA:
      - The provided 'MARKING SCHEME CONTEXT' is the definitive source for mark allocation.
      - Your task is to award marks based on a one-to-one mapping between the student's work and the specific criteria in the mark scheme.
      - Award marks in the sequence they appear in the mark scheme (e.g., first M1, then M1dep, then A1).
      - If the student's work satisfies a mark's criteria, award it with a "comment" and the appropriate mark in the "text" field.
      - If a student's work shows an incorrect attempt at a specific mark (e.g., an incorrect calculation for "c" which prevents the M1dep mark), use a "cross" action and set the "text" to the corresponding mark with a "0" (e.g., M0, A0) to explicitly state the mark was not achieved.
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
      Your task is to:
      1. Read and understand the question and answer from ocr text
      2. Generate appropriate marking annotations for different parts of the work
      3. Provide reasoning for each annotation decision

      CRITICAL OUTPUT RULES:
      - Return ONLY raw JSON, no markdown formatting, no code blocks, no explanations
      - Output MUST strictly follow this format:

      {
        "annotations": [
          {
            "textMatch": "exact text from OCR that this annotation applies to",
            "action": "tick|cross|comment",
            "text": "comment text",
            "reasoning": "Brief explanation of why this annotation was chosen"
          }
        ]
      }

      ANNOTATION RULES:
      - Use "tick" for correct, minor steps that do not correspond to a specific mark.
      - Use "cross" for incorrect steps or calculations.
      - Use "comment" to comment.
      - You MUST only create annotations for text found in the OCR TEXT. DO NOT hallucinate text that is not present.

      `;
    }

    console.log('🔍 SYSTEM PROMPT:', systemPrompt);
    console.log('🔍 USER PROMPT:', userPrompt);
    
    // Force model to gemini for consistency
    const actualModel = 'gemini-2.5-pro';
    let response: string;
    
    if (actualModel === 'gemini-2.5-pro') {
      const { ModelProvider } = await import('./ModelProvider');
      response = await ModelProvider.callGeminiText(systemPrompt, userPrompt);
    } else {
      const { ModelProvider } = await import('./ModelProvider');
      response = await ModelProvider.callOpenAIText(systemPrompt, userPrompt, actualModel as any);
    }

    try {
      const { JsonUtils } = await import('./JsonUtils');
      JsonUtils.cleanAndValidateJSON(response, 'annotations');
      return { annotations: response }; // Return raw response for LLM3
    } catch (error) {
      console.error('❌ LLM2 JSON parsing failed:', error);
      throw new Error(`LLM2 failed to generate valid marking annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}


