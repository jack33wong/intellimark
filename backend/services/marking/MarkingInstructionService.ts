import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import type { NormalizedMarkingScheme, MarkingInputs, MarkingExecutionResult } from '../../types/marking.js';
import { getPrompt } from '../../config/prompts.js';
import { normalizeLatexDelimiters, sanitizeOcrArtifacts } from '../../utils/TextNormalizationUtils.js';
import { MarkingPromptService } from './MarkingPromptService.js';
import { MarkingResultParser } from './MarkingResultParser.js';
import { MarkingPositioningService } from './MarkingPositioningService.js';

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



// ========================= START: NORMALIZATION FUNCTION =========================
function normalizeMarkingScheme(input: any): NormalizedMarkingScheme | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  // [Single Image Pipeline]
  if (input.markingScheme && typeof input.markingScheme === 'string') {
    try {
      const parsed = JSON.parse(input.markingScheme);
      return {
        marks: parsed.marks || [],
        totalMarks: input.match?.marks || 0,
        questionNumber: input.match?.questionNumber || '1',
        questionLevelAnswer: input.answer || input.match?.answer || parsed.answer || undefined,
        parentQuestionMarks: input.match?.parentQuestionMarks || input.match?.marks,
        isGeneric: input.isGeneric === true
      };
    } catch (error) { return null; }
  }
  // [DB Record]
  if ((input.marks || input.question_marks) && (input.question_text || input.questionText)) {
    const totalMarks = typeof input.marks === 'number' ? input.marks : (typeof input.question_marks === 'number' ? input.question_marks : 0);
    return {
      marks: [],
      totalMarks: totalMarks,
      questionNumber: input.question_number || input.questionNumber || '1',
      questionLevelAnswer: undefined,
      parentQuestionMarks: totalMarks
    };
  }
  // [Unified Pipeline]
  if (input.questionMarks && input.totalMarks !== undefined) {
    let questionMarksData = input.questionMarks;
    let hasAlternatives = false;
    let alternativeMethod = null;
    if (questionMarksData.hasAlternatives && questionMarksData.main && questionMarksData.alt) {
      hasAlternatives = true;
      alternativeMethod = questionMarksData.alt;
      questionMarksData = questionMarksData.main;
    }
    const marksArray = questionMarksData.marks || [];
    const questionLevelAnswer = input.answer || questionMarksData.answer || undefined;

    // [Sub-question logic]
    let marksWithAnswers: string[] | undefined = undefined;
    if (input.subQuestionAnswers && Array.isArray(input.subQuestionAnswers) && input.subQuestionAnswers.length > 0) {
      const validAnswers = input.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '' && a.toLowerCase() !== 'cao');
      if (validAnswers.length > 0) marksWithAnswers = validAnswers;
    } else if (questionMarksData?.subQuestionAnswers && Array.isArray(questionMarksData.subQuestionAnswers)) {
      const validAnswers = questionMarksData.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '' && a.toLowerCase() !== 'cao');
      if (validAnswers.length > 0) marksWithAnswers = validAnswers;
    }

    const subQuestionNumbers = input.subQuestionNumbers || questionMarksData?.subQuestionNumbers || (input as any).subQuestionNumbers;
    const subQuestionMarks = questionMarksData?.subQuestionMarks || (input as any).subQuestionMarks;
    let subQuestionMaxScores = input.subQuestionMaxScores || (input as any).subQuestionMaxScores;
    let subQuestionAnswersMap = questionMarksData?.subQuestionAnswersMap || (input as any).subQuestionAnswersMap;

    if (!subQuestionAnswersMap && subQuestionMarks) {
      subQuestionAnswersMap = {};
      for (const [key, val] of Object.entries(subQuestionMarks)) {
        if (val && typeof val === 'object' && (val as any).answer) {
          subQuestionAnswersMap[key] = (val as any).answer;
          const suffix = key.replace(/^\d+/, '');
          if (suffix && suffix !== key) subQuestionAnswersMap[suffix] = (val as any).answer;
        }
      }
    }

    const subQuestionTexts = input.subQuestionTexts || (input as any).subQuestionTexts;

    // Max Score Handling
    let explicitMaxScores = input.subQuestionMaxScores || (input as any).subQuestionMaxScores;
    if (explicitMaxScores && typeof explicitMaxScores === 'object') {
      subQuestionMaxScores = {};
      for (const [key, value] of Object.entries(explicitMaxScores)) {
        subQuestionMaxScores[key] = Number(value);
        const suffix = key.replace(/^\d+/, '');
        if (suffix && suffix !== key) subQuestionMaxScores[suffix] = Number(value);
        if (key === suffix && input.questionNumber) subQuestionMaxScores[`${input.questionNumber}${key}`] = Number(value);
      }
    }
    if (!subQuestionMaxScores && subQuestionMarks) {
      subQuestionMaxScores = {};
      for (const [key, marks] of Object.entries(subQuestionMarks)) {
        let mArr: any[] = [];
        if (Array.isArray(marks)) mArr = marks;
        else if ((marks as any).marks) mArr = (marks as any).marks;
        const total = mArr.reduce((sum, m) => sum + (Number(m.value) || 1), 0);
        subQuestionMaxScores[key] = total;
        const suffix = key.replace(/^\d+/, '');
        if (suffix && suffix !== key) subQuestionMaxScores[suffix] = total;
      }
    }

    return {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.totalMarks,
      questionNumber: input.questionNumber || '1',
      questionLevelAnswer: questionLevelAnswer,
      marksWithAnswers: marksWithAnswers,
      subQuestionNumbers: subQuestionNumbers,
      subQuestionMarks: subQuestionMarks,
      subQuestionMaxScores: subQuestionMaxScores,
      subQuestionAnswersMap: subQuestionAnswersMap,
      subQuestionTexts: subQuestionTexts,
      alternativeMethod: alternativeMethod,
      hasAlternatives: hasAlternatives,
      parentQuestionMarks: input.parentQuestionMarks,
      isGeneric: input.isGeneric === true
    };
  }
  // [Fallback Match]
  if (input.match?.markingScheme?.questionMarks) {
    let marksArray = [];
    if (input.match.markingScheme.questionMarks.marks) marksArray = input.match.markingScheme.questionMarks.marks;
    else if (Array.isArray(input.match.markingScheme.questionMarks)) marksArray = input.match.markingScheme.questionMarks;
    return {
      marks: Array.isArray(marksArray) ? marksArray : [],
      totalMarks: input.match.marks || 0,
      questionNumber: input.match.questionNumber || '1',
      questionLevelAnswer: input.answer || input.match.answer || input.match.markingScheme.answer,
      parentQuestionMarks: input.match.parentQuestionMarks || input.match.marks
    };
  }
  return null;
}
// ========================== END: NORMALIZATION FUNCTION ==========================

