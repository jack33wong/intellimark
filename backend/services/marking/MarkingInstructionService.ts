import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import { normalizeLatexDelimiters } from '../../utils/TextNormalizationUtils.js';

// ========================= START: NORMALIZED DATA STRUCTURE =========================
interface NormalizedMarkingScheme {
  marks: any[];           // The marking scheme array
  totalMarks: number;     // Total marks for the question
  questionNumber: string; // Question identifier
  questionLevelAnswer?: string; // Question-level answer (e.g., "H", "F", "J" for letter-based answers)
  marksWithAnswers?: string[]; // Array of answers for each mark (for grouped sub-questions like Q12i, 12ii, 12iii)
  subQuestionNumbers?: string[]; // Array of sub-question numbers (e.g., ["22a", "22b"]) for grouped sub-questions
  subQuestionMarks?: { [subQuestionNumber: string]: any[] }; // Map sub-question number to its marks array (prevents mix-up of marks between sub-questions)
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

    const normalized = {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer,
      marksWithAnswers: marksWithAnswers,
      subQuestionNumbers: subQuestionNumbers,
      subQuestionMarks: subQuestionMarks, // Preserve sub-question-to-marks mapping
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
  imageData: string;
  model: ModelType;
  processedImage: ProcessedImageResult;
  questionDetection?: any;
  questionMarks?: any;
  totalMarks?: number;
  questionNumber?: string; // Question number (may include sub-question part like "17a", "17b")
  questionText?: string | null; // Question text from fullExamPapers (source for question detection)
  generalMarkingGuidance?: any; // General marking guidance from the scheme
}

export class MarkingInstructionService {
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
    const { imageData: _imageData, model, processedImage, questionDetection, questionText, questionNumber: inputQuestionNumber } = inputs;


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
      const subQuestionMetadata = (processedImage as any).subQuestionMetadata;

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
        _imageData // Pass image data for edge cases where Drawing Classification failed
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
          usage: { llmTokens: annotationData.usageTokens || 0 },
          cleanedOcrText: cleanedOcrText,
          studentScore: annotationData.studentScore || { score: 0, total: 0 }
        };
      }

      // ========================= START: ANNOTATION ENRICHMENT =========================
      // Enrich annotations with bbox coordinates for single image pipeline

      const enrichedAnnotations = annotationData.annotations.map(anno => {
        const aiStepId = (anno as any).step_id?.trim();
        if (!aiStepId) {
          return null;
        }

        // Find matching step in cleanDataForMarking.steps
        // Try exact match first (check both unified_step_id and globalBlockId)
        let matchingStep = cleanDataForMarking.steps.find((step: any) =>
          step.unified_step_id?.trim() === aiStepId || step.globalBlockId?.trim() === aiStepId
        );

        // If not found, try flexible matching (handle step_1 vs q8_step_1, etc.)
        if (!matchingStep && aiStepId) {
          // Extract step number from AI step_id (e.g., "step_2" -> "2", "q8_step_2" -> "2")
          const stepNumMatch = aiStepId.match(/step[_\s]*(\d+)/i);
          if (stepNumMatch && stepNumMatch[1]) {
            const stepNum = parseInt(stepNumMatch[1], 10);
            // Match by step index (1-based)
            if (stepNum > 0 && stepNum <= cleanDataForMarking.steps.length) {
              matchingStep = cleanDataForMarking.steps[stepNum - 1];
            }
          }
        }

        // If still not found, check if AI is using OCR block ID format (block_X_Y)
        if (!matchingStep && aiStepId && aiStepId.startsWith('block_')) {
          matchingStep = cleanDataForMarking.steps.find((step: any) =>
            step.globalBlockId?.trim() === aiStepId
          );
        }

        if (matchingStep && matchingStep.bbox) {
          // Get pageIndex from matchingStep, but treat -1 as invalid and use fallback
          let pageIndex = matchingStep.pageIndex;
          if (pageIndex == null || pageIndex < 0) {
            // Try to get pageIndex from rawOcrBlocks if available
            if (rawOcrBlocks && rawOcrBlocks.length > 0) {
              // Find the OCR block that matches this step
              const matchingBlock = rawOcrBlocks.find((block: any) =>
                block.id === matchingStep.globalBlockId ||
                (matchingStep.globalBlockId && block.id?.trim() === matchingStep.globalBlockId.trim())
              );
              if (matchingBlock && matchingBlock.pageIndex != null && matchingBlock.pageIndex >= 0) {
                pageIndex = matchingBlock.pageIndex;
              } else {
                // Use first block's pageIndex as fallback
                pageIndex = rawOcrBlocks[0]?.pageIndex ?? 0;
              }
            } else {
              pageIndex = 0; // Default fallback
            }
          }

          return {
            ...anno,
            bbox: matchingStep.bbox as [number, number, number, number],
            pageIndex: pageIndex,
            ocrSource: (matchingStep as any).ocrSource, // Preserve OCR source
            hasLineData: (matchingStep as any).hasLineData // Preserve line data flag
          };
        } else {
          return null;
        }
      }).filter(anno => anno !== null);



      // ========================== END: ANNOTATION ENRICHMENT ==========================

      const result: MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; studentScore?: any } = {
        annotations: enrichedAnnotations, // ✅ Return enriched annotations with bbox coordinates
        usage: { llmTokens: annotationData.usageTokens || 0 },
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

  // Use shared normalization helper from TextNormalizationUtils

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
    imageData?: string // Image data for edge cases where Drawing Classification failed
  ): Promise<{ annotations: string; studentScore?: any; usageTokens: number }> {
    // Parse and format OCR text if it's JSON
    let formattedOcrText = ocrText;
    try {
      const parsedOcr = JSON.parse(ocrText);
      if (parsedOcr.question && parsedOcr.steps) {
        // Format the OCR text nicely and normalize LaTeX delimiters
        formattedOcrText = `Question: ${parsedOcr.question}\n\nStudent's Work:\n${parsedOcr.steps.map((step: any, index: number) => {
          const normalizedText = normalizeLatexDelimiters(step.cleanedText || step.text || '');
          // Use simplified step ID format (e.g., [step_1], [step_2])
          const simplifiedStepId = `step_${index + 1}`;
          return `${index + 1}. [${simplifiedStepId}] ${normalizedText}`;
        }).join('\n')}`;
      }
    } catch (error) {
      // If parsing fails, normalize the original text
      formattedOcrText = normalizeLatexDelimiters(ocrText);
    }

    // ========================= START: USE SINGLE PROMPT =========================
    // Use the centralized prompt from prompts.ts
    const { AI_PROMPTS } = await import('../../config/prompts.js');

    // Extract general marking guidance
    const formattedGeneralGuidance = this.formatGeneralMarkingGuidance(generalMarkingGuidance);

    // Determine which prompt to use based on whether we have a meaningful marking scheme
    let hasMarkingScheme = normalizedScheme !== null &&
      normalizedScheme !== undefined &&
      normalizedScheme.marks.length > 0;

    if (normalizedScheme) {
    }

    let systemPrompt: string;
    let userPrompt: string;

    if (hasMarkingScheme) {
      // Use the withMarkingScheme prompt
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = prompt.system;

      // Format marking scheme for the prompt using normalized data
      // CRITICAL: Verify this scheme belongs to the current question before passing to AI
      const schemeQuestionNumber = normalizedScheme.questionNumber;
      const currentQuestionNumber = inputQuestionNumber || normalizedScheme.questionNumber || 'Unknown';
      const baseSchemeQNum = String(schemeQuestionNumber || '').replace(/[a-z]/i, '');
      const baseCurrentQNum = String(currentQuestionNumber || '').replace(/[a-z]/i, '');

      let schemeJson = '';
      // Only use this scheme if it matches the current question
      if (baseSchemeQNum === baseCurrentQNum || schemeQuestionNumber === currentQuestionNumber) {
        try {
          // Convert normalized scheme to JSON format for the prompt
          // Include question-level answer if available
          const schemeData: any = { marks: normalizedScheme.marks };
          if (normalizedScheme.questionLevelAnswer) {
            schemeData.questionLevelAnswer = normalizedScheme.questionLevelAnswer;
          } else if (classificationStudentWork && !subQuestionMetadata?.hasSubQuestions) {
            // For single questions (not grouped), extract final answer from classification if not available
            // Look for the last step that contains an equals sign (likely the final answer)
            const classificationLines = classificationStudentWork.split('\n').filter(line => line.trim());
            for (let i = classificationLines.length - 1; i >= 0; i--) {
              const line = classificationLines[i];
              // Match lines like: "10. [main_step_10] $k = -5$" or "3. [main_step_3] $= 15\pi$"
              const stepMatch = line.match(/\[main_step_\d+\]\s*\$(.+?)\$/);
              if (stepMatch && stepMatch[1]) {
                const content = stepMatch[1].trim();
                // If it contains an equals sign, it's likely a final answer
                if (content.includes('=')) {
                  // For variable assignments like "k = -5", use the full equation
                  // For expressions like "= 15\pi", use just the right side
                  if (content.match(/^[a-zA-Z]\s*=/)) {
                    // Variable assignment: use full equation (e.g., "k = -5")
                    schemeData.questionLevelAnswer = content;
                  } else {
                    // Expression: use right side only (e.g., "15\pi")
                    const equalsMatch = content.match(/=\s*(.+)$/);
                    if (equalsMatch && equalsMatch[1]) {
                      schemeData.questionLevelAnswer = equalsMatch[1].trim();
                    } else {
                      schemeData.questionLevelAnswer = content;
                    }
                  }
                  console.log(`[MARKING INSTRUCTION] Q${currentQuestionNumber}: Extracted final answer from classification: ${schemeData.questionLevelAnswer}`);
                  break;
                }
              }
            }
          }
          // Include sub-question-specific answers if available (for grouped sub-questions)
          if (normalizedScheme.marksWithAnswers && normalizedScheme.marksWithAnswers.length > 0) {
            schemeData.marksWithAnswers = normalizedScheme.marksWithAnswers;
          }
          // CRITICAL: Include sub-question marks mapping to prevent mix-up (e.g., Q3a marks assigned to Q3b)
          if (normalizedScheme.subQuestionMarks && typeof normalizedScheme.subQuestionMarks === 'object') {
            schemeData.subQuestionMarks = normalizedScheme.subQuestionMarks;
          }
          // Include alternative method if available (e.g., Q7alt, Q22alt)
          if (normalizedScheme.hasAlternatives && normalizedScheme.alternativeMethod) {
            schemeData.alternativeMethod = {
              marks: normalizedScheme.alternativeMethod.marks || [],
              answer: normalizedScheme.alternativeMethod.answer
            };
          }
          schemeJson = JSON.stringify(schemeData, null, 2);
        } catch (error) {
          schemeJson = '{}';
        }
      } else {
        // Scheme doesn't match current question - don't pass it to AI
        console.warn(`[MARKING INSTRUCTION] Q${currentQuestionNumber}: Marking scheme question number (${schemeQuestionNumber}) doesn't match current question. Skipping scheme.`);
        hasMarkingScheme = false;
        schemeJson = '{}';
      }

      // Get total marks from normalized scheme
      const totalMarks = normalizedScheme.totalMarks;

      // Extract sub-question info for prompt (prefer from metadata, fallback to scheme)
      const subQuestionNumbers = subQuestionMetadata?.subQuestionNumbers || normalizedScheme.subQuestionNumbers;
      const subQuestionAnswers = normalizedScheme.marksWithAnswers;


      // Call user prompt with enhanced parameters (raw OCR blocks and classification)
      userPrompt = prompt.user(
        formattedOcrText,
        schemeJson,
        totalMarks,
        questionText,
        rawOcrBlocks,
        classificationStudentWork ? classificationStudentWork.replace(/\\n/g, '\n') : null,
        subQuestionNumbers,
        subQuestionAnswers,
        formattedGeneralGuidance // Pass general guidance to prompt
      );
    } else {
      // Use the basic prompt
      const prompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = prompt.system;
      // Pass classification student work to basic prompt for better context
      userPrompt = prompt.user(
        formattedOcrText,
        classificationStudentWork ? classificationStudentWork.replace(/\\n/g, '\n') : null
      );
    }

    // ========================== END: USE SINGLE PROMPT ==========================

    // Extract question number for logging (prefer input questionNumber which may include sub-question part)
    const questionNumber = inputQuestionNumber || normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';

    // Log only content sections by extracting them from the actual userPrompt (no duplicate logic)
    const GREEN = '\x1b[32m';
    const RED = '\x1b[31m';
    const MAGENTA = '\x1b[35m';
    const YELLOW = '\x1b[33m';
    const CYAN = '\x1b[36m';
    const RESET = '\x1b[0m';

    // TEMPORARILY DISABLED: Detailed prompt logging
    console.log('');
    console.log(`${RED}📝 [AI PROMPT] Q${questionNumber}${RESET}`);

    // Extract content sections from the actual userPrompt (reuse the real prompt, just extract content)
    if (userPrompt) {
      // 1. Extract Question Text
      const questionTextMatch = userPrompt.match(/Question:\s*\n([\s\S]*?)(?=\n\n|Total Marks|$)/);
      if (questionTextMatch && questionTextMatch[1]) {
        console.log(`${MAGENTA}Question Text:${RESET}`);
        console.log(MAGENTA + questionTextMatch[1].trim() + RESET);
      }

      // 2. Extract Classification Student Work
      const classificationMatch = userPrompt.match(/STUDENT WORK \(STRUCTURED\):\s*\n([\s\S]*?)(?=\n\n|RAW OCR BLOCKS|$)/);
      if (classificationMatch && classificationMatch[1]) {
        console.log(`${YELLOW}Classification Student Work:${RESET}`);
        console.log(YELLOW + classificationMatch[1].trim() + RESET);
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
        console.log(`[MARKING INSTRUCTION] Using vision API for Q${inputQuestionNumber} (imageData provided)`);

        // Determine which model provider to use
        const isOpenAI = model && model.toString().startsWith('openai-');

        if (isOpenAI) {
          let openaiModel = model.toString().replace('openai-', '');
          const visionResult = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData, openaiModel);
          res = { content: visionResult.content, usageTokens: visionResult.usageTokens };
        } else {
          // Use Gemini Vision
          const visionResult = await ModelProvider.callGeminiChat(systemPrompt, userPrompt, imageData, model);
          res = { content: visionResult.content, usageTokens: visionResult.usageTokens };
        }
      } else {
        // Normal flow: text-only API
        res = await ModelProvider.callText(systemPrompt, userPrompt, model, true);
      }

      aiResponseString = res.content;
      const usageTokens = res.usageTokens;


      // Parse the AI response (Add robust parsing/cleanup)
      let jsonString = aiResponseString;
      const jsonMatch = aiResponseString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonString = jsonMatch[1];
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
      console.log(`🤖 [AI RESPONSE] ${RED}Q${questionNumber}${RESET} - Clean response received:`);
      console.log('  - Annotations count:', '\x1b[35m' + (parsedResponse.annotations?.length || 0) + '\x1b[0m'); // Magenta color
      console.log('  - Student score:', '\x1b[32m' + (parsedResponse.studentScore?.scoreText || 'None') + '\x1b[0m'); // Green color
      console.log('  - Usage tokens:', '\x1b[33m' + usageTokens + '\x1b[0m'); // Yellow color

      // Log visual observation if present (diagnostic for drawing questions)
      if (parsedResponse.visualObservation && parsedResponse.visualObservation.trim()) {
        console.log(`  ${CYAN}📋 [VISUAL OBSERVATION]${RESET}`);
        console.log(`     ${CYAN}${parsedResponse.visualObservation}${RESET}`);
      }

      // Log individual annotations for debugging (especially for answers like 18.6)
      if (parsedResponse.annotations && parsedResponse.annotations.length > 0) {
        console.log('  - Annotations:');
        parsedResponse.annotations.forEach((ann: any, idx: number) => {
          const action = ann.action || 'unknown';
          const text = ann.text || '';
          const stepId = ann.step_id || 'MISSING';
          const reasoning = ann.reasoning || '';
          const actionColor = action === 'tick' ? '\x1b[32m' : action === 'cross' ? '\x1b[31m' : '\x1b[0m';
          const resetColor = '\x1b[0m';
          const blueColor = '\x1b[34m'; // Blue for student answer

          // Look up student answer text from rawOcrBlocks based on step_id
          let studentAnswer = '';

          // Priority 1: Use the explicit student_text from the AI response (new field)
          if (ann.student_text) {
            studentAnswer = ann.student_text;
          }

          // Priority 2: If not provided, look up in rawOcrBlocks
          if (!studentAnswer && rawOcrBlocks && stepId !== 'MISSING') {
            const matchingBlock = rawOcrBlocks.find(block => block.id === stepId);
            if (matchingBlock && matchingBlock.text) {
              studentAnswer = matchingBlock.text;
            }
          }

          // Priority 3: If still not found, try textMatch as fallback
          if (!studentAnswer && ann.textMatch) {
            studentAnswer = ann.textMatch;
          }

          // Truncate for display
          if (studentAnswer.length > 80) {
            studentAnswer = studentAnswer.substring(0, 80) + '...';
          }

          const studentAnswerDisplay = studentAnswer ? `${blueColor}"${studentAnswer}"${resetColor}` : '""';

          // Enhanced logging for incorrect answers
          let logMessage = `    ${idx + 1}. ${actionColor}${action}${resetColor} ${text ? `[${text}]` : ''} ${studentAnswerDisplay}`;

          // If incorrect (cross or 0 marks), explicitly show reasoning
          if (action === 'cross' || text.includes('0')) {
            logMessage += `\n      ${RED}↳ Reason: ${reasoning || 'No reasoning provided'}${RESET}`;
            if (studentAnswer) {
              logMessage += `\n      ${RED}↳ OCR Value: ${RESET}${MAGENTA}"${studentAnswer}"${RESET}`;

              // Find best matching classification text to show comparison
              if (classificationStudentWork) {
                try {
                  // Simple Dice coefficient for similarity
                  const getBigrams = (str: string) => {
                    const bigrams = new Set();
                    for (let i = 0; i < str.length - 1; i++) bigrams.add(str.substring(i, i + 2));
                    return bigrams;
                  };

                  const calculateSimilarity = (str1: string, str2: string) => {
                    const s1 = str1.toLowerCase().replace(/\s+/g, '');
                    const s2 = str2.toLowerCase().replace(/\s+/g, '');
                    if (!s1 || !s2) return 0;
                    const bg1 = getBigrams(s1);
                    const bg2 = getBigrams(s2);
                    let intersection = 0;
                    bg1.forEach(bg => { if (bg2.has(bg)) intersection++; });
                    return (2 * intersection) / (bg1.size + bg2.size);
                  };

                  const classificationSteps = classificationStudentWork.replace(/\\n/g, '\n').split('\n').map(s => s.trim()).filter(s => s.length > 0);
                  let bestMatch = { text: '', score: 0 };

                  classificationSteps.forEach((stepText: string) => {
                    const score = calculateSimilarity(studentAnswer, stepText);
                    if (score > bestMatch.score) {
                      bestMatch = { text: stepText, score };
                    }
                  });

                  // If we found a reasonable match (or even a weak one, it's useful context)
                  if (bestMatch.score > 0.1) {
                    logMessage += `\n      ${RED}↳ Classification Value: ${RESET}${MAGENTA}"${bestMatch.text}"${RESET}`;
                  }
                } catch (e) {
                  // Ignore matching errors to prevent logging failure
                }
              }
            }
          } else if (reasoning) {
            // For correct answers, show reasoning on same line if brief
            logMessage += ` - ${reasoning}`;
          }

          console.log(logMessage);
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

      // Return the correct MarkingInstructions structure
      const markingResult = {
        annotations: parsedResponse.annotations || [], // Default to empty array if missing
        studentScore: parsedResponse.studentScore || null,
        usageTokens
      };

      return markingResult;

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
