import type { ModelType } from '../../types/index.js';
// We no longer need LLM dependencies (getPrompt, ModelProvider) or string-similarity for this service.

// Import MathBlock type definition (ensure path is correct)
import type { MathBlock } from './MathDetectionService.js'; 

// Define the enhanced type used internally
interface EnhancedMathBlock extends MathBlock {
    isHandwritten?: boolean;
}

export class OCRCleanupService {
  
  /**
   * Segments OCR text using a deterministic algorithm based on the injected handwriting signals.
   * Implements the "Switching Heuristic" for robust segmentation of mixed content.
   * 
   * @param mathBlocks - The array of EnhancedMathBlock objects (post-processed and signal-injected).
   * @param extractedQuestionText - (Not used in this deterministic approach, but kept for interface consistency).
   * @param model - (Not used).
   * @returns A Set containing the indices of mathBlocks that belong to the student's work.
   */
  static async findStudentWorkBoundary(
    mathBlocks: Array<EnhancedMathBlock>,
    extractedQuestionText: string | undefined,
    model: ModelType = 'auto'
  ): Promise<Set<number>> {
    

    const studentWorkIndices = new Set<number>();
    let hasSwitchedToStudentWork = false;

    for (let i = 0; i < mathBlocks.length; i++) {
        const block = mathBlocks[i];
        const text = block.mathpixLatex || block.googleVisionText || '';

        // Skip empty blocks for segmentation logic, but include them if context is already StudentWork.
        if (text.trim().length === 0) {
            if (hasSwitchedToStudentWork) {
                studentWorkIndices.add(i);
            }
            continue;
        }

        // Determine the classification based on the Switching Heuristic
        if (hasSwitchedToStudentWork) {
            // Once switched, all subsequent blocks are StudentWork.
            studentWorkIndices.add(i);
        } else {
            // Check the objective signal (injected by OCRService using Google Vision correlation)
            if (block.isHandwritten === true) {
                // This is the first definitive handwriting block. Switch the context.
                hasSwitchedToStudentWork = true;
                studentWorkIndices.add(i);
            } else {
                // Block is Print (isHandwritten: false or undefined) and context has not switched.
                // Classified as Question (by exclusion).
            }
        }
    }
    
    // Fallback: If no switch occurred (e.g., fully printed submission or GV failure), 
    // we conservatively treat everything as potential student work to avoid data loss.
    if (!hasSwitchedToStudentWork && mathBlocks.length > 0) {
        // This check specifically addresses the scenario where NO handwriting was detected at all.
        if (studentWorkIndices.size === 0) {
           console.warn('⚠️ [OCR CLEANUP] No handwriting transition detected. Falling back to treating all content as student work.');
           return new Set(mathBlocks.map((_, index) => index));
        }
    }

    return studentWorkIndices;
  }


  // DEPRECATED METHODS (Stubs remain as previously defined)

  /**
   * @deprecated
   */
  static async deterministicCleanupAndAssignSteps(
    boundingBoxes: Array<any>,
    extractedQuestionText?: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
     throw new Error("deterministicCleanupAndAssignSteps is deprecated.");
  }

  /**
   * @deprecated
   */
  static async assignStepIds(
    model: ModelType,
    ocrText: string,
    boundingBoxes: Array<any>
  ): Promise<{ originalWithStepIds: string }> {
    throw new Error("assignStepIds is deprecated.");
  }

  /**
   * @deprecated
   */
  static async cleanOCRTextWithStepIds(
    model: ModelType,
    originalWithStepIds: string,
    extractedQuestionText?: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
     throw new Error("cleanOCRTextWithStepIds is deprecated.");
  }

  /**
   * @deprecated
   */
  static async cleanOCRText(
    model: ModelType,
    ocrText: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
    return { cleanedText: ocrText, usageTokens: 0 };
  }
}