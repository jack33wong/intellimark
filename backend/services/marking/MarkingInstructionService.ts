import type { ModelType, ProcessedImageResult, MarkingInstructions } from '../../types/index.js';
import { getPrompt } from '../../config/prompts.js';
import { normalizeLatexDelimiters, sanitizeOcrArtifacts } from '../../utils/TextNormalizationUtils.js';

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
  marks: any[];
  totalMarks: number;
  questionNumber: string;
  questionLevelAnswer?: string;
  marksWithAnswers?: string[];
  subQuestionNumbers?: string[];
  subQuestionMarks?: { [subQuestionNumber: string]: any[] };
  subQuestionMaxScores?: { [subQuestion: string]: number };
  subQuestionAnswersMap?: { [subLabel: string]: string };
  subQuestionTexts?: { [subQuestion: string]: string };
  hasAlternatives?: boolean;
  alternativeMethod?: any;
  parentQuestionMarks?: number;
  isGeneric?: boolean;
}

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

export interface MarkingInputs {
  imageData?: string;
  images?: string[];
  model: ModelType;
  processedImage: ProcessedImageResult;
  questionDetection?: any;
  questionMarks?: any;
  totalMarks?: number;
  questionNumber?: string;
  questionText?: string | null;
  generalMarkingGuidance?: any;
  allPagesOcrData?: any[];
  sourceImageIndices?: number[];
  markingScheme?: any;
  extractedOcrText?: string;
  subQuestionPageMap?: Record<string, number[]>;
  allowedPageUnion?: number[];
  tracker?: any;
}

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

      // =======================================================================
      // 🔧 FIX: OFFSET FALLBACK (Corrects "Top Left" Display)
      // =======================================================================
      let offsetX = 0;
      let offsetY = 0;

      // 1. Try Classification Block (Primary Source)
      if (classificationBlocks && classificationBlocks.length > 0) {
        const sample = classificationBlocks[0];
        offsetX = sample.box?.x || sample.x || sample.coordinates?.x || 0;
        offsetY = sample.box?.y || sample.y || sample.coordinates?.y || 0;
      }

      // 2. Fallback: Question Detection (Global Position)
      // This is the critical fix for when classificationBlocks is empty
      if ((offsetX === 0 && offsetY === 0) && questionDetectionForNormalization) {
        let qBox = questionDetectionForNormalization.region ||
          questionDetectionForNormalization.box ||
          questionDetectionForNormalization.rect ||
          questionDetectionForNormalization.coordinates;

        // PARENT FALLBACK: If specific Q (e.g. 6a) has no box, find Parent "6"
        if (!qBox && questionDetection && Array.isArray(questionDetection)) {
          const currentBase = String(inputQuestionNumber).replace(/[a-z]/i, '');
          const parentQ = questionDetection.find((q: any) => String(q.questionNumber) === currentBase);
          if (parentQ) {
            qBox = parentQ.box || parentQ.region || parentQ.rect || parentQ.coordinates;
            console.log(`   🔍 [COORD-DEBUG] Inheriting Parent Q${currentBase} Box for Offset`);
          }
        }

        if (qBox) {
          offsetX = qBox.x || 0;
          offsetY = qBox.y || 0;
          console.log(`   🔍 [COORD-DEBUG] Found Global Offset (Source 2): x=${offsetX}, y=${offsetY}`);
        }
      }

      // Source 2.5: Landmark / Zone Detection (Hierarchical Fallback)
      if (offsetX === 0 && offsetY === 0) {
        const landmarks = (processedImage as any).landmarks || (processedImage as any).zones;
        const subQ = String(inputQuestionNumber || '').replace(/^\d+/, '').toLowerCase(); // "a"
        const questionId = String(inputQuestionNumber || '').replace(/[a-z]/i, ''); // "6"

        if (landmarks && Array.isArray(landmarks)) {
          // 1. Direct Match (Prefer current sub-question)
          let match = landmarks.find((l: any) =>
            (l.label && l.label.toLowerCase() === subQ && subQ !== "") ||
            (l.label && l.label.toLowerCase() === inputQuestionNumber?.toLowerCase()) ||
            (l.text && l.text.toLowerCase().includes(`(${subQ})`) && subQ !== "")
          );

          // 2. THE FIX: Hierarchical "First Child" Fallback
          // If we are looking for the ROOT question (e.g. "Q6"), but only CHILD zones exist (e.g. "a"),
          // we bridge to the first sub-part landmark.
          if (!match && landmarks.length > 0) {
            const isRootQuery = subQ === "" || subQ === inputQuestionNumber?.toLowerCase();
            if (isRootQuery) {
              const firstL = landmarks[0];
              const label = (firstL.label || "").toLowerCase();
              if (["a", "i", "1"].includes(label)) {
                match = firstL;
                console.log(`   [ANCHOR-FIX] Bridging Root Question '${inputQuestionNumber}' to First Child Landmark '${label}' at Y=${match.y || match.top}`);
              }
            }
          }

          if (match) {
            offsetY = match.y || match.top || 0;
            offsetX = match.x || match.left || 0;
            console.log(`   🔍 [COORD-DEBUG] Using Landmark Anchor [${match.label || match.text}] for Offset: x=${offsetX}, y=${offsetY}`);
          }
        }
      }

      // Source 3: "Smart Sub-Question Anchor" (The Systematic Fix)
      // If Global Offset is still 0, find the OCR block that matches the current sub-question
      // e.g. if Q="6a", find block "(a)" or "a)" and use IT as the anchor.
      if (offsetX === 0 && offsetY === 0 && rawOcrBlocks && rawOcrBlocks.length > 0) {
        const subQ = String(inputQuestionNumber || '').replace(/^\d+/, ''); // "6a" -> "a"

        // Regex to find "(a)" or "a)" at start of block
        const subQRegex = new RegExp(`^\\(?${subQ}[).]?`, 'i');

        // 1. Try finding specific sub-question anchor
        let anchorBlock = rawOcrBlocks.find((b: any) => subQ && subQRegex.test(b.text));

        // 2. Fallback to first block if not found
        if (!anchorBlock) anchorBlock = rawOcrBlocks[0];

        if (anchorBlock) {
          const bCoords = anchorBlock.coordinates || anchorBlock.box || anchorBlock.geometry?.boundingBox;
          if (bCoords) {
            offsetX = bCoords.x || 0;
            offsetY = bCoords.y || 0;
            console.log(`   🔍 [COORD-DEBUG] Using Sub-Question Anchor [${anchorBlock.id}] "${anchorBlock.text.substring(0, 10)}..." for Offset: x=${offsetX}, y=${offsetY}`);
          }
        }
      }

      if (offsetX === 0 && offsetY === 0) {
        console.warn(`   ⚠️ [COORD-WARNING] Failed to find ANY offset. Marks will be at top-left (0,0).`);
      }

      // =======================================================================
      // APPLY COORDINATE GLOBALIZATION (Per-Block Landmark Scoping)
      // =======================================================================
      let studentWorkLines: Array<{ text: string; position: { x: number; y: number; width: number; height: number } }> = [];

      const landmarks = (processedImage as any).landmarks || (processedImage as any).zones || [];

      // If we have classification blocks, iterate them (Logic 1)
      if (classificationBlocks && classificationBlocks.length > 0) {
        classificationBlocks.forEach((block: any) => {
          // 🏮 PER-BLOCK ANCHORING: Find best landmark for THIS specific block
          // (Used for INHERITANCE fallback if coordinates are missing)
          let blockOffsetX = offsetX;
          let blockOffsetY = offsetY;

          const blockText = (block.text || "").toLowerCase();
          const blockMatch = landmarks.find((l: any) =>
            blockText.includes(`(${l.label?.toLowerCase()})`) ||
            blockText.includes(`${l.label?.toLowerCase()})`)
          );

          if (blockMatch) {
            blockOffsetX = blockMatch.x || blockMatch.left || 0;
            blockOffsetY = blockMatch.y || blockMatch.top || 0;
          }

          // RAW PROCESSING (Centralization): We do NOT add offsets here.
          // AnnotationEnrichmentService is the single source of truth for globalizing these.
          const passThroughLine = (line: any) => {
            if (!line.position) {
              // INHERITANCE FALLBACK: If AI provided no position, anchor to the landmark
              return {
                ...line,
                position: { x: blockOffsetX, y: blockOffsetY, width: 100, height: 40 }
              };
            }
            return line;
          };

          if (block.studentWorkLines && Array.isArray(block.studentWorkLines)) {
            studentWorkLines = studentWorkLines.concat(block.studentWorkLines.map(passThroughLine));
          }
          if (block.subQuestions && Array.isArray(block.subQuestions)) {
            block.subQuestions.forEach((sq: any) => {
              if (sq.studentWorkLines) {
                studentWorkLines = studentWorkLines.concat(sq.studentWorkLines.map(passThroughLine));
              }
            });
          }
        });
      }
      else if (cleanDataForMarking.steps && Array.isArray(cleanDataForMarking.steps)) {
        // If NO classification blocks, we might have steps directly in cleanData
        // Apply Global Offset to them
        studentWorkLines = cleanDataForMarking.steps.map((step: any) => {
          if (!step.box && !step.position) return null;
          const pos = step.box || step.position;
          return {
            text: step.text,
            position: {
              x: pos.x + offsetX,
              y: pos.y + offsetY,
              width: pos.width,
              height: pos.height
            }
          };
        }).filter((s: any) => s !== null);
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

  private static extractAtomicMarks(markObj: any): any[] {
    const mark = String(markObj.mark || '');
    const isNumeric = /^\d+$/.test(mark);
    const comments = String(markObj.comments || '');
    const hasAtomicCodes = /([BMA][1-9]|SC[1-9])\s+for/i.test(comments);

    if (!isNumeric || !hasAtomicCodes) return [markObj];

    const results: any[] = [];
    const regex = /([BMA][1-9]|SC[1-9])\s*for\s*((?:(?![BMA][1-9]\s*for|SC[1-9]\s*for|Listing:|Ratios:|Alternative|Fractions).|[\n\r])*)/gi;
    let match;
    let lastMatchEnd = 0;
    while ((match = regex.exec(comments)) !== null) {
      const markCode = match[1].toUpperCase();
      results.push({
        mark: markCode,
        value: parseInt(markCode.substring(1)) || 1,
        answer: match[2].trim().replace(/\n+/g, ' '),
        comments: ''
      });
      lastMatchEnd = regex.lastIndex;
    }

    const numericTargetMark = parseInt(mark) || 0;
    const currentExtractedTotal = results.reduce((sum, r) => sum + (r.value || 1), 0);
    if (numericTargetMark > currentExtractedTotal) {
      results.push({ mark: `A${numericTargetMark - currentExtractedTotal}`, value: numericTargetMark - currentExtractedTotal, answer: markObj.answer || 'Correct solution.', comments: '(Auto-balanced)' });
    }
    return results.length > 0 ? results : [markObj];
  }

  private static formatMarkingSchemeForPrompt(normalizedScheme: NormalizedMarkingScheme): string {
    const hasGenericSignature = normalizedScheme.marks.some((m: any) =>
      String(m.answer).includes("undefined") || (m.mark && m.mark.startsWith('M') && !m.answer)
    );

    if (normalizedScheme.isGeneric || hasGenericSignature) {
      return `
[GENERIC_GCSE_LOGIC]
> [INSTRUCTION]: You are the CHIEF EXAMINER.
> 1. **GET BUDGET**: Search for "(Total X marks)".
> 2. **SOLVE & MARK**: Award marks for valid steps.
> 3. **CUT (Guillotine)**: Do not exceed the budget.
`;
    }

    let output = '';
    const hasSubQuestions = normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0;

    if (hasSubQuestions) {
      const subQuestions = Object.keys(normalizedScheme.subQuestionMarks!).sort();
      for (const subQ of subQuestions) {
        let marks = normalizedScheme.subQuestionMarks![subQ];
        if (!Array.isArray(marks) && (marks as any).marks) marks = (marks as any).marks;

        const subLabel = subQ.replace(/^\d+/, '');
        const maxScore = normalizedScheme.subQuestionMaxScores ?
          (normalizedScheme.subQuestionMaxScores[subQ] ?? normalizedScheme.subQuestionMaxScores[subLabel]) : undefined;

        output += `[${subQ}]`;
        if (maxScore !== undefined) output += ` [MAX SCORE: ${maxScore}]`;
        output += '\n';

        const expandedMarks: any[] = [];
        if (Array.isArray(marks)) marks.forEach((m: any) => expandedMarks.push(...this.extractAtomicMarks(m)));
        expandedMarks.forEach((m: any) => {
          let ans = this.replaceCaoWithAnswer(m.answer, normalizedScheme, subQ);
          output += `- ${m.mark}: ${ans}\n`;
        });
        output += '\n';
      }
    } else {
      output += `[${normalizedScheme.questionNumber}]`;
      if (normalizedScheme.totalMarks) output += ` [MAX SCORE: ${normalizedScheme.totalMarks}]`;
      output += '\n';
      const expandedMarks: any[] = [];
      normalizedScheme.marks.forEach((m: any) => expandedMarks.push(...this.extractAtomicMarks(m)));
      expandedMarks.forEach((m: any) => {
        let ans = this.replaceCaoWithAnswer(m.answer, normalizedScheme);
        output += `- ${m.mark}: ${ans}\n`;
      });
    }

    if (normalizedScheme.questionLevelAnswer) output += `\nFINAL ANSWER: ${normalizedScheme.questionLevelAnswer}\n`;

    return `
> [INSTRUCTION]: You are the CHIEF EXAMINER.
> 1. **MATCH**: Match the student's work strictly to the M1/A1/B1 definitions below.
> 2. **STRICT SILO RULE (CRITICAL)**:
>    - You MUST respect the [MAX SCORE] for each sub-question.
>    - **OVERFLOW CHECK:** If you find 4 valid marks, but [6a] only allows 2, you MUST check if the other 2 marks belong to [6b].
>    - **DO NOT** lump all marks into the first bucket. Distribute them based on which sub-question they answer.

[OFFICIAL SCHEME]
${output.trim()}
`.trim();
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
          const simplifiedStepId = `line_${index + 1}`;
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
      (normalizedScheme.marks.length > 0 || (normalizedScheme.subQuestionMarks && Object.keys(normalizedScheme.subQuestionMarks).length > 0));

    // =========================================================================
    // NEW: APPLY DATA INGESTION PROTOCOL
    // Sanitize blocks BEFORE passing them to the prompt builder.
    // =========================================================================
    const sanitizedBlocks = this.sanitizeOcrBlocks(rawOcrBlocks || [], questionText || '');

    // Identify Forbidden IDs immediately (for later enforcement)
    const forbiddenBlockIds = new Set(
      sanitizedBlocks
        .filter(b => b.text.includes('[PRINTED_INSTRUCTION]'))
        .map(b => b.id)
    );

    let systemPrompt: string;
    let userPrompt: string;

    if (hasMarkingScheme && normalizedScheme) {
      const prompt = AI_PROMPTS.markingInstructions.withMarkingScheme;
      systemPrompt = typeof prompt.system === 'function' ? prompt.system(normalizedScheme.isGeneric === true) : prompt.system;

      this.replaceCaoInScheme(normalizedScheme);
      schemeText = this.formatMarkingSchemeForPrompt(normalizedScheme);

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
      // No marking scheme
      const basicPrompt = AI_PROMPTS.markingInstructions.basic;
      systemPrompt = basicPrompt.system;
      userPrompt = basicPrompt.user(
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
    // AI MARKING USER PROMPT DEBUG LOG (V25: Re-enabled by user request)
    const shouldLogPrompt = true;

    // Store for traceback/troubleshooting
    MarkingInstructionService.lastFullPrompt = { systemPrompt, userPrompt };

    if (shouldLogPrompt) {
      const BLUE = '\x1b[34m';
      const BOLD = '\x1b[1m';
      const RESET = '\x1b[0m';
      const CYAN = '\x1b[36m';

      console.log(`\n${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
      console.log(`${BOLD}${BLUE}[AI MARKING] Q${questionNumber}${RESET}`);
      console.log(`${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

      // Log SYSTEM PROMPT (DISABLED by user request in V26)
      // console.log(`${BOLD}${CYAN}## SYSTEM PROMPT${RESET}`);
      // console.log(systemPrompt); 
      console.log(`${BOLD}${BLUE}------------------------------------------------------------${RESET}`);

      // Split userPrompt into sections for cleaner logging
      const userPromptSections = userPrompt.split(/\n(?=# )/);
      userPromptSections.forEach(section => {
        if (section.trim().startsWith('# MARKING TASK')) {
          console.log(`${BOLD}${CYAN}${section.trim()}${RESET}`);
        } else if (section.trim().startsWith('## MARKING SCHEME')) {
          const lines = section.trim().split('\n');
          console.log(`${BOLD}${CYAN}${lines[0]}${RESET}`);
          console.log(lines.slice(1).join('\n')); // Log FULL scheme
        } else if (section.trim().startsWith('## STUDENT WORK')) {
          console.log(`${BOLD}${CYAN}${section.trim()}${RESET}`);
        } else if (section.trim().startsWith('## RAW OCR BLOCKS') || section.trim().startsWith('## NO RAW OCR BLOCKS')) {
          const lines = section.trim().split('\n');
          console.log(`${BOLD}${CYAN}${lines[0]}${RESET}`);
          console.log(lines.slice(1).join('\n')); // Log FULL blocks
        } else {
          console.log(section.trim()); // Log FULL text
        }
      });

      console.log(`${BOLD}${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
    }

    // Removed redundant section extraction logs as they were "duplicated and not well formatted"
    // The consolidated session log above provides a cleaner summary.

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
          res = {
            content: visionResult.content,
            usageTokens: visionResult.usageTokens,
            inputTokens: visionResult.inputTokens,
            outputTokens: visionResult.outputTokens
          };
        } else {
          // Use Gemini Vision
          // Use images array if available, otherwise fallback to single imageData
          const imageInput = (images && images.length > 0) ? images : imageData;
          const visionResult = await ModelProvider.callGeminiChat(systemPrompt, userPrompt, imageInput, model, tracker, 'marking');
          res = {
            content: visionResult.content,
            usageTokens: visionResult.usageTokens,
            inputTokens: visionResult.inputTokens,
            outputTokens: visionResult.outputTokens
          };
        }
      } else {
        res = await ModelProvider.callText(systemPrompt, userPrompt, model, true, tracker, 'marking');
      }

      aiResponseString = res.content;
      const usageTokens = res.usageTokens;
      const inputTokens = res.inputTokens || 0;
      const outputTokens = res.outputTokens || 0;

      // Robust parsing of the AI response
      let parsedResponse: any = null;
      let jsonString = aiResponseString;

      // Extract JSON block more robustly (handle internal backticks)
      const jsonStartMarker = '```json';
      const jsonEndMarker = '```';
      const startIndex = aiResponseString.indexOf(jsonStartMarker);
      if (startIndex !== -1) {
        const contentStart = startIndex + jsonStartMarker.length;
        const lastEndIndex = aiResponseString.lastIndexOf(jsonEndMarker);
        if (lastEndIndex > contentStart) {
          jsonString = aiResponseString.substring(contentStart, lastEndIndex).trim();
        }
      } else {
        // Fallback for ``` without json
        const simpleStartMarker = '```';
        const simpleStart = aiResponseString.indexOf(simpleStartMarker);
        if (simpleStart !== -1) {
          const contentStart = simpleStart + simpleStartMarker.length;
          const lastEndIndex = aiResponseString.lastIndexOf(jsonEndMarker);
          if (lastEndIndex > contentStart) {
            jsonString = aiResponseString.substring(contentStart, lastEndIndex).trim();
          }
        }
      }

      try {
        parsedResponse = JSON.parse(jsonString);
      } catch (error) {
        // If parsing fails, fix common JSON issues
        let fixedJson = jsonString;

        // Fix 1: Missing closing brace before comma
        fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
          const indentMatch = match.match(/\n(\s*),\s*\n/);
          const indent = indentMatch ? indentMatch[1] : '    ';
          return `"${field}": "${value}"\n${indent}},\n${indent}{`;
        });

        // Fix 2: Unescaped backslashes
        fixedJson = fixedJson.replace(/\\(?![\\"/nrtbfu])/g, '\\\\');

        try {
          // [DEBUG] Log Raw AI Response for analysis
          console.log(`\n🔍 [RAW AI JSON] Q${inputQuestionNumber || '?'}:\n${jsonString.substring(0, 500)}...\n`);
          parsedResponse = JSON.parse(fixedJson);
        } catch (secondError) {
          // Fix 3: More aggressive backslash escaping
          fixedJson = jsonString.replace(/\\/g, '\\\\')
            .replace(/\\\\n/g, '\\n')
            .replace(/\\\\"/g, '\\"')
            .replace(/\\\\r/g, '\\r')
            .replace(/\\\\t/g, '\\t')
            .replace(/\\\\b/g, '\\b')
            .replace(/\\\\f/g, '\\f');

          // Fix 4: Missing closing brace before comma (retry)
          fixedJson = fixedJson.replace(/"([^"]+)":\s*"((?:[^"\\]|\\.)*)"\s*\n\s*,\s*\n\s*\{/g, (match, field, value) => {
            const indentMatch = match.match(/\n(\s*),\s*\n/);
            const indent = indentMatch ? indentMatch[1] : '    ';
            return `"${field}": "${value}"\n${indent}},\n${indent}{`;
          });

          try {
            parsedResponse = JSON.parse(fixedJson);
          } catch (thirdError) {
            console.error("❌ JSON parsing failed after fix attempts. Error:", thirdError);
            throw thirdError;
          }
        }
      }

      // Extract question number for logging
      const questionNumber = normalizedScheme?.questionNumber || examInfo?.questionNumber || 'Unknown';

      // POST-PROCESSING ON THE PARSED RESPONSE
      if (parsedResponse) {
        // 0. NEW: Enforce Page Assignment Constraints (MAPPER TRUTH)
        if (subQuestionPageMap && Object.keys(subQuestionPageMap).length > 0 && parsedResponse.annotations) {
          parsedResponse.annotations.forEach((anno: any) => {
            let subQ = anno.subQuestion;

            // Fallback: extract from line_id if subQuestion is missing (common for drawings)
            if (!subQ && anno.line_id) {
              const match = anno.line_id.match(/line_\d+([a-z]+)/i);
              if (match) subQ = match[1];
            }

            // NORMALIZATION: Convert "3b" or "3(b)" to "b" to match subQuestionPageMap keys
            if (subQ) {
              const normalizedSubQ = subQ.replace(/^\d+[\s()]*|[\s()]+/g, '').toLowerCase();

              if (subQuestionPageMap[normalizedSubQ] !== undefined) {
                const constraintPages = subQuestionPageMap[normalizedSubQ];
                // Mapper constraints are always an array of allowed pages
                const allowedPages = Array.isArray(constraintPages) ? constraintPages : [constraintPages];

                if (!allowedPages.includes(anno.pageIndex)) {
                  const targetPage = allowedPages[0];
                  console.log(`🔍 [PAGE OVERRIDE] Correcting Q${inputQuestionNumber} sub-question ${subQ} (normalized: ${normalizedSubQ}) from Page ${anno.pageIndex} to allowed Page ${targetPage} (of ${allowedPages.join(',')}) based on Mapper constraints.`);
                  anno.pageIndex = targetPage;
                }
              }
            }
          });
        }

        // 1. Sanitize student_text
        if (parsedResponse.annotations) {
          parsedResponse.annotations.forEach((anno: any) => {
            if (anno.student_text) {
              let cleaned = anno.student_text.replace(/&/g, ' ').replace(/\\/g, '');
              cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s*=\s*/g, ' = ').trim();
              anno.student_text = cleaned;
            }
          });
        }

        // 2. STRICT MARK LIMIT ENFORCEMENT
        if (normalizedScheme) {
          try {
            let marksList: any[] = [];
            if (normalizedScheme.marks && Array.isArray(normalizedScheme.marks)) {
              marksList = [...normalizedScheme.marks];
            }

            // Aggregate marks from sub-questions for composite questions
            if (normalizedScheme.subQuestionMarks) {
              Object.values(normalizedScheme.subQuestionMarks).forEach((subMarks: any) => {
                if (Array.isArray(subMarks)) {
                  marksList.push(...subMarks);
                } else if (subMarks && typeof subMarks === 'object') {
                  // Handle composite object marks
                  if (Array.isArray(subMarks.marks)) {
                    marksList.push(...subMarks.marks);
                  } else if (Array.isArray(subMarks.questionMarks)) {
                    marksList.push(...subMarks.questionMarks);
                  }
                }
              });
            }

            if (marksList.length > 0) {
              const limitMap = new Map<string, number>();
              let floatingCapacity = 0;

              marksList.forEach((m: any) => {
                const code = (m.mark || '').trim();
                if (code) {
                  limitMap.set(code, (limitMap.get(code) || 0) + 1);

                  // RELAXED LIMITS FOR GENERIC MODE
                  // In Budget Mode, the AI might reuse 'A1' multiple times instead of strictly using A1, A2.
                  // We trust the "Mark Budget" to cap the total count, so we unblock the specific token limits.
                  if (normalizedScheme.isGeneric) {
                    limitMap.set(code, 99);
                  }

                  // NEW: If code is numeric (OCR "blob"), add to floating capacity pool
                  if (/^\d+$/.test(code)) {
                    floatingCapacity += parseInt(code, 10);
                  }
                }
              });

              if (parsedResponse.annotations && Array.isArray(parsedResponse.annotations)) {
                const validAnnotations: any[] = [];
                const usageMap = new Map<string, number>();

                parsedResponse.annotations.forEach((anno: any) => {
                  const rawText = (anno.text || '').trim();
                  const allTokens = rawText.split(/[\s,|+]+/).filter((t: string) => t.length > 0);
                  const validTokens: string[] = [];

                  allTokens.forEach((token: string) => {
                    const code = token.split(/[^a-zA-Z0-9]/)[0];
                    const isZeroMark = code.endsWith('0');
                    const isStandardMarkPart = /^[BMAPC][1-9]$/i.test(code);

                    if (limitMap.has(code) || isZeroMark) {
                      const currentUsage = usageMap.get(code) || 0;
                      const limit = limitMap.get(code) || 99; // No limit for 0-value marks

                      if (currentUsage < limit) {
                        validTokens.push(token);
                        usageMap.set(code, currentUsage + 1);
                      } else {
                        console.warn(`⚠️ [MARK LIMIT] Dropped excess token '${token}' for Q${inputQuestionNumber || '?'} (Limit for ${code} is ${limit})`);
                      }
                    } else if (isStandardMarkPart && floatingCapacity > 0) {
                      // HYBRID MODE: Check floating capacity pool for B/M/A/P codes
                      const match = code.match(/(\d+)$/);
                      const value = match ? parseInt(match[1], 10) : 1;

                      if (floatingCapacity >= value) {
                        validTokens.push(token);
                        floatingCapacity -= value;
                        // console.log(`🔍 [HYBRID LIMIT] Allowed '${token}' using floating pool (Remaining: ${floatingCapacity})`);
                      } else {
                        console.warn(`⚠️ [HYBRID LIMIT] Dropped '${token}' - capacity pool drained (${floatingCapacity} < ${value})`);
                      }
                    } else {
                      // Non-mark token or capacity pool exhausted
                    }
                  });

                  if (validTokens.length > 0) {
                    anno.text = validTokens.join(' ');
                    validAnnotations.push(anno);
                  }
                });

                const originalAwarded = parsedResponse.studentScore?.awardedMarks;
                parsedResponse.annotations = validAnnotations;

                // 3. Recalculate total score
                if (parsedResponse.studentScore) {
                  let totalAwarded = 0;
                  validAnnotations.forEach((anno: any) => {
                    const text = (anno.text || '').trim();
                    const action = (anno.action || '').toLowerCase();

                    // ONLY award points if action is 'tick' OR if the action itself is a mark code (AI hallucination fix)
                    const isExplicitTick = action === 'tick' || action === 'mark';
                    const isMarkCodeAction = /^[BMAPC][1-9]$/i.test(action);

                    if (text && (isExplicitTick || isMarkCodeAction)) {
                      const tokens = text.split(/[\s,|+]+/).filter((t: string) => t.length > 0);
                      tokens.forEach((token: string) => {
                        const code = token.split(/[^a-zA-Z0-9]/)[0];
                        // Extract value from code (e.g. M1 -> 1, B2 -> 2)
                        if (code && !code.endsWith('0') && (code.startsWith('M') || code.startsWith('A') || code.startsWith('B') || code.startsWith('P') || code.startsWith('C'))) {
                          const match = code.match(/(\d+)$/);
                          const value = match ? parseInt(match[1], 10) : 1;
                          totalAwarded += value;
                        }
                      });
                    }
                  });

                  // HARD CEILING: Capping score at question/part max
                  const maxMarks = normalizedScheme.totalMarks || 0;

                  // For Generic Mode (Budget Mode), we MUST respect the detected budget as a hard ceiling.
                  // For Standard Mode, we also respect it, but it's less likely to be exceeded due to strict token matching.
                  if (maxMarks > 0 && totalAwarded > maxMarks) {
                    console.log(`🛡️ [HARD CEILING] Q${inputQuestionNumber}: Capping score ${totalAwarded} -> ${maxMarks}`);
                    totalAwarded = maxMarks;
                  }

                  parsedResponse.studentScore.awardedMarks = totalAwarded;

                  // SYSTEMATIC FIX (Refactored): Resolve Budget using Centralized Logic
                  const authoritativeTotal = this.resolveBudget(parsedResponse.meta, maxMarks, inputQuestionNumber);

                  if (authoritativeTotal > 0) {
                    parsedResponse.studentScore.totalMarks = authoritativeTotal;
                    parsedResponse.studentScore.scoreText = `${totalAwarded}/${authoritativeTotal}`;
                  } else {
                    console.log(`[BUDGET Q${inputQuestionNumber}] ⚠️ No Total Info resolved. Defaulting to Awarded (Safety Floor).`);
                    parsedResponse.studentScore.totalMarks = totalAwarded;
                    parsedResponse.studentScore.scoreText = `${totalAwarded}/${totalAwarded}`;
                  }
                }

                // 4. Debugging: Pretty-printed AI Response - DISABLED
                // console.log(`[DEBUG] AI Response for Q${inputQuestionNumber || '?'}:`);
                // console.log(JSON.stringify(parsedResponse, null, 2));
              }
            }
          } catch (e) {
            console.error('Error enforcing mark limits:', e);
          }
        }
      }

      // Log clean AI response with better formatting
      const GREEN = '\x1b[32m';
      const RED = '\x1b[31m';
      const CYAN = '\x1b[36m';
      const RESET = '\x1b[0m';



      // Validate and clean response structure
      if (parsedResponse && parsedResponse.annotations && Array.isArray(parsedResponse.annotations)) {
        parsedResponse.annotations = parsedResponse.annotations.map((anno: any) => {
          // Map AI returned step_id to line_id for consistency
          const aiId = (anno as any).line_id || (anno as any).step_id;
          if (aiId) {
            (anno as any).step_id = aiId; // Still use step_id internally for Annotation interface compatibility if needed
            (anno as any).line_id = aiId; // But ensure line_id is present
          }

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
          const aiId = anno.line_id || anno.step_id || anno.lineId;
          const key = `${aiId}_${anno.action}`;
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
          const isDrawing = anno.line_id && anno.line_id.includes('drawing');
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

      console.log(`🤖 [AI RESPONSE] ${RED}Q${questionNumber}${RESET} - Clean response received:`);
      console.log('  - Annotations count:', '\x1b[35m' + (parsedResponse.annotations?.length || 0) + '\x1b[0m'); // Magenta color
      console.log('  - Student score:', '\x1b[32m' + (parsedResponse.studentScore?.scoreText || 'None') + '\x1b[0m'); // Green color
      console.log('  - Usage tokens:', '\x1b[33m' + usageTokens + '\x1b[0m'); // Yellow color

      if (parsedResponse.visualObservation && parsedResponse.visualObservation.trim()) {
        console.log(`     ${CYAN}${parsedResponse.visualObservation}${RESET}`);
      }

      // Log individual annotations for debugging (especially for answers like 18.6)
      if (parsedResponse.annotations && parsedResponse.annotations.length > 0) {
        console.log('  - Annotations:');
        parsedResponse.annotations.forEach((ann: any, idx: number) => {
          const action = ann.action || 'unknown';
          const text = ann.text || '';
          const stepId = ann.line_id || 'MISSING';
          const reasoning = ann.reasoning || '';
          const actionColor = action === 'tick' ? '\x1b[32m' : action === 'cross' ? '\x1b[31m' : '\x1b[0m';
          const blueColor = '\x1b[34m';
          const resetColor = '\x1b[0m';
          const MAGENTA = '\x1b[35m';
          const RED = '\x1b[31m';
          const GREEN = '\x1b[32m';
          const YELLOW = '\x1b[33m';
          const RESET = '\x1b[0m';

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

          // Enhanced logging for annotations
          const isOcrMatch = (ann.line_id || '').startsWith('block_');
          const sourceLabel = isOcrMatch ? 'OCR' : 'Line';
          const lineIdDisplay = ann.line_id ? `${blueColor}[${ann.line_id}]${resetColor} ` : '';

          let logMessage = `    ${idx + 1}. ${actionColor}${action}${resetColor} ${lineIdDisplay}${text ? `[${text}]` : ''} ${studentAnswerDisplay}`;

          // Always show reasoning
          logMessage += `\n      ↳ Reason: ${reasoning || 'No reasoning provided'}`;

          if (studentAnswer) {
            const label = isOcrMatch ? 'OCR Match' : 'Transcription';
            logMessage += `\n      ↳ ${label}: ${MAGENTA}"${studentAnswer}"${RESET}`;

            if (ann.classification_text && ann.classification_text !== 'N/A') {
              logMessage += `\n      ↳ Classification: ${MAGENTA}"${ann.classification_text}"${RESET}`;
            }
          }

          if (ann.ocr_match_status) {
            const statusColor = ann.ocr_match_status === 'UNMATCHED' ? RED : (ann.ocr_match_status === 'FALLBACK' ? YELLOW : GREEN);
            let displayStatus = ann.ocr_match_status;
            if (ann.ocr_match_status === 'UNMATCHED') displayStatus = 'UNMATCHED (Fallback to Classification)';
            if (ann.ocr_match_status === 'FALLBACK') displayStatus = 'FALLBACK (Heuristic Match)';
            logMessage += `\n      ↳ Status: ${statusColor}"${displayStatus}"${RESET}`;
          }

          console.log(logMessage);
        });
        // Log line_id summary
        const stepIds = parsedResponse.annotations.map((a: any) => a.line_id || 'MISSING');
        const missingCount = stepIds.filter((id: string) => id === 'MISSING').length;
        if (missingCount > 0) {
          console.log(`  ⚠️ ${missingCount}/${parsedResponse.annotations.length} annotations missing line_id`);
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

            if (w >= 65 || h >= 65) {
              const subQ = anno.subQuestion || '';
              // Resize: use 45% for single questions (prevents label flip), 
              // or 70% / subQuestionCount for multi-question pages
              const newSize = subQuestionCount === 1 ? 45 : 70 / subQuestionCount;
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
                  const newY = topEdgeY; // Use top-left alignment
                  anno.visual_position.y = newY;

                  const positionNote = samePage ? 'stacked' : 'separate pages, positioned as top';
                }
              }
            }
          }
        });
      }

      // Return the correct MarkingInstructions structure

      // CRITICAL: Override totalMarks with actual value from marking scheme
      // We should NEVER trust AI to calculate this for OFFICIAL papers - we have the accurate data.
      // EXCEPTION: In Generic Mode, if totalMarks is just the "Safe Ceiling" (20) and AI found a specific total, trust the AI!
      const studentScore = parsedResponse.studentScore || {};
      const isGenericFallback = normalizedScheme?.isGeneric && normalizedScheme?.totalMarks === 20;

      if (normalizedScheme && normalizedScheme.totalMarks > 0 && !isGenericFallback) {
        studentScore.totalMarks = normalizedScheme.totalMarks;
        // Update scoreText to reflect correct total
        if (studentScore.awardedMarks !== undefined) {
          studentScore.scoreText = `${studentScore.awardedMarks}/${studentScore.totalMarks}`;
        }
      }

      return {
        annotations: parsedResponse.annotations,
        studentScore: studentScore,
        overallPerformanceSummary: parsedResponse.overallPerformanceSummary || null, // Extract AI-generated summary
        usage: {
          llmTokens: usageTokens,
          llmInputTokens: inputTokens,
          llmOutputTokens: outputTokens
        },
        cleanedOcrText: formattedOcrText,
        markingScheme: normalizedScheme, // Pass normalized scheme so executor can use it
        schemeTextForPrompt: schemeText, // Pass the exact scheme text used in prompt
        visualObservation: parsedResponse.visualObservation // Pass AI visual observation
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

  /**
   * Encapsulates the logic for determining the authoritative Total Marks (Budget).
   * Prioritizes AI-detected budget over System Defaults 20/40.
   * "Easy Fix": Centralized logic makes maintenance simple.
   */
  private static resolveBudget(meta: any, systemMax: number, qNum: string): number {
    const isAiEstimated = meta?.isTotalEstimated === true || String(meta?.isTotalEstimated) === 'true';
    const aiTotal = meta?.question_total_marks || 0;
    const isSystemDefault = [20, 40, 100].includes(systemMax) || systemMax === 0;

    // PRIORITY 1: Trust AI matching if:
    // A. It read explicit total "Total X marks" (!isAiEstimated)
    // B. It estimated total, BUT System is just a Default placeholder (20, 40).
    // This fixes the bug where "Estimated: true" caused us to fallback to "System: 20".
    if (aiTotal > 0 && (!isAiEstimated || isSystemDefault)) {
      console.log(`[BUDGET Q${qNum}] 🥇 Trusting AI Total: ${aiTotal} (Reason: ${!isAiEstimated ? 'Explicit Read' : 'System Default Override'})`);
      return aiTotal;
    }

    // PRIORITY 2: Trust System if it looks custom/real AND AI is just guessing
    // Only if we have a Custom Max (e.g. 7) do we override the AI's "Estimate".
    if (systemMax > 0 && !isSystemDefault) {
      console.log(`[BUDGET Q${qNum}] 🥈 Trusting System Max: ${systemMax} (Reliable Custom Value)`);
      return systemMax;
    }

    // PRIORITY 3: Fallback to AI Estimate if available
    if (aiTotal > 0) {
      console.log(`[BUDGET Q${qNum}] 🥉 Fallback to AI Estimate: ${aiTotal}`);
      return aiTotal;
    }

    return 0; // Unknown
  }
}
