import type { ModelType } from '../../types/index';

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
    // Simply assign step_ids sequentially to each bounding box
    const steps = boundingBoxes.map((bbox, index) => ({
      step_id: `step_${index + 1}`,
      text: bbox.text,
      bbox_index: index
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
  ): Promise<{ cleanedText: string }> {
    const systemPrompt = `Analyze the provided OCR text of a math problem solution. Clean up the text by removing repeated lines, scribbles, and irrelevant content while preserving the mathematical structure.

    Your task is to:
    1. Identify the main mathematical steps and equations
    2. Remove repeated lines, scribbles, and irrelevant text
    3. Structure the output in a logical, readable format
    4. Preserve mathematical notation and LaTeX formatting
    5. Keep the original question text
    6. CRITICAL: PRESERVE step_id VALUES EXACTLY AS GIVEN and DO NOT RENUMBER OR REASSIGN THEM
    7. CRITICAL: INCLUDE the original bbox_index for each step and DO NOT REORDER steps. Keep the same sequence as input.

    Return ONLY a JSON object with this exact format:
    {
        "question": "The original question",
        "steps": [
            {
                "step_id": "step_1",
                "bbox_index": 0,
                "text": "l=0.6"
            },
            {
                "step_id": "step_2+3", 
                "bbox_index": 1,
                "text": "\\Rightarrow V^{2}= \\frac{784}{25}"
            }
        ]
    }`;

    const userPrompt = `Here is the OCR text to clean (JSON with steps including step_id and bbox_index):

    ${originalWithStepIds}

    Please provide the cleaned, structured version while preserving step_id and bbox_index exactly, and without reordering.`;

    let response: string;
    
    if (model === 'gemini-2.5-pro') {
      const { ModelProvider } = await import('./ModelProvider');
      response = await ModelProvider.callGeminiText(systemPrompt, userPrompt);
    } else {
      const { ModelProvider } = await import('./ModelProvider');
      response = await ModelProvider.callOpenAIText(systemPrompt, userPrompt, model as any);
    }

    return { cleanedText: response };
  }

  /**
   * Clean up OCR text by extracting key steps and removing extraneous content
   */
  static async cleanOCRText(
    model: ModelType,
    ocrText: string
  ): Promise<{ cleanedText: string }> {
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

    console.log('🧹 ===== OCR CLEANUP SERVICE =====');
    console.log('🔍 SYSTEM PROMPT:', systemPrompt);
    console.log('🔍 USER PROMPT:', userPrompt);
    
    let response: string;
    
    if (model === 'gemini-2.5-pro') {
      const { ModelProvider } = await import('./ModelProvider');
      response = await ModelProvider.callGeminiText(systemPrompt, userPrompt);
    } else {
      const { ModelProvider } = await import('./ModelProvider');
      response = await ModelProvider.callOpenAIText(systemPrompt, userPrompt, model as any);
    }

    console.log('✅ OCR Cleanup Response:', response);
    return { cleanedText: response };
  }
}
