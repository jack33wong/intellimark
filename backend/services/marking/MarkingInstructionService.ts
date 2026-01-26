import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import type { NormalizedMarkingScheme, MarkingInputs, MarkingExecutionResult } from '../../types/marking.js';
import { getPrompt } from '../../config/prompts.js';
import { normalizeLatexDelimiters, sanitizeOcrArtifacts, normalizeTextForComparison, normalizeSubQuestionPart } from '../../utils/TextNormalizationUtils.js';
import * as stringSimilarity from 'string-similarity';
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
      const validAnswers = input.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '');
      if (validAnswers.length > 0) marksWithAnswers = validAnswers;
    } else if (questionMarksData?.subQuestionAnswers && Array.isArray(questionMarksData.subQuestionAnswers)) {
      const validAnswers = questionMarksData.subQuestionAnswers.filter((a: any) => a && typeof a === 'string' && a.trim() !== '');
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

// Formatting logic is now handled via MarkingPromptService directly.

export class MarkingInstructionService {
  private static hasLoggedDebugPrompt = false;
  public static lastFullPrompt: { systemPrompt: string; userPrompt: string } | null = null;

  public static resetDebugLog() {
    MarkingInstructionService.hasLoggedDebugPrompt = false;
  }

  /**
   * Helper to extract Y coordinate safely from various block formats
   * */
  private static getBlockY(block: any): number | null {
    if (!block) return null;
    if (block.coordinates?.y !== undefined) return block.coordinates.y;
    if (block.box) {
      if (Array.isArray(block.box) && block.box.length > 1) return block.box[1]; // [x, y, w, h]
      if (block.box.y !== undefined) return block.box.y;
    }
    if (block.geometry?.y !== undefined) return block.geometry.y;
    return null;
  }

  /**
   * DATA INGESTION PROTOCOL (FIXED)
   * Uses "Fence Post" logic to spatially isolate the current question.
   * Prevents "Q13" text from leaking into "Q12" prompts.
   */
  private static sanitizeOcrBlocks(blocks: any[], questionText: string | null, baseQNum?: string): any[] {
    if (!blocks || !Array.isArray(blocks)) return [];

    // 1. Pre-calculate Y and Sort (Crucial for reading order)
    // We sort physically so we can determine what comes "before" or "after".
    const sortedBlocks = blocks.map(b => ({
      ...b,
      _y: MarkingInstructionService.getBlockY(b) || 0,
      _cleanText: (b.text || b.mathpixLatex || b.latex || b.content || '').trim()
    })).sort((a, b) => a._y - b._y);

    const qLandmarkRegex = /^Q\s*(\d+)/i;

    // 2. Establish Spatial Fences (The "Iron Dome" for Text)
    let minValidY = 0;
    let maxValidY = Number.MAX_SAFE_INTEGER;

    if (baseQNum) {
      // Pass 1: Find Fence Posts
      for (const b of sortedBlocks) {
        const match = b._cleanText.match(qLandmarkRegex);
        if (match) {
          const foundNum = match[1]; // e.g., "12", "13"

          if (foundNum === baseQNum) {
            // : Start Fence found at Q12
            // Allow a tiny fuzz factor (e.g., 5px) for text on the same line
            minValidY = b._y - 5;
          }
          else if (minValidY !== 0 && b._y > minValidY) {
            // : End Fence found at Q13
            // We found a header BELOW our current question. This is the cutoff.
            // We stop at the first header we see after ours.
            if (b._y < maxValidY) maxValidY = b._y;
          }
        }
      }
    }

    // 3. Filtering & Tagging Pass
    const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedQText = normalize(questionText || '');
    const structuralNoiseRegex = /DO NOT WRITE|Turn over|BLANK PAGE|Total for Question|Barcode|Isbn|\\\( \_+ \\\)|_+/i;
    const instructionKeywordRegex = /^[\W\d_]*[a-z]?[\W\d_]*(Draw|Calculate|Explain|Show that|Work out|Write down|Describe|Complete|Label|Sketch|Plot|Construct)\b/i;

    return sortedBlocks.map(b => {
      // --- SPATIAL FILTERING ---
      // If the block is physically above Q12 or below Q13, kill it.
      if (b._y < minValidY || b._y >= maxValidY) return null;

      const content = b._cleanText; // Use pre-cleaned text

      // --- CONTENT FILTERING ---
      if (!content || structuralNoiseRegex.test(content)) return null;

      // Filter ANY Question Header that isn't ours (Redundant safety for "Q13")
      const landmarkMatch = content.match(qLandmarkRegex);
      if (landmarkMatch && landmarkMatch[1] !== baseQNum) return null;

      // Filter noise (single letters, unless it's a sub-part label like "(a)")
      if (content.length < 2 && !/\d/.test(content) && !/[a-zA-Z]/.test(content)) return null;

      // --- INSTRUCTION TAGGING ---
      let isLikelyInstruction = false;
      const normalizedBText = normalize(content);

      // Match against DB Text
      if (content.length > 8 && normalizedBText.length > 3 && normalizedQText.includes(normalizedBText)) isLikelyInstruction = true;
      // Match against Keywords
      if (!isLikelyInstruction && content && instructionKeywordRegex.test(content)) isLikelyInstruction = true;

      // Clean up temp props
      const { _y, _cleanText, ...cleanBlock } = b;
      const finalBlock = { ...cleanBlock, text: content };

      if (isLikelyInstruction) {
        return { ...finalBlock, text: `${content} [PRINTED_INSTRUCTION]` };
      }
      return finalBlock;
    }).filter(b => b !== null);
  }

  private static extractLiveQuestion(blocks: any[], baseQNum: string): string {
    let questionTextBlocks: string[] = [];
    let foundStart = false;
    const qLandmarkRegex = new RegExp(`^Q\\s*${baseQNum}`, 'i');

    for (const b of blocks) {
      const text = (b.text || b.mathpixLatex || '').trim(); // Robust access
      if (!text) continue;

      if (qLandmarkRegex.test(text)) {
        foundStart = true;
        const content = text.replace(qLandmarkRegex, '').replace(/^[.\s:]+/, '').trim();
        if (content) questionTextBlocks.push(content);
        continue;
      }

      if (foundStart) {
        if (text.startsWith('Q') && /^\d+/.test(text.substring(1))) break;
        if (b.isHandwritten) break;
        if (text.includes('[PRINTED_INSTRUCTION]')) {
          questionTextBlocks.push(text.replace('[PRINTED_INSTRUCTION]', '').trim());
        } else {
          questionTextBlocks.push(text);
        }
        if (questionTextBlocks.length >= 5) break;
      }
    }
    return questionTextBlocks.join(' ').trim();
  }

  // ... (Remaining helper methods unchanged)
  private static extractBudgetFromBlocks(blocks: any[], baseQNum?: string): number | null {
    let active = !baseQNum;
    const qLandmarkRegex = baseQNum ? new RegExp(`^Q\\s*${baseQNum}`, 'i') : null;

    for (const b of blocks) {
      const text = (b.text || '');
      if (qLandmarkRegex && qLandmarkRegex.test(text)) active = true;
      if (!active) continue;

      const match = text.match(/\(Total\s+(\d+)\s+marks\)/i) || text.match(/(\d+)\s+marks/i);
      if (match) return parseInt(match[1]);
    }
    return null;
  }

  private static calculateBasicSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const n1 = norm(s1);
    const n2 = norm(s2);
    if (!n1 || !n2) return 0;
    return stringSimilarity.compareTwoStrings(n1, n2);
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
    return formatted;
  }

  // Local helper to format scheme using the original prompt service
  private static formatMarkingSchemeForPrompt(scheme: NormalizedMarkingScheme): string {
    return MarkingPromptService.formatMarkingSchemeForPrompt(scheme);
  }

  /**
   * Execute complete marking flow
   */
  static async executeMarking(inputs: MarkingInputs): Promise<MarkingInstructions & {
    usage?: { llmTokens: number };
    cleanedOcrText?: string;
    markingScheme?: any;
    schemeTextForPrompt?: string;
    overallPerformanceSummary?: string;
  }> {
    const { imageData: _imageData, images, model, processedImage, questionDetection, questionText, questionNumber: inputQuestionNumber, sourceImageIndices, tracker, allowedPageUnion } = inputs;

    try {
      let cleanDataForMarking = (processedImage as any).cleanDataForMarking;
      // Robustly get raw OCR text
      const rawOcrText = (processedImage as any).ocrText || (processedImage as any).cleanedOcrText || '';
      const cleanedOcrText = sanitizeOcrArtifacts(rawOcrText);

      if (!cleanDataForMarking || !cleanDataForMarking.steps || cleanDataForMarking.steps.length === 0) {
        console.log('[MARKING INSTRUCTION] No OCR steps found - proceeding with image-only marking');
        cleanDataForMarking = { steps: [], rawOcrText: '' };
      }

      let questionDetectionForNormalization = questionDetection;
      if (questionDetection && Array.isArray(questionDetection)) {
        const currentQNum = inputQuestionNumber || 'Unknown';
        questionDetectionForNormalization = questionDetection.find((q: any) =>
          q.questionNumber === currentQNum ||
          String(q.questionNumber || '').replace(/[a-z]/i, '') === String(currentQNum).replace(/[a-z]/i, '')
        ) || questionDetection[0];
      }

      const normalizedScheme = normalizeMarkingScheme(questionDetectionForNormalization);

      const rawOcrBlocks = (processedImage as any).rawOcrBlocks;
      const classificationStudentWork = (processedImage as any).classificationStudentWork;
      const classificationBlocks = (processedImage as any).classificationBlocks;
      const subQuestionMetadata = (processedImage as any).subQuestionMetadata;

      // Debugs
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

      const positionMap = new Map<string, { x: number; y: number; width: number; height: number }>();
      if (studentWorkLines.length > 0) {
        studentWorkLines.forEach(line => {
          positionMap.set(line.text, line.position);
        });
      }

      const annotationData = await this.generateFromOCR(
        model,
        cleanedOcrText,
        normalizedScheme,
        questionDetection?.match,
        questionText,
        rawOcrBlocks,
        classificationStudentWork,
        inputQuestionNumber,
        subQuestionMetadata,
        inputs.generalMarkingGuidance,
        _imageData,
        images,
        positionMap,
        sourceImageIndices,
        inputs.subQuestionPageMap,
        allowedPageUnion,
        tracker,
        cleanDataForMarking.steps,
        (processedImage as any).landmarks || [] // Pass landmarks for Sanitization Layer
      );

      if (!annotationData.annotations || !Array.isArray(annotationData.annotations)) {
        throw new Error('AI failed to generate valid annotations array');
      }

      if (annotationData.annotations.length === 0) {
        console.warn(`[MARKING INSTRUCTION] ⚠️ AI returned 0 annotations`);
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
      // 🔧 FIX: GHOST IDENTITY & SMART REDIRECTOR
      // =======================================================================
      const sanitizedBlocks = this.sanitizeOcrBlocks(rawOcrBlocks || [], questionText || '');
      const forbiddenBlockIds = new Set(
        sanitizedBlocks.filter(b => b.text.includes('[PRINTED_INSTRUCTION]')).map(b => b.id)
      );

      const correctedAnnotations = annotationData.annotations.map((anno: any, index: number) => {

        // 1. GHOST PROTECTION: Give every Unmatched mark a UNIQUE ID
        // This prevents the system from merging "M1, M1, M1" into just one "M1".
        // It also ensures they pass checks that require a truthy line_id string.
        if (!anno.line_id || anno.line_id === 'null' || anno.line_id === 'undefined') {
          return {
            ...anno,
            // Generate a unique ID so downstream filters treat this as a distinct mark
            line_id: `ghost_${inputQuestionNumber || 'q'}_${index}_${Date.now()}`,
            ocr_match_status: "UNMATCHED"
          };
        }

        // 2. INSTRUCTION REDIRECT (Existing Logic)
        if (anno.line_id && forbiddenBlockIds.has(anno.line_id)) {
          console.log(`   🛡️ [REDIRECT] Intercepted link to Instruction [${anno.line_id}]`);

          const studentText = (anno.student_text || anno.text || '').trim();
          let bestMatchKey = null;

          if (positionMap.has(studentText)) {
            bestMatchKey = studentText;
          } else {
            for (const [key, _] of positionMap.entries()) {
              if (key.includes(studentText) || studentText.includes(key)) {
                const isNumeric = /^\d+(\.\d+)?$/.test(studentText) && /^\d+(\.\d+)?$/.test(key);
                if (isNumeric && Math.abs(key.length - studentText.length) > 0) {
                  continue;
                }
                bestMatchKey = key;
                break;
              }
            }
          }

          if (bestMatchKey) {
            const newPos = positionMap.get(bestMatchKey);
            console.log(`      ↳ Redirected to Student Line "${bestMatchKey}" at (${newPos?.x}, ${newPos?.y})`);

            return {
              ...anno,
              line_id: `visual_redirect_${Date.now()}_${Math.random()}`,
              ocr_match_status: "MATCHED",
              visual_position: newPos,
              reasoning: `[System: Redirected to Handwriting] ${anno.reasoning}`
            };
          } else {
            // Fallback to Ghost if redirection fails
            return {
              ...anno,
              line_id: `ghost_redirect_${index}_${Date.now()}`,
              ocr_match_status: "UNMATCHED"
            };
          }
        }
        return anno;
      });

      // Immutable Pipeline
      const rawAiAnnotations: RawAIAnnotation[] = correctedAnnotations.map((anno: any) => {
        return {
          text: anno.text,
          pageIndex: anno.pageIndex,
          subQuestion: anno.subQuestion,
          visual_position: anno.visual_position,
          line_id: anno.line_id || anno.lineId,
          student_text: anno.student_text,
          classification_text: anno.classification_text,
          action: anno.action,
          reasoning: anno.reasoning,
          line_index: anno.line_index,
          ocr_match_status: anno.ocr_match_status,
          linked_ocr_id: anno.linked_ocr_id,
          linkedOcrId: anno.linkedOcrId,
          bbox: anno.bbox
        };
      });

      const immutableAnnotations = MarkingInstructionService.processAnnotationsImmutable(
        rawAiAnnotations,
        sourceImageIndices || [0],
        rawOcrBlocks,
        studentWorkLines
      );

      const enrichedAnnotations = MarkingInstructionService.convertToLegacyFormat(immutableAnnotations);

      const { applyVisualStacking } = await import('./AnnotationTransformers.js');
      const stackedAnnotations = applyVisualStacking(enrichedAnnotations);

      stackedAnnotations.sort((a: any, b: any) => {
        const idA = a.line_id || '';
        const idB = b.line_id || '';

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
      throw new Error(`Marking flow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ... (processAnnotationsImmutable, convertToLegacyFormat, replaceCaoWithAnswer, replaceCaoInScheme unchanged) ...
  static processAnnotationsImmutable(
    aiAnnotations: RawAIAnnotation[],
    sourcePages: readonly number[],
    ocrBlocks?: readonly OCRBlock[],
    studentWorkLines?: Array<{ text: string, position?: any }>
  ): readonly ImmutableAnnotation[] {
    const typedSourcePages = sourcePages.map(p => GlobalPageIndex.from(p));
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

  static convertToLegacyFormat(
    immutableAnnotations: readonly ImmutableAnnotation[]
  ): any[] {
    return immutableAnnotations.map(toLegacyFormat);
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
    imageData?: string,
    images?: string[],
    positionMap?: Map<string, { x: number; y: number; width: number; height: number }>,
    sourceImageIndices?: number[],
    subQuestionPageMap?: Record<string, number[]>,
    allowedPageUnion?: number[],
    tracker?: any,
    cleanStudentWorkSteps?: any[],
    landmarks?: Array<{ label: string; y: number }>
  ): Promise<MarkingInstructions & { usage?: { llmTokens: number }; cleanedOcrText?: string; markingScheme?: any; schemeTextForPrompt?: string }> {
    const formattedOcrText = MarkingPromptService.formatOcrTextForPrompt(ocrText);
    const formattedGeneralGuidance = this.formatGeneralMarkingGuidance(generalMarkingGuidance);
    const { AI_PROMPTS } = await import('../../config/prompts.js');

    const currentQNum = inputQuestionNumber || normalizedScheme?.questionNumber || 'Unknown';
    const baseQNum = String(currentQNum).replace(/[a-z]/i, '');
    const sanitizedBlocks = this.sanitizeOcrBlocks(rawOcrBlocks || [], questionText || '', baseQNum);

    // ❌ REMOVED INJECTION LOGIC

    const hasMarkingScheme = normalizedScheme !== null &&
      normalizedScheme !== undefined &&
      (normalizedScheme.marks.length > 0 || (normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0));

    let systemPrompt: string;
    let userPrompt: string;
    let schemeText: string | undefined;

    if (hasMarkingScheme && normalizedScheme) {
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = typeof prompt.system === 'function' ? prompt.system(normalizedScheme.isGeneric === true) : prompt.system;

      MarkingPromptService.replaceCaoInScheme(normalizedScheme);
      schemeText = this.formatMarkingSchemeForPrompt(normalizedScheme);

      let structuredQuestionText = '';
      const liveQuestion = this.extractLiveQuestion(sanitizedBlocks, baseQNum);

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
        structuredQuestionText.trim() || questionText || liveQuestion || classificationStudentWork || 'No question text provided',
        subQuestionPageMap as any,
        formattedGeneralGuidance,
        normalizedScheme.isGeneric === true
      );
    } else {
      const basicPrompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = basicPrompt.system;
      userPrompt = basicPrompt.user(formattedOcrText, classificationStudentWork || 'No student work provided');
    }

    const logUserPrompt = process.env.LOG_AI_MARKING_USER_PROMPT === 'true';
    const logSystemPrompt = process.env.LOG_AI_MARKING_SYSTEM_PROMPT === 'true';
    const logResponse = process.env.LOG_AI_MARKING_RESPONSE === 'true';

    if (logUserPrompt || logSystemPrompt) {
      console.log('\n🚀 [PROMPT-ALIGNMENT] FINAL AI PROMPT SENT TO MODEL:');
      console.log('==================================================================');
      if (logSystemPrompt) {
        console.log('SYSTEM PROMPT:\n', systemPrompt);
        if (logUserPrompt) console.log('------------------------------------------------------------------');
      } else {
        console.log('SYSTEM PROMPT: [REDACTED] (Set LOG_AI_MARKING_SYSTEM_PROMPT=true to enable)');
        if (logUserPrompt) console.log('------------------------------------------------------------------');
      }

      if (logUserPrompt) {
        console.log('USER PROMPT:\n', userPrompt);
      }
      console.log('==================================================================\n');
    }

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

    if (logResponse) {
      console.log('\n========================================');
      console.log('[LOG-DEBUG] Raw AI MARKING JSON Response');
      console.log('----------------------------------------');
      console.log(res.content);
      console.log('========================================\n');
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