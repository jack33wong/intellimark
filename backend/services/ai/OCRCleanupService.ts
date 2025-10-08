import type { ModelType } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';

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
    const steps = boundingBoxes.map((bbox, index) => {
      return {
        unified_step_id: `step_${index + 1}`,
        text: bbox.text || '',
        bbox: [bbox.x, bbox.y, bbox.width, bbox.height]
      };
    });
    
    // Return the step data as JSON string for the next step
    return { originalWithStepIds: JSON.stringify({ steps }) };
  }

  /**
   * Clean up OCR text while preserving step_id references
   */
  static async cleanOCRTextWithStepIds(
    model: ModelType,
    originalWithStepIds: string,
    extractedQuestionText?: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
    const systemPrompt = getPrompt('ocrCleanup.withStepIds.system');

    const userPrompt = getPrompt('ocrCleanup.withStepIds.user', originalWithStepIds, extractedQuestionText);

    let responseText: string;
    let usageTokens = 0;
    model = 'auto';
    if (model === 'auto') {
      const { ModelProvider } = await import('./ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto', true); // ✅ Force JSON response
      responseText = res.content;
      usageTokens = res.usageTokens;
    } else {
      const { ModelProvider } = await import('./ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'gemini-2.5-pro', true); // ✅ Force JSON response
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
    const systemPrompt = getPrompt('ocrCleanup.simple.system');
    const userPrompt = getPrompt('ocrCleanup.simple.user', ocrText);

    
    let responseText: string;
    let usageTokens = 0;
    
    if (model === 'auto') {
      const { ModelProvider } = await import('./ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'auto');
      responseText = res.content;
      usageTokens = res.usageTokens;
    } else {
      const { ModelProvider } = await import('./ModelProvider.js');
      const res = await ModelProvider.callGeminiText(systemPrompt, userPrompt, 'gemini-2.5-pro');
      responseText = res.content;
      usageTokens = res.usageTokens;
    }

    return { cleanedText: responseText, usageTokens };
  }
}