// Import the formatting function from prompts.ts
import { formatMarkingSchemeAsBullets } from '../../config/prompts.js';



export class MarkingInstructionService {
  private static hasLoggedDebugPrompt = false;
  public static lastFullPrompt: { systemPrompt: string; userPrompt: string } | null = null;

  public static resetDebugLog() {
    MarkingInstructionService.hasLoggedDebugPrompt = false;
  }



  /**
   * DATA INGESTION PROTOCOL
   * We ONLY tag blocks. We DO NOT delete them or sever links.
   * This respects the "Trust AI" design.
   */
  private static sanitizeOcrBlocks(blocks: any[], questionText: string | null): any[] {
    if (!blocks || !Array.isArray(blocks)) return [];
    const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedQText = normalize(questionText || '');
    const structuralNoiseRegex = /DO NOT WRITE|Turn over|BLANK PAGE|Total for Question|Barcode|Isbn/i;
    const instructionKeywordRegex = /^[\W\d_]*[a-z]?[\W\d_]*(Draw|Calculate|Explain|Show that|Work out|Write down|Describe|Complete|Label|Sketch|Plot|Construct)\b/i;

    return blocks.map(b => {
      if (b.text && structuralNoiseRegex.test(b.text)) return null;
      if (b.text && b.text.length < 2 && !/\d/.test(b.text) && !/[a-zA-Z]/.test(b.text)) return null;

      let isLikelyInstruction = false;
      if (b.text && b.text.length > 8 && normalizedQText.includes(normalize(b.text))) isLikelyInstruction = true;
      if (!isLikelyInstruction && b.text && instructionKeywordRegex.test(b.text)) isLikelyInstruction = true;

      if (isLikelyInstruction) {
        return { ...b, text: `${b.text} [PRINTED_INSTRUCTION]` };
      }
      return b;
    }).filter(b => b !== null);
  }

