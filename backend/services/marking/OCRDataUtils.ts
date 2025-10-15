export interface ParsedOCRData {
  question: string;
  steps: Array<{
    unified_step_id: string;
    bbox: number[];
    cleanedText: string;
  }>;
}

export interface OCRDataForMarking {
  question: string;
  steps: Array<{
    unified_step_id: string;
    bbox: number[];
    cleanedText: string;
  }>;
}

export interface OCRDataForAI {
  questionText: string;
  stepTexts: string[];
  combinedText: string;
}

export class OCRDataUtils {
  /**
   * Parse OCR cleanup data and extract structured information
   */
  static parseOCRCleanupData(cleanedOcrText: string): ParsedOCRData {
    try {
      if (!cleanedOcrText || cleanedOcrText.trim() === '') {
        throw new Error('OCR cleanup returned empty text');
      }

      const cleanedData = JSON.parse(cleanedOcrText);
      
      if (!cleanedData.steps || !Array.isArray(cleanedData.steps) || cleanedData.steps.length === 0) {
        console.error('❌ [OCR PARSE] No steps found in cleaned data!');
        console.error('❌ [OCR PARSE] Full cleaned data structure:', JSON.stringify(cleanedData, null, 2));
        throw new Error('OCR cleanup failed to extract any steps');
      }

      return {
        question: cleanedData.question || '',
        steps: cleanedData.steps.map((step: any) => ({
          unified_step_id: step.unified_step_id || '',
          bbox: step.bbox || [],
          cleanedText: step.cleanedText || ''
        }))
      };
    } catch (error) {
      console.error('❌ [OCR PARSE] Failed to parse OCR cleanup data:', error);
      console.error('❌ [OCR PARSE] Raw text that failed to parse:', cleanedOcrText?.substring(0, 500));
      throw new Error(`OCR data parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract data formatted for marking instructions
   */
  static extractDataForMarking(cleanedOcrText: string): OCRDataForMarking {
    const parsedData = this.parseOCRCleanupData(cleanedOcrText);
    
    return {
      question: parsedData.question || "Unknown question",
      steps: parsedData.steps.map(step => ({
        unified_step_id: step.unified_step_id,
        bbox: step.bbox,
        cleanedText: step.cleanedText
      }))
    };
  }

  /**
   * Extract data formatted for AI response generation
   */
  static extractDataForAI(cleanedOcrText: string): OCRDataForAI {
    const parsedData = this.parseOCRCleanupData(cleanedOcrText);
    
    // Extract question text
    const questionText = parsedData.question && parsedData.question.trim() 
      ? `Question: "${parsedData.question.trim()}"\n\n` 
      : '';
    
    // Extract cleaned step texts
    const stepTexts = parsedData.steps
      .filter(step => step.cleanedText && step.cleanedText.trim())
      .map(step => step.cleanedText.trim());
    
    // Combine question and steps
    const combinedText = questionText + stepTexts.join('\n');
    
    return {
      questionText,
      stepTexts,
      combinedText
    };
  }
}

