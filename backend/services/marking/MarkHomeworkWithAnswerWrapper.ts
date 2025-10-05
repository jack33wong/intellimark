/**
 * MarkHomeworkWithAnswer Wrapper
 * Non-breaking: provides a unified interface that can use either old or new progress system
 */

import { MarkHomeworkWithAnswer } from './MarkHomeworkWithAnswer.js';
import { MarkHomeworkWithAnswerAuto } from './MarkHomeworkWithAnswerAuto.js';
import type { MarkHomeworkResponse, ModelType } from '../../types/index.js';

export interface MarkHomeworkOptions {
  imageData: string;
  model?: ModelType;
  onProgress?: (data: any) => void;
  debug?: boolean;
  useAutoProgress?: boolean; // New option to enable auto-progress
  userId?: string;
  userEmail?: string;
  aiMessageId?: string;
}

/**
 * Unified MarkHomework service that can use either old or new progress system
 * Non-breaking: maintains exact same interface as original
 */
export class MarkHomeworkWithAnswerWrapper {
  /**
   * Main run method - automatically chooses between old and new progress system
   */
  public static async run(options: MarkHomeworkOptions): Promise<MarkHomeworkResponse> {
    const { useAutoProgress = false, ...restOptions } = options;

    if (useAutoProgress) {
      // Use new auto-progress system
      return MarkHomeworkWithAnswerAuto.run(restOptions);
    } else {
      // Use original system (backward compatibility) - add required fields
      const originalOptions = {
        ...restOptions,
        model: restOptions.model || 'gemini-2.5-pro' as ModelType,
        userId: 'anonymous',
        userEmail: 'anonymous@example.com'
      };
      return MarkHomeworkWithAnswer.run(originalOptions);
    }
  }

  /**
   * Get hybrid OCR result (delegates to original)
   */
  public static async getHybridOCRResult(imageData: string, options?: any, debug: boolean = false): Promise<any> {
    return MarkHomeworkWithAnswer.getHybridOCRResult(imageData, options, debug);
  }
}

// Export both for direct access if needed
export { MarkHomeworkWithAnswer } from './MarkHomeworkWithAnswer.js';
export { MarkHomeworkWithAnswerAuto } from './MarkHomeworkWithAnswerAuto.js';
