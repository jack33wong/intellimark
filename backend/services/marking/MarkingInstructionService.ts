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
  images?: string[]; // Optional array of images for multi-page questions
  model: ModelType;
  processedImage: ProcessedImageResult;
  questionDetection?: any;
  questionMarks?: any;
  totalMarks?: number;
  questionNumber?: string; // Question number (may include sub-question part like "17a", "17b")
  questionText?: string | null; // Question text from fullExamPapers (source for question detection)
  generalMarkingGuidance?: any; // General marking guidance from the scheme
  allPagesOcrData?: any[]; // Array of OCR results for all pages (for multi-page context)
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
    const { imageData: _imageData, images, model, processedImage, questionDetection, questionText, questionNumber: inputQuestionNumber } = inputs;


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
        images // Pass array of images for multi-page questions
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

      const enrichedAnnotations = annotationData.annotations.map((anno, idx) => {
        let aiStepId = (anno as any).step_id?.trim();

        // FIX: If step_id is missing but it's a drawing, generate a synthetic one
        if (!aiStepId) {
          const text = ((anno as any).student_text || '').toLowerCase();
          const classText = ((anno as any).classification_text || '').toLowerCase();
          if (text.includes('[drawing]') || classText.includes('[drawing]')) {
            aiStepId = `drawing_fallback_${idx}`;
            (anno as any).step_id = aiStepId;
          } else {
            return null;
          }
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
              } else if (inputs.allPagesOcrData && inputs.allPagesOcrData.length > 0) {
                // Fallback: Search in all pages OCR data
                for (let i = 0; i < inputs.allPagesOcrData.length; i++) {
                  const pageData = inputs.allPagesOcrData[i];
                  const pageBlocks = pageData.ocrData?.rawResponse?.detectedBlocks || [];
                  const foundBlock = pageBlocks.find((block: any) =>
                    block.id === matchingStep.globalBlockId ||
                    (matchingStep.globalBlockId && block.id?.trim() === matchingStep.globalBlockId.trim())
                  );
                  if (foundBlock) {
                    pageIndex = i; // Use the index in the array as pageIndex (assuming it matches sourceImageIndices order)
                    // Actually, we should probably use the pageIndex from the block if available, or the index of the page in the array
                    // The block might not have pageIndex if it's raw from Mathpix
                    // But markingRouter passes allPagesOcrData in order.
                    // However, we need to map this index to the global page index?
                    // Wait, markingRouter passes `allPagesOcrData` which corresponds to `sourceImageIndices`.
                    // So `i` here is the index into `sourceImageIndices`.
                    // `pageIndex` in annotation usually refers to the index in `sourceImageIndices` (0, 1, 2...).
                    // So `i` is correct.
                    break;
                  }
                }
                if (pageIndex == null) pageIndex = 0;
              } else {
                // Use first block's pageIndex as fallback
                pageIndex = rawOcrBlocks[0]?.pageIndex ?? 0;
              }
            } else {
              pageIndex = 0; // Default fallback
            }
          }
          // Store pageIndex on the annotation object for later use if needed (though we return a new object)
          (anno as any)._resolvedPageIndex = pageIndex;
        }

        // Try to get AI position
        let aiPositionFromMap: { x: number; y: number; width: number; height: number } | undefined;

        // 1. Try visual_position from AI (NEW DESIGN)
        if ((anno as any).visual_position) {
          const vp = (anno as any).visual_position;
          if (typeof vp.x === 'number' && typeof vp.y === 'number') {
            let x = vp.x;
            let y = vp.y;
            let w = vp.width || 10;
            let h = vp.height || 5;

            // Normalize if values are > 100 (AI likely used 0-1000 scale or pixels)
            // Heuristic: If ANY value > 100, assume 0-1000 scale and divide by 10
            if (x > 100 || y > 100 || w > 100 || h > 100) {
              x = x / 10;
              y = y / 10;
              w = w / 10;
              h = h / 10;
            }

            aiPositionFromMap = {
              x: x,
              y: y,
              width: w,
              height: h
            };
          }
        }

        // 2. Try parsing [POSITION] JSON from text (Fallback for Flash model)
        // Example: "[DRAWING] [POSITION] {x: 50.0, y: 50.0, width: 20.0, height: 10.0}"
        if (!aiPositionFromMap && (anno as any).student_text) {
          const text = (anno as any).student_text;
          const jsonMatch = text.match(/\[POSITION\]\s*(\{.*?\})/);
          if (jsonMatch) {
            try {
              const vp = JSON.parse(jsonMatch[1]);
              if (typeof vp.x === 'number' && typeof vp.y === 'number') {
                let x = vp.x;
                let y = vp.y;
                let w = vp.width || 10;
                let h = vp.height || 5;

                // Normalize
                if (x > 100 || y > 100 || w > 100 || h > 100) {
                  console.log(`[MARKING DEBUG] AI returned large coordinates in text (x=${x}, y=${y}, w=${w}, h=${h}), normalizing by /10`);
                  x = x / 10;
                  y = y / 10;
                  w = w / 10;
                  h = h / 10;
                }

                aiPositionFromMap = {
                  x: x,
                  y: y,
                  width: w,
                  height: h
                };
              }
            } catch (e) {
              console.warn(`[MARKING DEBUG] Failed to parse [POSITION] JSON from text:`, e);
            }
          }
        }

        // 3. Try line_index (Legacy/Text Robust Method)
        const lineIndex = (anno as any).line_index;
        if (!aiPositionFromMap && typeof lineIndex === 'number' && lineIndex > 0 && lineIndex <= studentWorkLines.length) {
          aiPositionFromMap = studentWorkLines[lineIndex - 1].position;
        }

        // 2. Try [POSITION] tag parsing (for Drawing Classification)
        const lookupText = (anno as any).classification_text || anno.student_text;

        if (!aiPositionFromMap && lookupText) {
          // Check for [POSITION: x=..., y=...] tag
          const positionMatch = lookupText.match(/\[POSITION:\s*x=([\d.]+)%?,\s*y=([\d.]+)%?\]/i);
          if (positionMatch) {
            const x = parseFloat(positionMatch[1]);
            const y = parseFloat(positionMatch[2]);

            if (!isNaN(x) && !isNaN(y)) {
              // Create AI position from tag
              // Use default dimensions for drawing markers (small box)
              aiPositionFromMap = {
                x: x,
                y: y,
                width: 10, // Default width for drawing marker
                height: 5  // Default height for drawing marker
              };
              console.log(`[MARKING DEBUG] Parsed position from tag: x=${x}, y=${y}`);
            }
          }
        }

        // 3. Fallback to text matching
        if (!aiPositionFromMap) {
          aiPositionFromMap = positionMap.get(lookupText);
        }

        // If not found and text has newlines, try looking up individual lines
        if (!aiPositionFromMap && lookupText && lookupText.includes('\n')) {
          const lines = lookupText.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
          for (const line of lines) {
            const pos = positionMap.get(line);
            if (pos) {
              aiPositionFromMap = pos;
              break; // Use the first matching line's position
            }
          }
        }

        // 4. DRAWING FALLBACK (New Logic)
        // If AI cites question text (or generic text) but we have [DRAWING] lines with positions, use the drawing position
        // This handles cases where AI ignores the [DRAWING] text and cites the question instead
        if (!aiPositionFromMap || ((anno as any).action === 'tick' || (anno as any).action === 'cross')) {
          // Check if we have any drawing lines with positions
          const drawingLines = studentWorkLines.filter(l => l.text.includes('[DRAWING]') && l.text.includes('[POSITION'));

          if (drawingLines.length > 0) {
            // If we didn't find a position, OR if the text lookup might have matched the question text (which usually doesn't have a position in the map anyway, but just in case)
            // Actually, if aiPositionFromMap IS found, it might be the question text position if that was added to the map.
            // But usually question text isn't in studentWorkLines unless it was mixed in.

            // Stronger condition: If the annotation is about a graph/drawing (inferred from action or context)
            // and we haven't found a specific position from the text, default to the drawing.

            if (!aiPositionFromMap) {
              // Parse position from the first drawing line
              const firstDrawing = drawingLines[0];
              const positionMatch = firstDrawing.text.match(/\[POSITION:\s*x=([\d.]+)%?,\s*y=([\d.]+)%?\]/i);
              if (positionMatch) {
                const x = parseFloat(positionMatch[1]);
                const y = parseFloat(positionMatch[2]);
                if (!isNaN(x) && !isNaN(y)) {
                  aiPositionFromMap = {
                    x: x,
                    y: y,
                    width: 10,
                    height: 5
                  };
                  console.log(`[MARKING DEBUG] Used DRAWING FALLBACK position: x=${x}, y=${y}`);
                }
              }
            }
          }
        }

        // 4. DRAWING FALLBACK (New Design - Default Position)
        // If it's a drawing annotation but AI forgot visual_position, use a default so it's not dropped
        if (!aiPositionFromMap) {
          const text = ((anno as any).student_text || '').toLowerCase();
          const classText = ((anno as any).classification_text || '').toLowerCase();

          if (text.includes('[drawing]') || classText.includes('[drawing]')) {
            // FIX: If it's a "cross" action (or reasoning implies not required), it might be a phantom drawing
            // If we have no position and it's a cross, filter it out instead of creating a dummy box
            if ((anno as any).action === 'cross' || ((anno as any).reasoning || '').toLowerCase().includes('not required')) {
              console.log(`[MARKING DEBUG] Filtering out phantom drawing (cross/not required) with no position: ${text}`);
              return null;
            }

            aiPositionFromMap = {
              x: 50,
              y: 50,
              width: 50,
              height: 50
            };
          }
        }

        const finalAiPosition = (matchingStep as any)?.aiPosition || aiPositionFromMap;

        if (matchingStep && matchingStep.bbox) {
          return {
            ...anno,
            bbox: matchingStep.bbox as [number, number, number, number],
            pageIndex: (anno as any)._resolvedPageIndex ?? 0,
            ocrSource: (matchingStep as any).ocrSource,
            hasLineData: (matchingStep as any).hasLineData,
            aiPosition: finalAiPosition
          };
        } else if (finalAiPosition) {
          // If no matching step but we have AI position (e.g. drawing), return with dummy bbox
          // MarkingExecutor will handle the dummy bbox or use aiPosition
          return {
            ...anno,
            bbox: [1, 1, 1, 1] as [number, number, number, number], // Dummy bbox
            pageIndex: 0, // Default page index
            aiPosition: finalAiPosition
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
    imageData?: string, // Image data for edge cases where Drawing Classification failed
    images?: string[] // Array of images for multi-page questions
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
        console.log(`[MARKING INSTRUCTION] Using vision API for Q${inputQuestionNumber} (imageData provided)`);

        // Determine which model provider to use
        const isOpenAI = model && model.toString().startsWith('openai-');

        if (isOpenAI) {
          let openaiModel = model.toString().replace('openai-', '');
          const visionResult = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData, openaiModel);
          res = { content: visionResult.content, usageTokens: visionResult.usageTokens };
        } else {
          // Use Gemini Vision
          // Use images array if available, otherwise fallback to single imageData
          const imageInput = (images && images.length > 0) ? images : imageData;
          const visionResult = await ModelProvider.callGeminiChat(systemPrompt, userPrompt, imageInput, model);
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
              console.log(`[MARKING FIX] Deduplicated '0' codes for Q${questionNumber}: "${anno.text}" -> "${newText}"`);
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
              console.log(`[MARKING FIX] Merging annotation for Q${questionNumber} step ${anno.step_id}: "${existing.text}" + "${anno.text}" -> "${combinedCodes}"`);
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

        // 3. Filter out phantom drawing annotations (Q16 Fix)
        // If an annotation is for a drawing (step_id contains 'drawing') AND has no mark code (text is empty) AND is a 'tick', remove it.
        // This assumes that valid drawing marks should have a code like "M1" or "A1".
        // If the AI just ticks a drawing without a code, it's likely a "phantom" or "decorative" tick.
        parsedResponse.annotations = parsedResponse.annotations.filter((anno: any) => {
          const isDrawing = anno.step_id && anno.step_id.includes('drawing');
          const hasNoCode = !anno.text || anno.text.trim() === '';
          const isTick = anno.action === 'tick';

          if (isDrawing && hasNoCode && isTick) {
            console.log(`[MARKING FIX] Filtering out phantom drawing annotation for Q${questionNumber} (no mark code):`, JSON.stringify(anno));
            return false;
          }
          return true;
        });
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
