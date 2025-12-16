import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import { normalizeLatexDelimiters } from '../../utils/TextNormalizationUtils.js';

// ========================= NEW: IMMUTABLE PAGE INDEX ARCHITECTURE =========================
import {
  ImmutableAnnotation,
  GlobalPageIndex,
  RelativePageIndex,
  PageCoordinates
} from './PageIndexTypes.js';
import {
  RawAIAnnotation,
  OCRBlock,
  processAnnotations,
  toLegacyFormat,
  fromLegacyFormat
} from './AnnotationTransformers.js';
// ========================================================================================

// ========================= START: NORMALIZED DATA STRUCTURE =========================
interface NormalizedMarkingScheme {
  marks: any[];           // The marking scheme array
  totalMarks: number;     // Total marks for the question
  questionNumber: string; // Question identifier
  questionLevelAnswer?: string; // Question-level answer (e.g., "H", "F", "J" for letter-based answers)
  marksWithAnswers?: string[]; // Array of answers for each mark (for grouped sub-questions like Q12i, 12ii, 12iii)
  subQuestionNumbers?: string[]; // Array of sub-question numbers (e.g., ["22a", "22b"]) for grouped sub-questions
  subQuestionMarks?: { [subQuestionNumber: string]: any[] }; // Map sub-question number to its marks array (prevents mix-up of marks between sub-questions)
  subQuestionMaxScores?: { [subQuestion: string]: number }; // Max scores per sub-question from database (e.g., { "a": 1, "b": 2 })
  subQuestionAnswersMap?: { [subLabel: string]: string }; // Map sub-question label to its answer (e.g., "a" -> "53000")
  hasAlternatives?: boolean; // Flag indicating if alternative method exists
  alternativeMethod?: any; // Alternative method details
}

// ========================= START: NORMALIZATION FUNCTION =========================
function normalizeMarkingScheme(input: any): NormalizedMarkingScheme | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  // ========================= SINGLE IMAGE PIPELINE FORMAT =========================
  if (input.markingScheme && typeof input.markingScheme === 'string') {
    try {
      const parsed = JSON.parse(input.markingScheme);

      // Extract question-level answer if it exists
      const questionLevelAnswer = input.answer || input.match?.answer || parsed.answer || undefined;

      const normalized = {
        marks: parsed.marks || [],
        totalMarks: input.match?.marks || 0,
        questionNumber: input.match?.questionNumber || '1',
        questionLevelAnswer: questionLevelAnswer
      };

      return normalized;
    } catch (error) {
      return null;
    }
  }

  // ========================= UNIFIED PIPELINE FORMAT =========================
  if (input.questionMarks && input.totalMarks !== undefined) {

    // Handle alternative methods structure (e.g., {main: {...}, alt: {...}, hasAlternatives: true})
    let questionMarksData = input.questionMarks;
    let hasAlternatives = false;
    let alternativeMethod = null;

    if (questionMarksData.hasAlternatives && questionMarksData.main && questionMarksData.alt) {
      // Both main and alternative methods exist
      hasAlternatives = true;
      alternativeMethod = questionMarksData.alt; // Store alternative before overwriting
      questionMarksData = questionMarksData.main; // Use main as primary
    }

    // Extract marks array from questionMarks.marks
    const marksArray = questionMarksData.marks || [];

    // Extract question-level answer if it exists (for letter-based answers like "H", "F", "J")
    const questionLevelAnswer = input.answer || questionMarksData.answer || undefined;

    // Extract sub-question-specific answers for grouped sub-questions (e.g., Q12i="H", 12ii="F", 12iii="J")
    // Check multiple possible locations where sub-question answers might be stored
    let marksWithAnswers: string[] | undefined = undefined;
    const questionNumber = input.questionNumber || '?';

    if (input.subQuestionAnswers && Array.isArray(input.subQuestionAnswers) && input.subQuestionAnswers.length > 0) {
      // Filter out empty strings and ensure we have valid answers
      const validAnswers = input.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '' && a.toLowerCase() !== 'cao');
      if (validAnswers.length > 0) {
        marksWithAnswers = validAnswers;
      }
    } else if (questionMarksData?.subQuestionAnswers && Array.isArray(questionMarksData.subQuestionAnswers) && questionMarksData.subQuestionAnswers.length > 0) {
      const validAnswers = questionMarksData.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '' && a.toLowerCase() !== 'cao');
      if (validAnswers.length > 0) {
        marksWithAnswers = validAnswers;
      }
    }

    // Only log if no answers found (to reduce noise)
    if (!marksWithAnswers && (input.subQuestionAnswers || questionMarksData?.subQuestionAnswers)) {
      console.log(`[MARKING INSTRUCTION] Q${questionNumber}: No valid sub-question answers found (filtered out empty/cao values)`);
    }

    // Extract sub-question numbers if available (for grouped sub-questions)
    // Check multiple possible locations where sub-question numbers might be stored
    const subQuestionNumbers = input.subQuestionNumbers ||
      questionMarksData?.subQuestionNumbers ||
      (input as any).subQuestionNumbers ||
      undefined;

    // CRITICAL: Extract sub-question marks mapping if available (prevents mix-up of marks between sub-questions)
    // This preserves which marks belong to which sub-question (e.g., Q3a marks vs Q3b marks)
    const subQuestionMarks = questionMarksData?.subQuestionMarks ||
      (input as any).subQuestionMarks ||
      undefined;

    // Extract sub-question max scores from database (passed from orchestration)
    const subQuestionMaxScores = input.subQuestionMaxScores ||
      (input as any).subQuestionMaxScores ||
      undefined;

    // Extract sub-question answers map if available
    const subQuestionAnswersMap = questionMarksData?.subQuestionAnswersMap ||
      (input as any).subQuestionAnswersMap ||
      undefined;

    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer,
      marksWithAnswers: marksWithAnswers,
      subQuestionNumbers: subQuestionNumbers,
      subQuestionMarks: subQuestionMarks, // Preserve sub-question-to-marks mapping
      subQuestionMaxScores: subQuestionMaxScores, // Preserve max scores from database
      subQuestionAnswersMap: subQuestionAnswersMap, // Map sub-question label to its answer
      alternativeMethod: alternativeMethod, // Include alternative method if available
      hasAlternatives: hasAlternatives // Flag indicating if alternative exists
    };


    return normalized;
  }

  // ========================= UNIFIED PIPELINE FORMAT (duplicate check) =========================
  if (input.questionMarks && input.totalMarks !== undefined && !Array.isArray(input.questionMarks)) {
    // This is a duplicate path - already handled above, but keep for safety
    const questionLevelAnswer = input.answer || input.questionMarks.answer || undefined;

    const normalized = {
      marks: [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer
    };
    return normalized;
  }

  // ========================= FALLBACK: MATCH OBJECT FORMAT =========================
  if (input.match?.markingScheme?.questionMarks) {
    // Handle the new structure where marks are in questionMarks.marks
    let marksArray = [];
    if (input.match.markingScheme.questionMarks.marks) {
      marksArray = input.match.markingScheme.questionMarks.marks;
    } else if (Array.isArray(input.match.markingScheme.questionMarks)) {
      marksArray = input.match.markingScheme.questionMarks;
    }

    // Extract question-level answer if it exists
    const questionLevelAnswer = input.answer || input.match.answer || input.match.markingScheme.answer || undefined;

    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.match.marks || 0,
      questionNumber: input.match.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer
    };

    return normalized;
  }

  return null;
}
// ========================== END: NORMALIZATION FUNCTION ==========================

