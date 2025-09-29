import type { ModelType } from '../../types/index.js';

export class OCRCleanupService {
  /**
   * Assign step_id to original OCR text based on bounding boxes
   * Simple programmatic assignment - no LLM needed
   */
  static async assignStepIds(
    model: ModelType,
    ocrText: string,
    boundingBoxes: Array<{ x: number; y: number; width: number; height: number; text: string; confidence?: number }>
  ): Promise<{ originalWithStepIds: string }> {
    // Generate unified step IDs that directly contain bbox mapping
    const steps = boundingBoxes.map((bbox, index) => ({
      unified_step_id: `step_${index + 1}`,
      text: bbox.text,
      bbox: [bbox.x, bbox.y, bbox.width, bbox.height]
    }));
    
    // Return the step data as JSON string for the next step
    return { originalWithStepIds: JSON.stringify({ steps }) };
  }

  /**
   * Clean up OCR text while preserving step_id references
   */
  static async cleanOCRTextWithStepIds(
    model: ModelType,
    originalWithStepIds: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
    const systemPrompt = `Analyze the provided OCR text of a math problem solution. Clean up the text by removing repeated lines, scribbles, and irrelevant content while preserving the mathematical structure.

    Your task is to:
    1. Identify the main mathematical steps and equations
    2. Remove repeated lines, scribbles, and irrelevant text
    3. Structure the output in a logical, readable format
    4. Preserve mathematical notation and LaTeX formatting
    5. Keep the original question text
    7. CRITICAL: For individual steps, PRESERVE the original bbox coordinates exactly as given
    8. CRITICAL: When merging multiple steps, create a NEW unified_step_id using decimal notation (e.g., step_2.5 for merging step_2+step_3)
    9. CRITICAL: When merging steps, calculate UNION of their bbox coordinates (min_x, min_y, max_x+width, max_y+height)
    10. CRITICAL: When merging steps, concatenate their original_text with spaces
    11. CRITICAL: Always provide both original_text (from input) and cleaned_text (improved version)

    Return ONLY a valid JSON object with this exact format. Ensure all strings are properly escaped and all brackets are closed:
    {
        "question": "The original question",
        "steps": [
            {
                "unified_step_id": "step_1",
                "bbox": [100, 200, 150, 30],
                "original_text": "x=;0.2+0.4=0.6m2",
                "cleaned_text": "x = 0.2 + 0.4 = 0.6"
            },
        ]
    }
    
    IMPORTANT: 
    - Return ONLY the JSON object, no explanations or additional text
    - Ensure all strings are properly escaped (use \\\\ for backslashes in LaTeX)
    - Make sure all brackets { } and [ ] are properly closed
    - All unified_step_id values must be strings
    - All bbox arrays must have exactly 4 numbers`;

    const userPrompt = `Here is the OCR text to clean (JSON with steps including unified_step_id and bbox coordinates):

    ${originalWithStepIds}

    Please provide the cleaned, structured version.`;

    let responseText: string;
    let usageTokens = 0;
    model = 'auto';
    if (model === 'auto') {
      const { ModelProvider } = await import('./ModelProvider');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto');
      responseText = res.content;
      usageTokens = res.usageTokens;
    } else {
      const { ModelProvider } = await import('./ModelProvider');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'gemini-2.5-pro');
      responseText = res.content;
      usageTokens = res.usageTokens;
    }

    return { cleanedText: responseText, usageTokens };
  }

  /**
   * Clean up OCR text by extracting key steps and removing extraneous content
   */
  static async cleanOCRText(
    model: ModelType,
    ocrText: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
    const systemPrompt = `Analyze the provided OCR text of a math problem solution. Identify and extract the key steps of the solution and the original question. Structure the output as a clean, logical list of mathematical equations and key values. Ignore extraneous text, scribbles, or repeated lines from the OCR.

    Your task is to:
    1. Identify the main mathematical steps and equations
    2. Extract key values and variables
    3. Remove repeated lines, scribbles, and irrelevant text
    4. Structure the output in a logical, readable format
    5. Preserve mathematical notation, LaTeX formatting and the original question
    6. Assign a unique step_id to each step for tracking purposes

    Format:
    {
        "question": "The original question",
        "steps": [
            {
                "step_id": "step_1",
                "text": "l=0.6"
            },
            {
                "step_id": "step_2", 
                "text": "KE_A + PE_A + EE_A = KE_B + PE_B + EE_B"
            }
        ]
    }

    Return ONLY the cleaned text, no explanations or additional formatting.`;

    const userPrompt = `Here is the OCR text to clean:

    ${ocrText}

    Please provide the cleaned, structured version:`;

    
    let responseText: string;
    let usageTokens = 0;
    
    if (model === 'auto') {
      const { ModelProvider } = await import('./ModelProvider');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto');
      responseText = res.content;
      usageTokens = res.usageTokens;
    } else {
      const { ModelProvider } = await import('./ModelProvider');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'gemini-2.5-pro');
      responseText = res.content;
      usageTokens = res.usageTokens;
    }

    return { cleanedText: responseText, usageTokens };
  }
}