  private static formatGeneralMarkingGuidance(guidance: any): string {
    if (!guidance) return '';
    if (typeof guidance === 'string') return guidance;
    let formatted = '## GENERAL MARKING GUIDANCE\n';
    if (guidance.precedence) formatted += `> [!IMPORTANT]\n> **Precedence:** ${guidance.precedence}\n\n`;
    if (guidance.generalPrinciples?.length) {
      formatted += '### General Principles\n';
      guidance.generalPrinciples.forEach((p: string) => formatted += `- ${p}\n`);
      formatted += '\n';
    }
    // (logic remains same for other parts if needed, but following snippet's lead)
    return formatted;
  }

  /**
   * Execute complete marking flow - moved from LLMOrchestrator
   */
  static async executeMarking(inputs: MarkingInputs): Promise<MarkingInstructions & {
    usage?: { llmTokens: number };
    cleanedOcrText?: string;
    markingScheme?: any;
    schemeTextForPrompt?: string;
    overallPerformanceSummary?: string;
  }> {
    const { imageData: _imageData, images, model, processedImage, questionDetection, questionText, questionNumber: inputQuestionNumber, sourceImageIndices, tracker } = inputs;

    // Debug log removed


    // OCR processing completed - all OCR cleanup now done in Stage 3 OCRPipeline

    try {
      // Get cleaned OCR data from OCRPipeline (now includes all OCR cleanup)
      let cleanDataForMarking = (processedImage as any).cleanDataForMarking;
      // ========================= START OF FIX =========================
      // Use the plain text OCR text that was passed in, not the JSON format from OCR service
      const rawOcrText = (processedImage as any).ocrText || (processedImage as any).cleanedOcrText;

      // Sanitize immediately to remove alignment artifacts (SYSTEMATIC FIX)
      const cleanedOcrText = sanitizeOcrArtifacts(rawOcrText);

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

      const normalizedScheme = normalizeMarkingScheme(questionDetectionForNormalization);

      const rawOcrBlocks = (processedImage as any).rawOcrBlocks;
      const classificationStudentWork = (processedImage as any).classificationStudentWork;
      const classificationBlocks = (processedImage as any).classificationBlocks;
      const subQuestionMetadata = (processedImage as any).subQuestionMetadata;

      // =======================================================================
      // 🔍 [COORD-DEBUG] LOGGING BLOCK
      // =======================================================================
      console.log(`\n🔍 [COORD-DEBUG] Inspecting Potential Offset Sources...`);

      let debugQBox = null;
      if (questionDetectionForNormalization) {
        debugQBox = questionDetectionForNormalization.region ||
          questionDetectionForNormalization.box ||
          questionDetectionForNormalization.rect ||
          questionDetectionForNormalization.coordinates;
        console.log(`   👉 QuestionDetection Box:`, debugQBox);
      } else {
        console.log(`   ⚠️ QuestionDetection object is missing or null.`);
      }

      if (classificationBlocks && classificationBlocks.length > 0) {
        console.log(`   👉 ClassificationBlock[0]:`, classificationBlocks[0]);
      } else {
        console.log(`   ⚠️ ClassificationBlocks array is empty.`);
      }
      // =======================================================================

      let offsetX = 0;
      let offsetY = 0;

      ({ offsetX, offsetY } = MarkingPositioningService.calculateGlobalOffset(
        classificationBlocks,
        questionDetection,
        questionDetectionForNormalization,
        inputQuestionNumber,
        rawOcrBlocks,
        processedImage
      ));

      const landmarks = (processedImage as any).landmarks || (processedImage as any).zones || [];
      const studentWorkLines = MarkingPositioningService.globalizeStudentWorkLines(
        classificationBlocks,
        landmarks,
        cleanDataForMarking,
        offsetX,
        offsetY
      );

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
        inputs.subQuestionPageMap, // NEW: Pass sub-question page map hint
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
          usage: {
            llmTokens: annotationData.usage?.llmTokens || 0,
            llmInputTokens: annotationData.usage?.llmInputTokens || 0,
            llmOutputTokens: annotationData.usage?.llmOutputTokens || 0
          },
          cleanedOcrText: cleanedOcrText,
          studentScore: annotationData.studentScore || { totalMarks: 0, awardedMarks: 0, scoreText: '0/0' }
        };
      }