// Import the formatting function from prompts.ts
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';

export interface MarkingInputs {
  imageData?: string; // Primary image (for single-image questions)
  images?: string[]; // All page images (for multi-page context)
  model: ModelType;
  processedImage: ProcessedImageResult;
  questionDetection?: any;
  questionMarks?: any;
  totalMarks?: number;
  questionNumber?: string;
  questionText?: string | null; // Question text from fullExamPapers (source for question detection)
  generalMarkingGuidance?: any; // General marking guidance from the scheme
  allPagesOcrData?: any[]; // Array of OCR results for all pages (for multi-page context)
  sourceImageIndices?: number[]; // Array of global page indices for multi-page questions (e.g., [3, 4] for Pages 4-5)
  markingScheme?: any;  // NEW: Pass marking scheme (assuming MarkingSchemeContent is 'any' for now)
  extractedOcrText?: string; // NEW: Pass extracted OCR text for mapping
  tracker?: any; // UsageTracker (optional)
}

export class MarkingInstructionService {
  private static hasLoggedDebugPrompt = false;

  public static resetDebugLog() {
    MarkingInstructionService.hasLoggedDebugPrompt = false;
  }

  /**
   * Format general marking guidance into structured Markdown
   */
  private static formatGeneralMarkingGuidance(guidance: any): string {
    if (!guidance || typeof guidance !== 'object') {
      return '';
    }

    let formatted = '## GENERAL MARKING GUIDANCE\n';

    // 1. Precedence (High Priority)
    if (guidance.precedence) {
      formatted += `> [!IMPORTANT]\n> **Precedence:** ${guidance.precedence}\n\n`;
    }

    // 2. General Principles
    if (guidance.generalPrinciples && Array.isArray(guidance.generalPrinciples)) {
      formatted += '### General Principles\n';
      guidance.generalPrinciples.forEach((principle: string) => {
        formatted += `- ${principle}\n`;
      });
      formatted += '\n';
    }

    // 3. Marking Procedure
    if (guidance.markingProcedure && Array.isArray(guidance.markingProcedure)) {
      formatted += '### Marking Procedure\n';
      guidance.markingProcedure.forEach((item: string) => {
        formatted += `- ${item}\n`;
      });
      formatted += '\n';
    }

    // 4. Follow Through Marks
    if (guidance.followThroughMarks && Array.isArray(guidance.followThroughMarks)) {
      formatted += '### Follow Through Marks\n';
      guidance.followThroughMarks.forEach((item: string) => {
        formatted += `- ${item}\n`;
      });
      formatted += '\n';
    }

    // 5. Treatment of Answers
    if (guidance.treatmentOfAnswers && Array.isArray(guidance.treatmentOfAnswers)) {
      formatted += '### Treatment of Answers\n';
      guidance.treatmentOfAnswers.forEach((item: string) => {
        formatted += `- ${item}\n`;
      });
      formatted += '\n';
    }

    // 6. Abbreviations
    if (guidance.abbreviations && typeof guidance.abbreviations === 'object') {
      formatted += '### Abbreviations\n';
      Object.entries(guidance.abbreviations).forEach(([key, value]) => {
        formatted += `- **${key}**: ${value}\n`;
      });
      formatted += '\n';
    }

    return formatted;
  }

