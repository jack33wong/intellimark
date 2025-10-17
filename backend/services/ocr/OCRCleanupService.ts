import type { ModelType } from '../../types/index.js';
// Ensure this dependency is installed: npm install string-similarity
import { compareTwoStrings } from 'string-similarity';

/**
 * Helper function to normalize text for robust comparison (Whitelist approach).
 */
const normalizeText = (text: string): string => {
  if (!text) return "";
  
  let normalized = text;

  // 1. Strip LaTeX delimiters
  normalized = normalized.replace(/\\\(|\\\)|\\\[|\\\]|\\\$|\$/g, "");

  // 2. Handle specific LaTeX symbols/commands
  normalized = normalized.replace(/\\text\{(.*?)\}/g, "$1");
  normalized = normalized.replace(/\\circ|\^\{\\circ\}|\\degree|°/g, "");

  // 3. Strip common LaTeX math commands
  normalized = normalized.replace(/\\(frac|times|pi|sqrt)\b/g, "");
  
  // 4. Remove remaining LaTeX syntax elements
  normalized = normalized.replace(/[\{\}\^_\\]/g, "");

  // 5. Final Normalization: Keep only alphanumeric characters and convert to lowercase.
  normalized = normalized.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  
  return normalized;
};

/**
 * Helper function to preprocess the extracted question text (Remove prefixes).
 * CRITICAL FIX: Removes the word "Question" but retains the question number for alignment.
 */
const preprocessQuestionText = (text: string): string => {
    if (!text) return "";
    
    // Remove the word "Question" or "Q" followed by optional space at the start of the string.
    // Case-insensitive matching.
    // This changes "Question 4. The diagram..." to "4. The diagram..."
    let processed = text.replace(/^\s*(Question|Q)[\s]*/i, '').trim();

    // We intentionally DO NOT remove the leading number (e.g., "4.")
    // as the OCR output (Mathpix) also typically includes this number.
    
    return processed;
}


export class OCRCleanupService {
  
  /**
   * Deterministically segments OCR text by identifying the boundary between the question and student work.
   * This function operates on the raw Mathpix lineData structure.
   * 
   * @param rawLineData - The raw line_data array from the Mathpix response.
   * @param extractedQuestionText - The known question text from the Classification stage.
   * @returns The index in rawLineData where the student work begins (the first block AFTER the question ends).
   */
  static async findStudentWorkBoundary(
    rawLineData: Array<any>,
    extractedQuestionText?: string
  ): Promise<number> {
    
    // 1. Prepare the question text
    const preprocessedQuestion = preprocessQuestionText(extractedQuestionText || "");
    const normalizedQuestion = normalizeText(preprocessedQuestion);
    
    let accumulatedOcrText = "";
    let boundaryIndex = -1; // Index of the last block containing the question

    const MIN_LENGTH_THRESHOLD = 20;
    // A threshold of 90% is robust now that alignment is fixed and architecture is correct.
    const SIMILARITY_THRESHOLD = 0.90; 

    // 2. Identify the boundary using fuzzy matching.
    if (normalizedQuestion.length > MIN_LENGTH_THRESHOLD) {
        for (let i = 0; i < rawLineData.length; i++) {
          // Extract text from the raw lineData structure
          const lineText = rawLineData[i].latex_styled || rawLineData[i].text || '';
          const blockText = normalizeText(lineText);
          
          accumulatedOcrText += blockText;

          // Calculate the similarity
          // We compare the question against a substring of the OCR text slightly longer than the question itself.
          const relevantOcrSubstring = accumulatedOcrText.substring(0, normalizedQuestion.length + 100); // Add buffer
          
          const similarity = compareTwoStrings(normalizedQuestion, relevantOcrSubstring);

          if (similarity >= SIMILARITY_THRESHOLD) {
            boundaryIndex = i;
            console.log(`✅ [OCR CLEANUP] Fuzzy match successful (Similarity: ${(similarity * 100).toFixed(2)}%). Boundary at index ${boundaryIndex}.`);
            break;
          }
        }
    }

    // 3. Determine the starting index of the student work.
    if (boundaryIndex !== -1) {
      // Student work starts after the block where the question ended.
      return boundaryIndex + 1;
    } else {
      // Fallback behavior
      if (normalizedQuestion.length > MIN_LENGTH_THRESHOLD) {
        console.warn("⚠️ [OCR CLEANUP] Could not find question text boundary (fuzzy match failed). Treating all content as student work.");
        // Diagnostic Logging (optional)
      }
      return 0; // Start from the beginning
    }
  }


  // DEPRECATED METHODS (Stubs remain)

  /**
   * @deprecated Use findStudentWorkBoundary and structure data in OCRService instead.
   */
  static async deterministicCleanupAndAssignSteps(
    boundingBoxes: Array<any>,
    extractedQuestionText?: string
  ): Promise<{ cleanedText: string; usageTokens: number }> {
     throw new Error("deterministicCleanupAndAssignSteps is deprecated. The architecture has changed to segment before post-processing.");
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