      // =======================================================================
      // 🔧 FIX 2: SMART REDIRECTOR (Exact Match Priority)
      // =======================================================================
      const sanitizedBlocks = this.sanitizeOcrBlocks(rawOcrBlocks || [], questionText || '');
      const forbiddenBlockIds = new Set(
        sanitizedBlocks.filter(b => b.text.includes('[PRINTED_INSTRUCTION]')).map(b => b.id)
      );

      const correctedAnnotations = annotationData.annotations.map((anno: any) => {
        // If AI linked to an Instruction Block...
        if (anno.line_id && forbiddenBlockIds.has(anno.line_id)) {
          console.log(`   🛡️ [REDIRECT] Intercepted link to Instruction [${anno.line_id}]`);

          // Try to find the student line that matches the annotation text
          const studentText = (anno.student_text || anno.text || '').trim();
          let bestMatchKey = null;

          // 1. Strict Exact Match (Priority)
          if (positionMap.has(studentText)) {
            bestMatchKey = studentText;
          } else {
            // 2. Strict Fuzzy (Only allow if length is identical or contained without extra digits)
            // Prevents "0.4" matching "0.45"
            for (const [key, _] of positionMap.entries()) {
              // Check for exact substring match
              if (key.includes(studentText) || studentText.includes(key)) {
                // REJECTION RULE: If numeric, lengths must differ by 0 to avoid precision drift
                const isNumeric = /^\d+(\.\d+)?$/.test(studentText) && /^\d+(\.\d+)?$/.test(key);
                if (isNumeric && Math.abs(key.length - studentText.length) > 0) {
                  continue; // Skip "0.4" vs "0.45"
                }
                bestMatchKey = key;
                break;
              }
            }
          }

          if (bestMatchKey) {
            const newPos = positionMap.get(bestMatchKey);
            console.log(`      ↳ Redirected to Student Line "${bestMatchKey}" at (${newPos?.x}, ${newPos?.y})`);

            // Mutate to Visual at Correct Position
            // IMPORTANT: Using a unique line_id to bypass the downstream Spatial Sanitizer/Zone Snap logic
            return {
              ...anno,
              line_id: `visual_redirect_${Date.now()}_${Math.random()}`,
              ocr_match_status: "MATCHED",
              visual_position: newPos,
              reasoning: `[System: Redirected to Handwriting] ${anno.reasoning}`
            };
          } else {
            // Fallback: Just detach to avoid highlighting the header
            // V26 Fix: Preserve the AI's intended status (e.g. MATCHED) instead of forcing VISUAL
            return { ...anno, line_id: null, ocr_match_status: anno.ocr_match_status || "MATCHED" };
          }
        }
        return anno;
      });

      // ========================= NEW: IMMUTABLE ANNOTATION PIPELINE =========================
      // Replace legacy mutable enrichment with type-safe immutable pipeline