  /**
   * Execute complete marking flow - moved from LLMOrchestrator
   */
  static async executeMarking(inputs: MarkingInputs): Promise<MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string }> {
    const { imageData: _imageData, images, model, processedImage, questionDetection, questionText, questionNumber: inputQuestionNumber, sourceImageIndices, tracker } = inputs;

    // Debug log removed


    // OCR processing completed - all OCR cleanup now done in Stage 3 OCRPipeline

    try {
      // Get cleaned OCR data from OCRPipeline (now includes all OCR cleanup)
      let cleanDataForMarking = (processedImage as any).cleanDataForMarking;
      // ========================= START OF FIX =========================
      // Use the plain text OCR text that was passed in, not the JSON format from OCR service
      const cleanedOcrText = (processedImage as any).ocrText || (processedImage as any).cleanedOcrText;
      // ========================== END OF FIX ==========================
      const unifiedLookupTable = (processedImage as any).unifiedLookupTable;

      if (!cleanDataForMarking || !cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        // For pure drawing questions (like Q21 graph transformations), there may be no OCR text
        // Allow marking to proceed with empty steps - the AI will evaluate based on image only
        console.log('[MARKING INSTRUCTION] No OCR steps found - proceeding with image-only marking');
        cleanDataForMarking = { steps: [], rawOcrText: '' };
      }

      // Step 1: Generate raw annotations from cleaned OCR text
      // Normalize the marking scheme data to a standard format
      // CRITICAL: Ensure questionDetection only contains the current question's scheme
      // If it's an array or contains multiple schemes, extract only the one for this question
      let questionDetectionForNormalization = questionDetection;
      if (questionDetection && Array.isArray(questionDetection)) {
        // If it's an array, find the one matching the current question
        const currentQNum = inputQuestionNumber || 'Unknown';
        questionDetectionForNormalization = questionDetection.find((q: any) =>
          q.questionNumber === currentQNum ||
          String(q.questionNumber || '').replace(/[a-z]/i, '') === String(currentQNum).replace(/[a-z]/i, '')
        ) || questionDetection[0]; // Fallback to first if not found
      }

      // CRITICAL: Filter marks to only include current question's marks
      // If questionDetection contains marks from multiple questions, filter them
      const currentQNum = inputQuestionNumber || 'Unknown';
      const baseCurrentQNum = String(currentQNum).replace(/[a-z]/i, '');

      if (questionDetectionForNormalization &&
        questionDetectionForNormalization.questionMarks &&
        questionDetectionForNormalization.questionMarks.marks &&
        Array.isArray(questionDetectionForNormalization.questionMarks.marks)) {
        // Check if marks array contains marks from multiple questions
        // Filter to only include marks for the current question
        const originalMarks = questionDetectionForNormalization.questionMarks.marks;
        const filteredMarks = originalMarks.filter((mark: any) => {
          // If mark has a questionNumber field, use it to filter
          if (mark.questionNumber) {
            const markQNum = String(mark.questionNumber).replace(/[a-z]/i, '');
            return markQNum === baseCurrentQNum || mark.questionNumber === currentQNum;
          }
          // If no questionNumber field, assume all marks belong to the current question
          // (This handles the case where marks don't have questionNumber metadata)
          return true;
        });

        // Only filter if we found marks with questionNumber metadata and filtering changed the array
        if (originalMarks.some((m: any) => m.questionNumber) && filteredMarks.length !== originalMarks.length) {
          console.warn(`[MARKING INSTRUCTION] Q${currentQNum}: Filtered marks from ${originalMarks.length} to ${filteredMarks.length} (removed marks from other questions)`);
          questionDetectionForNormalization = {
            ...questionDetectionForNormalization,
            questionMarks: {
              ...questionDetectionForNormalization.questionMarks,
              marks: filteredMarks
            }
          };
        }
      }

      const normalizedScheme = normalizeMarkingScheme(questionDetectionForNormalization);

      // CRITICAL: Verify normalized scheme belongs to current question
      // If questionNumber doesn't match, the scheme is wrong and should be skipped
      if (normalizedScheme && normalizedScheme.questionNumber) {
        const schemeQNum = String(normalizedScheme.questionNumber).replace(/[a-z]/i, '');
        const currentQNumBase = String(currentQNum).replace(/[a-z]/i, '');

        // Check if question numbers match (base number or exact match)
        const questionNumbersMatch = schemeQNum === currentQNumBase ||
          normalizedScheme.questionNumber === currentQNum ||
          // For sub-questions, check if current question is a sub-question of the scheme's question
          (normalizedScheme.subQuestionNumbers &&
            normalizedScheme.subQuestionNumbers.includes(currentQNum));

        if (!questionNumbersMatch) {
          console.warn(`[MARKING INSTRUCTION] Q${currentQNum}: Normalized scheme question number (${normalizedScheme.questionNumber}) doesn't match current question. Skipping scheme.`);
          // Set normalizedScheme to null to skip marking scheme in prompt
          normalizedScheme.marks = [];
          normalizedScheme.totalMarks = 0;
        }
      }

      // Extract raw OCR blocks and classification for enhanced marking
      const rawOcrBlocks = (processedImage as any).rawOcrBlocks;
      const classificationStudentWork = (processedImage as any).classificationStudentWork;
      const classificationBlocks = (processedImage as any).classificationBlocks;
      const subQuestionMetadata = (processedImage as any).subQuestionMetadata;



      // Extract studentWorkLines from classificationBlocks (including sub-questions)
      let studentWorkLines: Array<{ text: string; position: { x: number; y: number; width: number; height: number } }> = [];
      if (classificationBlocks && classificationBlocks.length > 0) {
        classificationBlocks.forEach((block: any) => {
          // Add lines from main block
          if (block.studentWorkLines && Array.isArray(block.studentWorkLines)) {
            studentWorkLines = studentWorkLines.concat(block.studentWorkLines);
          }
          // Add lines from sub-questions
          if (block.subQuestions && Array.isArray(block.subQuestions)) {
            block.subQuestions.forEach((sq: any) => {
              if (sq.studentWorkLines && Array.isArray(sq.studentWorkLines)) {
                studentWorkLines = studentWorkLines.concat(sq.studentWorkLines);
              }
            });
          }
        });
      }

      // Build position map from studentWorkLines for fast lookup during enrichment
      const positionMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      if (studentWorkLines.length > 0) {
        studentWorkLines.forEach(line => {
          positionMap.set(line.text, line.position);
        });
      }


      const annotationData = await this.generateFromOCR(
        model,
        cleanedOcrText, // Use the plain text directly instead of JSON
        normalizedScheme, // Pass the normalized scheme instead of raw questionDetection
        questionDetection?.match, // Pass exam info for logging
        questionText, // Pass question text from fullExamPapers
        rawOcrBlocks, // Pass raw OCR blocks for enhanced marking
        classificationStudentWork, // Pass classification student work for enhanced marking
        inputQuestionNumber, // Pass question number (may include sub-question part)
        subQuestionMetadata, // Pass sub-question metadata for grouped sub-questions
        inputs.generalMarkingGuidance, // Pass general marking guidance
        _imageData, // Pass image data for edge cases where Drawing Classification failed
        images, // Pass array of images for multi-page questions
        positionMap, // Pass position map for line-to-position lookup
        sourceImageIndices, // Pass source image indices for multi-page context
        tracker  // Pass tracker for auto-recording
      );

      // Handle case where AI returns 0 annotations (e.g., no valid student work, wrong blocks assigned)
      if (!annotationData.annotations || !Array.isArray(annotationData.annotations)) {
        throw new Error('AI failed to generate valid annotations array');
      }


      if (annotationData.annotations.length === 0) {
        console.warn(`[MARKING INSTRUCTION] ⚠️ AI returned 0 annotations - likely no valid student work or wrong blocks assigned`);
        // Return empty annotations instead of throwing - allows pipeline to continue
        return {
          annotations: [],
          usage: { llmTokens: annotationData.usage?.llmTokens || 0 },
          cleanedOcrText: cleanedOcrText,
          studentScore: annotationData.studentScore || { totalMarks: 0, awardedMarks: 0, scoreText: '0/0' }
        };
      }

      // ========================= NEW: IMMUTABLE ANNOTATION PIPELINE =========================
      // Replace legacy mutable enrichment with type-safe immutable pipeline

      const rawAiAnnotations: RawAIAnnotation[] = annotationData.annotations.map((anno: any) => {
        return {
          text: anno.text,
          pageIndex: anno.pageIndex,
          subQuestion: anno.subQuestion,
          visual_position: anno.visual_position,
          step_id: anno.step_id,
          student_text: anno.student_text,
          classification_text: anno.classification_text,
          action: anno.action,
          reasoning: anno.reasoning,
          line_index: anno.line_index,
          ocr_match_status: anno.ocr_match_status // NEW: Preserve AI's match status
        };
      });

      // Use immutable annotation pipeline for page index safety
      const immutableAnnotations = MarkingInstructionService.processAnnotationsImmutable(
        rawAiAnnotations,
        sourceImageIndices || [0],
        rawOcrBlocks,
        studentWorkLines
      );

      // Convert back to plain objects (now preserves studentText, lineIndex, classificationText)
      const enrichedAnnotations = MarkingInstructionService.convertToLegacyFormat(immutableAnnotations);

      // ======================================================================================

      // 3. Stack overlapping visual annotations (Q11 fix)
      // Import the helper (assumes it's exported)
      const { applyVisualStacking } = await import('./AnnotationTransformers.js');
      const stackedAnnotations = applyVisualStacking(enrichedAnnotations);

      const result: MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = {
        annotations: stackedAnnotations, // ✅ Return stacked annotations
        usage: { llmTokens: annotationData.usage?.llmTokens || 0 },
        cleanedOcrText: cleanedOcrText,
        studentScore: annotationData.studentScore
      };

      return result;
    } catch (error) {
      console.error('❌ Marking flow failed:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      // Throw the real error instead of failing silently
      throw new Error(`Marking flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * NEW: Process annotations using immutable page index architecture
   * 
   * This is the new type-safe approach that prevents coordinate system confusion.
   * Returns ImmutableAnnotation[] which can be converted to legacy format if needed.
   *
   * @param aiAnnotations - Raw annotations from AI response
   * @param sourcePages - Global page indices for mapping
   * @param ocrBlocks - OCR blocks for bbox enrichment (optional)
   * @param studentWorkLines - Student work lines for drawing fallback (optional)
   * @returns Fully processed immutable annotations
   */
  static processAnnotationsImmutable(
    aiAnnotations: RawAIAnnotation[],
    sourcePages: readonly number[],
    ocrBlocks?: readonly OCRBlock[],
    studentWorkLines?: Array<{ text: string, position?: any }>
  ): readonly ImmutableAnnotation[] {
    // Convert numbers to branded GlobalPageIndex types
    const typedSourcePages = sourcePages.map(p => GlobalPageIndex.from(p));

    // Run immutable transformation pipeline
    const immutableAnnotations = processAnnotations(
      aiAnnotations,
      {
        sourcePages: typedSourcePages,
        ocrBlocks,
        studentWorkLines
      }
    );

    return immutableAnnotations;
  }

  /**
   * NEW: Helper to convert immutable annotations back to legacy format
   * Used for backward compatibility during migration
   */
  static convertToLegacyFormat(
    immutableAnnotations: readonly ImmutableAnnotation[]
  ): any[] {
    return immutableAnnotations.map(toLegacyFormat);
  }

  // Use shared normalization helper from TextNormalizationUtils

  /**
   * Formats the marking scheme into a concise text-based format for the AI prompt.
   * Handles both single questions and grouped sub-questions.
   * Format:
   * [Label] [MAX: X]
   * - Mark: Criteria
   */
  /*
   * Helper to replace "cao" with the actual answer value if available.
   * Performs a case-insensitive, whole-word replacement:
   * "A1: cao" -> "A1: 21"
   * "B1: cao (must be positive)" -> "B1: 21 (must be positive)"
   */
  private static replaceCaoWithAnswer(
    markText: string,
    normalizedScheme: NormalizedMarkingScheme,
    subKey?: string
  ): string {
    if (!markText) return '';

    // Regex for whole word "cao", case-insensitive
    const caoRegex = /\bcao\b/i;

    if (caoRegex.test(markText)) {
      let replacementAnswer: string | undefined;

      // 1. Try sub-question specific answer first
      if (subKey && normalizedScheme.subQuestionAnswersMap) {
        replacementAnswer = normalizedScheme.subQuestionAnswersMap[subKey];
      }

      // 2. Fallback to question-level answer
      if (!replacementAnswer && normalizedScheme.questionLevelAnswer) {
        replacementAnswer = normalizedScheme.questionLevelAnswer;
      }

      // 3. Perform replacement if we found an answer
      if (replacementAnswer) {
        return markText.replace(caoRegex, replacementAnswer);
      }
    }

    return markText;
  }

  /**
   * Mutates the normalizedScheme in-place to replace 'cao' with actual answers.
   * This ensures consistency between the prompt and the persisted marking logic.
   */
  private static replaceCaoInScheme(normalizedScheme: NormalizedMarkingScheme): void {
    // 1. Handle Sub-Questions
    if (normalizedScheme.subQuestionMarks) {
      Object.keys(normalizedScheme.subQuestionMarks).forEach(subQ => {
        // subQ is "11a", subLabel is "a"
        const subLabel = subQ.replace(/^\d+/, '');
        const marks = normalizedScheme.subQuestionMarks![subQ];
        marks.forEach((m: any) => {
          if (m.answer) {
            m.answer = this.replaceCaoWithAnswer(m.answer, normalizedScheme, subLabel);
          }
        });
      });
    }

    // 2. Handle Main Question Marks (if logic exists or fallback)
    if (normalizedScheme.marks) {
      normalizedScheme.marks.forEach((m: any) => {
        if (m.answer) {
          // Try to find sub-key from mark label if possible, or just default
          // For a single question, subLabel is undefined
          m.answer = this.replaceCaoWithAnswer(m.answer, normalizedScheme);
        }
      });
    }
  }

  private static formatMarkingSchemeForPrompt(normalizedScheme: NormalizedMarkingScheme): string {
    let output = '';

    // Check if we have sub-questions
    const hasSubQuestions = normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0;

    if (hasSubQuestions) {
      // Grouped Sub-Questions
      const subQuestions = Object.keys(normalizedScheme.subQuestionMarks!).sort();

      for (const subQ of subQuestions) {
        const marks = normalizedScheme.subQuestionMarks![subQ];
        // Extract max score from subQuestionMaxScores map if available
        // subQ is like "11a", we need "a"
        const subLabel = subQ.replace(/^\d+/, '');
        const maxScore = normalizedScheme.subQuestionMaxScores ? normalizedScheme.subQuestionMaxScores[subLabel] : undefined;

        output += `[${subQ}]`;
        if (maxScore !== undefined) {
          output += ` [MAX SCORE: ${maxScore}]`;
        }
        output += '\n';

        marks.forEach((m: any) => {
          // m.answer is already replaced by replaceCaoInScheme if called before
          // But we call replaceCaoWithAnswer again just in case (it's idempotent)
          let answer = m.answer;
          // answer = this.replaceCaoWithAnswer(answer, normalizedScheme, subLabel);

          output += `- ${m.mark}: ${answer}`;
          if (m.comments) output += ` (${m.comments})`;
          output += '\n';
        });
        output += '\n';
      }
    } else {
      // Single Question
      if (normalizedScheme.totalMarks) {
        output += `[MAX SCORE: ${normalizedScheme.totalMarks}]\n`;
      }

      normalizedScheme.marks.forEach((m: any) => {
        let markText = m.answer;

        // FIX: Replace "cao" with actual answer if available
        markText = this.replaceCaoWithAnswer(markText, normalizedScheme, m.subQuestion);

        output += `- ${m.mark}: ${markText}`;
        if (m.comments) output += ` (${m.comments})`;
        output += '\n';
      });
    }

    // Append Question Level Answer if available
    if (normalizedScheme.questionLevelAnswer) {
      output += `\nFINAL ANSWER: ${normalizedScheme.questionLevelAnswer}\n`;
    }

    return output.trim();
  }

  static async generateFromOCR(
    model: ModelType,
    ocrText: string,
    normalizedScheme?: NormalizedMarkingScheme | null,
    examInfo?: any,
    questionText?: string | null,
    rawOcrBlocks?: Array<{ id: string; text: string; pageIndex: number; coordinates?: { x: number; y: number } }>,
    classificationStudentWork?: string | null,
    inputQuestionNumber?: string,
    subQuestionMetadata?: { hasSubQuestions: boolean; subQuestions: Array<{ part: string; text?: string }>; subQuestionNumbers?: string[] },
    generalMarkingGuidance?: any,
    imageData?: string, // Image data for edge cases where Drawing Classification failed
    images?: string[], // Array of images for multi-page questions
    positionMap?: Map<string, { x: number; y: number; width: number; height: number }>, // NEW: Position map for drawing fallback
    sourceImageIndices?: number[], // NEW: Source image indices for drawing fallback
    tracker?: any // NEW: UsageTracker for tracking LLM tokens
  ): Promise<MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; markingScheme?: any; schemeTextForPrompt?: string }> {
    // Parse and format OCR text if it's JSON
    let formattedOcrText = ocrText;
    try {
      // Try to parse as JSON first (legacy format)
      const parsed = JSON.parse(ocrText);
      if (Array.isArray(parsed)) {
        formattedOcrText = parsed.map((block: any) => {
          const text = block.text || '';
          const page = block.pageIndex !== undefined ? `[Page ${block.pageIndex}] ` : '';
          return `${page}${text}`;
        }).join('\n');
      } else if (parsed.blocks) {
        formattedOcrText = parsed.blocks.map((block: any) => {
          const text = block.text || '';
          const page = block.pageIndex !== undefined ? `[Page ${block.pageIndex}] ` : '';
          return `${page}${text}`;
        }).join('\n');
      } else if (parsed.question && parsed.steps) {
        // Legacy format support
        formattedOcrText = `Question: ${parsed.question}\n\nStudent's Work:\n${parsed.steps.map((step: any, index: number) => {
          const normalizedText = normalizeLatexDelimiters(step.cleanedText || step.text || '');
          const simplifiedStepId = `step_${index + 1}`;
          return `${index + 1}. [${simplifiedStepId}] ${normalizedText}`;
        }).join('\n')}`;
      }
    } catch (error) {
      // If parsing fails, normalize the original text
      formattedOcrText = normalizeLatexDelimiters(ocrText);
    }

    // Initialize schemeText at higher scope for return
    let schemeText: string | undefined;

    // Use the centralized prompt from prompts.ts
    const { AI_PROMPTS } = await import('../../config/prompts.js');

    // Extract general marking guidance
    const formattedGeneralGuidance = this.formatGeneralMarkingGuidance(generalMarkingGuidance);

    // Determine which prompt to use based on whether we have a meaningful marking scheme
    let hasMarkingScheme = normalizedScheme !== null &&
      normalizedScheme !== undefined &&
      normalizedScheme.marks.length > 0;

    let systemPrompt: string;
    let userPrompt: string;

    if (hasMarkingScheme && normalizedScheme) {
      // Use the withMarkingScheme prompt
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = prompt.system;

      // Format marking scheme for the prompt using normalized data
      // CRITICAL: Verify this scheme belongs to the current question before passing to AI
      const schemeQuestionNumber = normalizedScheme.questionNumber;
      const currentQuestionNumber = inputQuestionNumber || normalizedScheme.questionNumber || 'Unknown';
      const baseSchemeQNum = String(schemeQuestionNumber || '').replace(/[a-z]/i, '');
      const baseCurrentQNum = String(currentQuestionNumber || '').replace(/[a-z]/i, '');

      // Only use this scheme if it matches the current question
      if (baseSchemeQNum === baseCurrentQNum || schemeQuestionNumber === currentQuestionNumber) {

        // FIX: Mutate the scheme to replace 'cao' with actual answers
        // This ensures the prompt sees meaningful values AND the returned 'markingScheme' object
        // (which is persisted to DB) also has the fixed values.
        this.replaceCaoInScheme(normalizedScheme);

        try {
          schemeText = this.formatMarkingSchemeForPrompt(normalizedScheme);
        } catch (error) {
          schemeText = 'Error formatting marking scheme';
          console.error('[MARKING INSTRUCTION] Error formatting marking scheme:', error);
        }

        userPrompt = AI_PROMPTS.markingInstructions.withMarkingScheme.user(
          inputQuestionNumber || 'Unknown',
          schemeText || '',
          formattedOcrText,
          classificationStudentWork || 'No student work provided',
          formattedGeneralGuidance,
          rawOcrBlocks,
          questionText
        );
      } else {
        // Scheme doesn't match current question - don't pass it to AI
        console.warn(`[MARKING INSTRUCTION] Q${currentQuestionNumber}: Marking scheme question number (${schemeQuestionNumber}) doesn't match current question. Skipping scheme.`);

        // Fallback to no marking scheme prompt
        const fallbackPrompt = AI_PROMPTS.markingInstructions.basic;
        systemPrompt = fallbackPrompt.system;
        userPrompt = fallbackPrompt.user(
          formattedOcrText,
          classificationStudentWork || 'No student work provided'
        );
      }
    } else {
      // No marking scheme
      const prompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = prompt.system;
      userPrompt = prompt.user(
        formattedOcrText,
        classificationStudentWork || 'No student work provided'
      );
    }

    // ========================== END: USE SINGLE PROMPT ==========================

    // Extract question number for logging (prefer input questionNumber which may include sub-question part)
    const questionNumber = inputQuestionNumber || normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';

    // Check if this is a drawing question AND has multiple pages
    // We only want to debug full prompts for complex multi-page drawing scenarios
    const isDrawingQuestion = ((classificationStudentWork && classificationStudentWork.includes('[DRAWING]')) ||
      (formattedOcrText && formattedOcrText.includes('[DRAWING]'))) &&
      (images && images.length >= 2);

    // DEBUG LOG: Show full prompt for multi-page drawing questions OR one random question
    // We use a small probability (5%) to pick a "candidate" to be the one logged,
    // but once we log one, we set a flag to prevent others.
    // Multi-page drawing questions are ALWAYS logged.
    // TEMPORARILY DISABLED: AI prompt logging (too verbose)
    const shouldLogPrompt = false; // Disabled AI prompt logging

    if (shouldLogPrompt) {
      if (!isDrawingQuestion && String(questionNumber) !== '1') {
        MarkingInstructionService.hasLoggedDebugPrompt = true;
      }
      const BLUE = '\x1b[34m';
      const BOLD = '\x1b[1m';
      const RESET = '\x1b[0m';
      console.log(`\n${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
      console.log(`${BOLD}${BLUE}[AI MARKING PROMPT] Q${questionNumber}${RESET}`);
      console.log(`${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

      // System prompt logging removed as requested

      console.log(`${BOLD}USER PROMPT:${RESET}`);
      console.log(userPrompt);

      console.log(`\n${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
    }

    // Log only content sections by extracting them from the actual userPrompt (no duplicate logic)
    const GREEN = '\x1b[32m';
    const RED = '\x1b[31m';
    const MAGENTA = '\x1b[35m';
    const YELLOW = '\x1b[33m';
    const CYAN = '\x1b[36m';
    const RESET = '\x1b[0m';

    // TEMPORARILY DISABLED: Detailed prompt logging
    // console.log('');
    // console.log(`${RED}📝 [AI PROMPT] Q${questionNumber}${RESET}`);

    // Extract content sections from the actual userPrompt (reuse the real prompt, just extract content)
    if (userPrompt) {
      // 1. Extract Question Text
      const questionTextMatch = userPrompt.match(/Question:\s*\n([\s\S]*?)(?=\n\n|Total Marks|$)/);
      if (questionTextMatch && questionTextMatch[1]) {
        // console.log(`${MAGENTA}Question Text:${RESET}`);
        // console.log(MAGENTA + questionTextMatch[1].trim() + RESET);
      }

      // 2. Extract Classification Student Work
      const classificationMatch = userPrompt.match(/STUDENT WORK \(STRUCTURED\):\s*\n([\s\S]*?)(?=\n\n|RAW OCR BLOCKS|$)/);
      if (classificationMatch && classificationMatch[1]) {
        // console.log(`${YELLOW}Classification Student Work:${RESET}`);
        // console.log(YELLOW + classificationMatch[1].trim() + RESET);
      }

      // 3. Extract OCR Blocks
      // const ocrBlocksMatch = userPrompt.match(/RAW OCR BLOCKS \(For Reference\):\s*\n([\s\S]*?)(?=\n\n|INSTRUCTIONS|$)/);
      // if (ocrBlocksMatch && ocrBlocksMatch[1]) {
      //   console.log(`${CYAN}OCR Blocks:${RESET}`);
      //   console.log(CYAN + ocrBlocksMatch[1].trim() + RESET);
      // }

      // 4. Extract Marking Scheme
      // const markingSchemeMatch = userPrompt.match(/MARKING SCHEME:\s*\n([\s\S]*?)(?=\n\n|SUB-QUESTION|$)/);
      // if (markingSchemeMatch && markingSchemeMatch[1]) {
      //   console.log(`${GREEN}Marking Scheme:${RESET}`);
      //   console.log(GREEN + markingSchemeMatch[1].trim() + RESET);
      // }
    }

    let aiResponseString = ''; // Declare outside try block for error logging

    try {
      // Use the provided model parameter
      const { ModelProvider } = await import('../../utils/ModelProvider.js');

      // Edge case: Use vision API when imageData is present (Drawing Classification returned 0)
      let res;
      if (imageData && imageData.trim() !== '') {
        // Determine which model provider to use
        const isOpenAI = model && model.toString().startsWith('openai-');

        if (isOpenAI) {
          let openaiModel = model.toString().replace('openai-', '');
          const visionResult = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData, openaiModel, true, tracker, 'marking');
          res = { content: visionResult.content, usageTokens: visionResult.usageTokens };
        } else {
          // Use Gemini Vision
          // Use images array if available, otherwise fallback to single imageData
          const imageInput = (images && images.length > 0) ? images : imageData;
          const visionResult = await ModelProvider.callGeminiChat(systemPrompt, userPrompt, imageInput, model, tracker, 'marking');
          res = { content: visionResult.content, usageTokens: visionResult.usageTokens };
        }
      } else {
        res = await ModelProvider.callText(systemPrompt, userPrompt, model, true, tracker, 'marking');
      }

      aiResponseString = res.content;
      const usageTokens = res.usageTokens;

      // Parse the AI response (Add robust parsing/cleanup)
      let jsonString = aiResponseString;
      const jsonMatch = aiResponseString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1];
      }

      // DEBUG LOG: AI Response for questions with UNMATCHED annotations only
      try {
        const parsedResponse = JSON.parse(jsonString);

        // =========================================================================================
        // STRICT MARK LIMIT ENFORCEMENT (Ref: Step 1779)
        // Prevent AI from awarding more marks than available in the scheme (e.g. 7 marks for Q14 when max is 4)
        // =========================================================================================
        if (normalizedScheme) { // Use normalizedScheme argument
          try {
            // normalizedScheme is likely already parsed and normalized
            let marksList: any[] = [];
            if (normalizedScheme.marks && Array.isArray(normalizedScheme.marks)) {
              marksList = normalizedScheme.marks;
            }

            if (marksList.length > 0) {
              // 1. Build Limit Map (e.g. { "P1": 3, "A1": 1 })
              const limitMap = new Map<string, number>();
              marksList.forEach((m: any) => {
                const code = (m.mark || '').trim();
                if (code) {
                  limitMap.set(code, (limitMap.get(code) || 0) + 1);
                }
              });

              // 2. Filter Annotations
              if (parsedResponse.annotations && Array.isArray(parsedResponse.annotations)) {
                const validAnnotations: any[] = [];
                const usageMap = new Map<string, number>();

                parsedResponse.annotations.forEach((anno: any) => {
                  const rawText = (anno.text || '').trim();
                  // Extract code (e.g. "P1" from "P1") or "M1" from "M1: Correct method"
                  const code = rawText.split(/[^a-zA-Z0-9]/)[0];

                  if (limitMap.has(code)) {
                    const currentUsage = usageMap.get(code) || 0;
                    const limit = limitMap.get(code)!;

                    if (currentUsage < limit) {
                      validAnnotations.push(anno);
                      usageMap.set(code, currentUsage + 1);
                    } else {
                      console.warn(`⚠️ [MARK LIMIT] Dropped excess annotation '${rawText}' for Q${inputQuestionNumber || '?'} (Limit for ${code} is ${limit})`);
                    }
                  } else {
                    // Allow unknown codes if they don't clash, but warn
                    if (limitMap.size > 0) {
                      // Opt to KEEP unknown marks for now to avoid false negatives on valid but hallucinated codes?
                      // No, if user wants STRICT adherence, we should arguably Warn/Drop. 
                      // But Q6 "B1" is usually valid.
                      // Let's keep it but log warning.
                      validAnnotations.push(anno);
                    } else {
                      validAnnotations.push(anno);
                    }
                  }
                });

                // Update annotations
                parsedResponse.annotations = validAnnotations;
              }
            }
          } catch (e) {
            console.error('Error enforcing mark limits:', e);
          }
        }
        // =========================================================================================

        // Only log if there are UNMATCHED annotations
        const hasUnmatched = parsedResponse.annotations && parsedResponse.annotations.some((anno: any) =>
          anno.ocr_match_status === 'UNMATCHED'
        );
        const hasVisual = parsedResponse.annotations && parsedResponse.annotations.some((anno: any) =>
          anno.ocr_match_status === 'VISUAL'
        );

        // Log mostly for non-standard cases (User request: disable STANDARD logs)
        // TEMPORARY: Force log Q2 for debugging


      } catch (e) {
        // Ignore parsing errors here, main flow handles it
      }

      // Sanitize JSON string to handle unescaped characters
      // The AI may return single backslashes in LaTeX that need to be escaped for JSON
      let parsedResponse;
      try {
        parsedResponse = JSON.parse(jsonString);
      } catch (error) {
        // If parsing fails, fix common JSON issues
        let fixedJson = jsonString;

        // Fix 1: Missing closing brace before comma (e.g., "reasoning": "...",\n,\n{)
        // Pattern: field value followed by newline, comma, newline, opening brace
        // Should be: field value, closing brace, comma, newline, opening brace
        // Handle various indentation levels and values that may contain escaped quotes
        fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
          // Preserve the indentation of the comma line
          const indentMatch = match.match(/\n(\s*),\s*\n/);
          const indent = indentMatch ? indentMatch[1] : '    ';
          // Value is already properly escaped in JSON, use as-is
          return `"${field}": "${value}"\n${indent}},\n${indent}{`;
        });

        // Fix 2: Unescaped backslashes in string values
        // Replace single backslashes that aren't followed by valid escape characters
        // Valid escapes: \", \\, \n, \r, \t, \b, \f, \uXXXX
        fixedJson = fixedJson.replace(/\\(?![\\"/nrtbfu])/g, '\\\\');

        try {
          parsedResponse = JSON.parse(fixedJson);
        } catch (secondError) {
          // Fix 3: More aggressive backslash escaping
          fixedJson = jsonString.replace(/\\/g, '\\\\');
          // But then un-escape the ones that should stay as single (like \n, \", etc.)
          fixedJson = fixedJson.replace(/\\\\n/g, '\\n');
          fixedJson = fixedJson.replace(/\\\\"/g, '\\"');
          fixedJson = fixedJson.replace(/\\\\r/g, '\\r');
          fixedJson = fixedJson.replace(/\\\\t/g, '\\t');
          fixedJson = fixedJson.replace(/\\\\b/g, '\\b');
          fixedJson = fixedJson.replace(/\\\\f/g, '\\f');

          // Fix 4: Missing closing brace before comma (retry after backslash fixes)
          fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
            // Preserve the indentation of the comma line
            const indentMatch = match.match(/\n(\s*),\s*\n/);
            const indent = indentMatch ? indentMatch[1] : '    ';
            // Value is already properly escaped in JSON, use as-is
            return `"${field}": "${value}"\n${indent}},\n${indent}{`;
          });

          try {
            parsedResponse = JSON.parse(fixedJson);
          } catch (thirdError) {
            console.error("❌ JSON parsing failed after fix attempts. Error:", thirdError);
            console.error("❌ Problematic JSON section (first 500 chars):", fixedJson.substring(0, 500));
            throw thirdError;
          }
        }
      }

      // Extract question number for logging
      const questionNumber = normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';

      // Log clean AI response with better formatting
      const GREEN = '\x1b[32m';
      const RED = '\x1b[31m';
      const CYAN = '\x1b[36m';
      const RESET = '\x1b[0m';



      // Validate and clean response structure
      if (parsedResponse && parsedResponse.annotations && Array.isArray(parsedResponse.annotations)) {
        // 1. Deduplicate mark codes within each annotation (Refined)
        parsedResponse.annotations = parsedResponse.annotations.map((anno: any) => {
          // Sanitize "null" strings from AI
          if (anno.action === 'null') anno.action = '';
          if (anno.text === 'null') anno.text = '';
          if (anno.subQuestion === 'null') anno.subQuestion = null;

          if (anno.text && typeof anno.text === 'string') {
            const codes = anno.text.trim().split(/\s+/);
            // Only deduplicate codes that end in '0' (e.g. "P0", "A0")
            // Preserve additive marks like "P1 P1" or "M1 A1"
            const processedCodes: string[] = [];
            const seenZeroCodes = new Set<string>();

            codes.forEach(code => {
              if (code.endsWith('0')) {
                if (!seenZeroCodes.has(code)) {
                  seenZeroCodes.add(code);
                  processedCodes.push(code);
                }
              } else {
                processedCodes.push(code);
              }
            });

            const newText = processedCodes.join(' ');
            if (newText !== anno.text.trim()) {
              // Log removed
              anno.text = newText;
            }
          }
          return anno;
        });

        // 2. Merge redundant annotations for the same step (Q8 Stability)
        const mergedAnnotations: any[] = [];
        const seenSteps = new Map<string, any>();

        parsedResponse.annotations.forEach((anno: any) => {
          const key = `${anno.step_id}_${anno.action}`;
          if (seenSteps.has(key)) {
            const existing = seenSteps.get(key);
            // Merge text (mark codes)
            const existingCodes = existing.text ? existing.text.trim().split(/\s+/) : [];
            const newCodes = anno.text ? anno.text.trim().split(/\s+/) : [];

            // Combine codes, respecting the refined deduplication logic
            const allCodes = [...existingCodes, ...newCodes];
            const processedCodes: string[] = [];
            const seenZeroCodes = new Set<string>();

            allCodes.forEach(code => {
              if (code.endsWith('0')) {
                if (!seenZeroCodes.has(code)) {
                  seenZeroCodes.add(code);
                  processedCodes.push(code);
                }
              } else {
                processedCodes.push(code);
              }
            });

            const combinedCodes = processedCodes.join(' ');

            if (existing.text !== combinedCodes) {
              // Log removed
              existing.text = combinedCodes;
            }
            // Append reasoning if different
            if (anno.reasoning && !existing.reasoning.includes(anno.reasoning)) {
              existing.reasoning += ` | ${anno.reasoning}`;
            }

            // FIX: Also update pageIndex and visual_position if the new annotation has them
            // This is crucial for Q11b where the second annotation might have the correct pageIndex (drawing page)
            if ((anno as any).pageIndex !== undefined) {
              (existing as any).pageIndex = (anno as any).pageIndex;
            }
            if ((anno as any).visual_position) {
              (existing as any).visual_position = (anno as any).visual_position;
            }
          } else {
            seenSteps.set(key, anno);
            mergedAnnotations.push(anno);
          }
        });
        parsedResponse.annotations = mergedAnnotations;

        // 3. Filter out phantom drawing annotations (Q16 Fix) - REMOVED
        // This filter was too aggressive and removed valid drawing annotations that didn't have explicit mark codes.
        // We now trust the AI's output for drawings.
        /*
        parsedResponse.annotations = parsedResponse.annotations.filter((anno: any) => {
          const isDrawing = anno.step_id && anno.step_id.includes('drawing');
          const hasNoCode = !anno.text || anno.text.trim() === '';
          const isTick = anno.action === 'tick';
     
          if (isDrawing && hasNoCode && isTick) {
            // Log removed
            return false;
          }
          return true;
        });
        */
      }

      // console.log(`🤖 [AI RESPONSE] ${RED}Q${questionNumber}${RESET} - Clean response received:`);
      // console.log('  - Annotations count:', '\x1b[35m' + (parsedResponse.annotations?.length || 0) + '\x1b[0m'); // Magenta color
      // console.log('  - Student score:', '\x1b[32m' + (parsedResponse.studentScore?.scoreText || 'None') + '\x1b[0m'); // Green color
      // console.log('  - Usage tokens:', '\x1b[33m' + usageTokens + '\x1b[0m'); // Yellow color

      // Log visual observation if present (diagnostic for drawing questions)
      // Log visual observation if present (diagnostic for drawing questions)
      if (parsedResponse.visualObservation && parsedResponse.visualObservation.trim()) {
        // console.log(`  ${CYAN}📋 [VISUAL OBSERVATION]${RESET}`);
        // console.log(`     ${CYAN}${parsedResponse.visualObservation}${RESET}`);
      }

      // Log individual annotations for debugging (especially for answers like 18.6)
      // Log individual annotations for debugging (especially for answers like 18.6)
      if (parsedResponse.annotations && parsedResponse.annotations.length > 0) {
        // console.log('  - Annotations:');
        parsedResponse.annotations.forEach((ann: any, idx: number) => {
          const action = ann.action || 'unknown';
          const text = ann.text || '';
          const stepId = ann.step_id || 'MISSING';
          const reasoning = ann.reasoning || '';
          const actionColor = action === 'tick' ? '\x1b[32m' : action === 'cross' ? '\x1b[31m' : '\x1b[0m';
          const blueColor = '\x1b[34m';
          const resetColor = '\x1b[0m';
          const MAGENTA = '\x1b[35m';

          // Find student answer from step_id
          let studentAnswer = ann.student_text || '';

          // Priority 1: Use student_text from annotation if available
          if (studentAnswer) {
            // Already set
          }
          // Priority 2: Try to find by step_id in rawOcrBlocks
          else if (rawOcrBlocks && rawOcrBlocks.length > 0) {
            const block = rawOcrBlocks.find(b => b.id === stepId);
            if (block) {
              studentAnswer = block.text;
            }
          }

          // Priority 3: If still not found, try textMatch as fallback
          if (!studentAnswer && ann.textMatch) {
            studentAnswer = ann.textMatch;
          }

          // Truncate for display
          let displayAnswer = studentAnswer;
          if (displayAnswer.length > 80) {
            displayAnswer = displayAnswer.substring(0, 80) + '...';
          }

          const studentAnswerDisplay = displayAnswer ? `${blueColor}"${displayAnswer}"${resetColor}` : '""';

          // Enhanced logging for incorrect answers
          let logMessage = `    ${idx + 1}. ${actionColor}${action}${resetColor} ${text ? `[${text}]` : ''} ${studentAnswerDisplay}`;

          // Always show detailed debug info
          logMessage += `\n      ↳ Reason: ${reasoning || 'No reasoning provided'}`;

          // console.log(logMessage);
          // console.log(`      ↳ Reason: ${reasoning}`);
          // console.log(`      ↳ OCR Value: "${ann.student_text || ''}"`);
          // if (ann.classification_text) console.log(`      ↳ Classification Value: "${ann.classification_text}"`);
          // console.log(`      ↳ Match Status: "${ann.ocr_match_status || 'UNKNOWN'}"`);

          if (studentAnswer) {
            logMessage += `\n      ↳ OCR Value: ${MAGENTA}"${studentAnswer}"${RESET}`;

            if (ann.classification_text) {
              logMessage += `\n      ↳ Classification Value: ${MAGENTA}"${ann.classification_text}"${RESET}`;
            }
          }

          if (ann.ocr_match_status) {
            const statusColor = ann.ocr_match_status === 'FALLBACK' ? RED : GREEN;
            logMessage += `\n      ↳ Match Status: ${statusColor}"${ann.ocr_match_status}"${RESET}`;
          }

          // console.log(logMessage);
        });
        // Log step_id summary
        const stepIds = parsedResponse.annotations.map((a: any) => a.step_id || 'MISSING');
        const missingCount = stepIds.filter((id: string) => id === 'MISSING').length;
        if (missingCount > 0) {
          console.log(`  ⚠️ ${missingCount}/${parsedResponse.annotations.length} annotations missing step_id`);
        }
      } else {
        console.log('  ⚠️ No annotations in parsed response');
      }

      // DRAWING BOX RESIZE: Fix oversized drawing boxes after deduplication
      if (parsedResponse.annotations && parsedResponse.annotations.length > 0) {
        // Count unique sub-questions and create ordered list
        const uniqueSubQuestions = new Set(
          parsedResponse.annotations
            .map((a: any) => a.subQuestion)
            .filter((sq: any) => sq)
        );
        const subQuestionCount = uniqueSubQuestions.size || 1;
        const sortedSubQuestions = Array.from(uniqueSubQuestions).sort();

        // Check each annotation for oversized drawing boxes
        parsedResponse.annotations.forEach((anno: any) => {
          if (anno.ocr_match_status === 'VISUAL' && anno.visual_position) {
            const w = parseFloat(anno.visual_position.width) || 0;
            const h = parseFloat(anno.visual_position.height) || 0;

            if (w >= 80 || h >= 80) {
              const subQ = anno.subQuestion || '';
              console.warn(`⚠️ [FULL-PAGE DRAWING] Q${inputQuestionNumber}${subQ}: ${w}×${h}%`);

              // Resize: divide 70% by sub-question count (reduced from 85% for smaller boxes)
              const newSize = 70 / subQuestionCount;
              anno.visual_position.width = newSize;
              anno.visual_position.height = newSize;

              // Reposition: adjust Y based on sub-question index
              // BUT ONLY if sub-questions are on the SAME page

              if (subQuestionCount > 1 && subQ) {
                // Check if ALL sub-questions (including MATCHED text like Q3a) are on the same page
                // This ensures we don't incorrectly stack Q3b when Q3a is on a different page
                const allSubQuestionsAnnos = parsedResponse.annotations.filter((a: any) =>
                  a.subQuestion && sortedSubQuestions.includes(a.subQuestion)
                );
                const pages = new Set(allSubQuestionsAnnos.map((a: any) => a.pageIndex));
                const samePage = pages.size === 1;



                const subQIndex = sortedSubQuestions.indexOf(subQ);
                if (subQIndex !== -1) {
                  // Calculate Y position: evenly distribute across page
                  // NOTE: SVG uses Y as the CENTER of the box, not the top edge
                  const spacing = 70 / subQuestionCount;

                  // If on different pages, treat each as index 0 (top position)
                  const effectiveIndex = samePage ? subQIndex : 0;
                  const topEdgeY = 15 + (effectiveIndex * spacing);
                  const newY = topEdgeY + (newSize / 2); // Add half height to get center
                  anno.visual_position.y = newY;

                  const positionNote = samePage ? 'stacked' : 'separate pages, positioned as top';
                }
              }
            }
          }
        });
      }

      // Return the correct MarkingInstructions structure
      return {
        annotations: parsedResponse.annotations,
        studentScore: parsedResponse.studentScore,
        usage: {
          llmTokens: usageTokens
        },
        cleanedOcrText: formattedOcrText,
        markingScheme: normalizedScheme, // Pass normalized scheme so executor can use it
        schemeTextForPrompt: schemeText // Pass the exact scheme text used in prompt
      };

    } catch (error) {
      console.error("❌ Error calling AI for marking instructions or parsing response:", error);
      // Log the raw response string if parsing failed
      if (error instanceof SyntaxError) {
        console.error("❌ RAW AI RESPONSE STRING that failed to parse:", aiResponseString);
      }
      throw new Error(`AI marking instruction generation failed: ${error instanceof Error ? error.message : 'Unknown AI error'}`);
    }
  }
}