      const rawAiAnnotations: RawAIAnnotation[] = correctedAnnotations.map((anno: any) => {
        return {
          text: anno.text,
          pageIndex: anno.pageIndex,
          subQuestion: anno.subQuestion,
          visual_position: anno.visual_position,
          line_id: anno.line_id || anno.lineId, // Unified Standard
          student_text: anno.student_text,
          classification_text: anno.classification_text,
          action: anno.action,
          reasoning: anno.reasoning,
          line_index: anno.line_index,
          ocr_match_status: anno.ocr_match_status, // NEW: Preserve AI's match status
          bbox: anno.bbox // NEW: Preserve pre-calculated bbox
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

      // FIX: Sort annotations by step_id sequence (Robust Numeric Sort)
      // Ensures reading order (e.g., block_1_4, block_1_5, block_1_6)

      stackedAnnotations.sort((a: any, b: any) => {
        const idA = a.line_id || '';
        const idB = b.line_id || '';

        // Extract numbers block_{page}_{index} or line_{index}
        const matchA = idA.match(/block_(\d+)_(\d+)/);
        const matchB = idB.match(/block_(\d+)_(\d+)/);

        if (matchA && matchB) {
          const pageA = parseInt(matchA[1], 10);
          const pageB = parseInt(matchB[1], 10);
          if (pageA !== pageB) return pageA - pageB;
          return parseInt(matchA[2], 10) - parseInt(matchB[2], 10);
        }

        return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
      });

      return {
        annotations: stackedAnnotations,
        usage: annotationData.usage || { llmTokens: 0, llmInputTokens: 0, llmOutputTokens: 0 },
        cleanedOcrText: cleanedOcrText,
        studentScore: annotationData.studentScore,
        markingScheme: annotationData.markingScheme,
        schemeTextForPrompt: annotationData.schemeTextForPrompt,
        overallPerformanceSummary: annotationData.overallPerformanceSummary,
        visualObservation: annotationData.visualObservation,
        globalOffsetX: offsetX,
        globalOffsetY: offsetY
      };
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
  private static replaceCaoWithAnswer(markText: string, normalizedScheme: NormalizedMarkingScheme, subKey?: string): string {
    if (!markText) return '';
    const caoRegex = /\bcao\b/i;
    if (caoRegex.test(markText)) {
      let replacement: string | undefined;
      if (normalizedScheme.subQuestionAnswersMap && subKey) {
        replacement = normalizedScheme.subQuestionAnswersMap[subKey];
        if (!replacement) replacement = normalizedScheme.subQuestionAnswersMap[subKey.replace(/^\d+/, '')];
      }
      if (!replacement && normalizedScheme.questionLevelAnswer) replacement = normalizedScheme.questionLevelAnswer;
      if (replacement) return markText.replace(caoRegex, replacement);
    }
    return markText;
  }

  /**
   * Mutates the normalizedScheme in-place to replace 'cao' with actual answers.
   * This ensures consistency between the prompt and the persisted marking logic.
   */
  private static replaceCaoInScheme(normalizedScheme: NormalizedMarkingScheme): void {
    if (normalizedScheme.subQuestionMarks) {
      Object.keys(normalizedScheme.subQuestionMarks).forEach(subQ => {
        let marks = normalizedScheme.subQuestionMarks![subQ];
        if (!Array.isArray(marks) && (marks as any).marks) marks = (marks as any).marks;
        if (Array.isArray(marks)) {
          marks.forEach((m: any) => {
            if (m.answer) m.answer = this.replaceCaoWithAnswer(m.answer, normalizedScheme, subQ);
          });
        }
      });
    }
    // ... (main marks logic)
    if (normalizedScheme.marks) {
      normalizedScheme.marks.forEach((m: any) => {
        if (m.answer) m.answer = this.replaceCaoWithAnswer(m.answer, normalizedScheme);
      });
    }
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
    subQuestionPageMap?: Record<string, number[]>, // NEW: Explicit mapping of sub-question part -> pageIndex(es)
    allowedPageUnion?: number[], // NEW: Union of all pages for the main question
    tracker?: any // NEW: UsageTracker for tracking LLM tokens
  ): Promise<MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; markingScheme?: any; schemeTextForPrompt?: string }> {
    const formattedOcrText = MarkingPromptService.formatOcrTextForPrompt(ocrText);
    const formattedGeneralGuidance = MarkingPromptService.formatGeneralMarkingGuidance(generalMarkingGuidance);
    const { AI_PROMPTS } = await import('../../config/prompts.js');

    const hasMarkingScheme = normalizedScheme !== null &&
      normalizedScheme !== undefined &&
      (normalizedScheme.marks.length > 0 || (normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0));

    const sanitizedBlocks = this.sanitizeOcrBlocks(rawOcrBlocks || [], questionText || '');
    let systemPrompt: string;
    let userPrompt: string;
    let schemeText: string | undefined;

    if (hasMarkingScheme && normalizedScheme) {
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = typeof prompt.system === 'function' ? prompt.system(normalizedScheme.isGeneric === true) : prompt.system;

      MarkingPromptService.replaceCaoInScheme(normalizedScheme);
      schemeText = MarkingPromptService.formatMarkingSchemeForPrompt(normalizedScheme);

      let structuredQuestionText = '';
      const currentQNum = inputQuestionNumber || normalizedScheme.questionNumber || 'Unknown';
      const baseQNum = String(currentQNum).replace(/[a-z]/i, '');
      if (questionText) structuredQuestionText += `**[${baseQNum}]**: ${questionText}\n\n`;
      if (normalizedScheme.subQuestionTexts) {
        Object.keys(normalizedScheme.subQuestionTexts).sort().forEach(key => {
          const text = normalizedScheme.subQuestionTexts![key];
          if (text) {
            const displayKey = key.includes(baseQNum) ? key : `${baseQNum}${key}`;
            structuredQuestionText += `**[${displayKey}]**: ${text}\n\n`;
          }
        });
      }

      userPrompt = prompt.user(
        currentQNum,
        schemeText,
        classificationStudentWork || 'No student work provided',
        sanitizedBlocks,
        structuredQuestionText.trim() || questionText || 'No question text provided',
        subQuestionPageMap as any,
        formattedGeneralGuidance,
        normalizedScheme.isGeneric === true
      );
    } else {
      const basicPrompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = basicPrompt.system;
      userPrompt = basicPrompt.user(formattedOcrText, classificationStudentWork || 'No student work provided');
    }

    const questionNumber = inputQuestionNumber || normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';
    MarkingPromptService.logFullPrompt(questionNumber, systemPrompt, userPrompt);
    MarkingInstructionService.lastFullPrompt = { systemPrompt, userPrompt };

    const { ModelProvider } = await import('../../utils/ModelProvider.js');
    let res;

    if (imageData && imageData.trim() !== '') {
      const isOpenAI = model && model.toString().startsWith('openai-');
      if (isOpenAI) {
        let openaiModel = model.toString().replace('openai-', '');
        const visionResult = await ModelProvider.callOpenAIChat(systemPrompt, userPrompt, imageData, openaiModel, true, tracker, 'marking');
        res = { content: visionResult.content, usageTokens: visionResult.usageTokens, inputTokens: visionResult.inputTokens, outputTokens: visionResult.outputTokens };
      } else {
        const imageInput = (images && images.length > 0) ? images : imageData;
        const visionResult = await ModelProvider.callGeminiChat(systemPrompt, userPrompt, imageInput, model, tracker, 'marking');
        res = { content: visionResult.content, usageTokens: visionResult.usageTokens, inputTokens: visionResult.inputTokens, outputTokens: visionResult.outputTokens };
      }
    } else {
      res = await ModelProvider.callText(systemPrompt, userPrompt, model, true, tracker, 'marking');
    }

    const jsonString = MarkingResultParser.extractJsonFromResponse(res.content);
    let parsedResponse = MarkingResultParser.repairJson(jsonString);
    parsedResponse = MarkingResultParser.postProcessMarkingResponse(parsedResponse, normalizedScheme, subQuestionPageMap || {}, inputQuestionNumber || '');

    if (!parsedResponse || !parsedResponse.annotations) {
      throw new Error('AI failed to generate valid annotations array');
    }

    return {
      annotations: parsedResponse.annotations,
      usage: {
        llmTokens: res.usageTokens || 0,
        llmInputTokens: res.inputTokens || 0,
        llmOutputTokens: res.outputTokens || 0
      },
      cleanedOcrText: ocrText,
      markingScheme: normalizedScheme,
      schemeTextForPrompt: schemeText,
      studentScore: parsedResponse.studentScore || { totalMarks: 0, awardedMarks: 0, scoreText: '0/0' },
      visualObservation: parsedResponse.visualObservation
    };
  }
}
