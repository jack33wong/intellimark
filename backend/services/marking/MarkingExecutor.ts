
import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import { MarkingTask, ModelType } from "../../types/index.js";
import type { QuestionResult } from '../../types/marking.js';
import UsageTracker from '../../utils/UsageTracker.js';

// Core Service Imports
import { MarkingTaskFactory } from './core/MarkingTaskFactory.js';
import { ZoneArchitect } from './core/ZoneArchitect.js';
import { AnnotationLinker } from './core/AnnotationLinker.js';
import { ScoreAuditor } from './core/ScoreAuditor.js';

// Utils
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
import { sanitizeAiLineId } from './MarkingHelpers.js';

/**
 * Main Conductor for the marking process.
 * Refactored modularly while preserving 100% of the original logic.
 */
export async function executeMarkingForQuestion(
  task: MarkingTask,
  res: any,
  submissionId: string,
  model: ModelType = 'auto',
  allPagesOcrData?: any[],
  tracker?: UsageTracker
): Promise<QuestionResult> {

  const questionId = task.questionNumber;
  const { createProgressData } = await import('../../utils/sseUtils.js');
  const MULTI_IMAGE_STEPS = ["Input Validation", "Standardization", "Preprocessing", "OCR & Classification", "Question Detection", "Segmentation", "Marking", "Output Generation"];

  sendSseUpdate(res, createProgressData(6, `Marking Question ${questionId}...`, MULTI_IMAGE_STEPS));

  try {
    let stepsDataForMapping: any[] = [];

    // --- 1. DATA MAPPING (Standard) ---
    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        let bbox: [number, number, number, number] = [0, 0, 0, 0];
        let pageIdx = -1;
        const lineData = (result as any).lineData;
        const rawSource = (result as any).bbox || (result as any).position || (result as any).lineData?.coordinates || (result as any).lineData?.box || (result as any).lineData?.region;

        if (rawSource) {
          if (Array.isArray(rawSource) && rawSource.length === 4) {
            bbox = rawSource as [number, number, number, number];
          } else if (typeof rawSource.x === 'number') {
            bbox = [rawSource.x, rawSource.y, rawSource.width, rawSource.height];
          }
        } else {
          let matchingBlock = task.mathBlocks.find(block => {
            const blockId = (block as any).globalBlockId;
            return blockId && blockId === result.blockId;
          });
          if (!matchingBlock && result.content && result.content.length > 2) {
            const cleanTarget = result.content.replace(/\s/g, '').toLowerCase();
            matchingBlock = task.mathBlocks.find(block => {
              const blockPage = (block as any).pageIndex ?? task.sourcePages?.[0];
              if ((result as any).pageIndex !== undefined && blockPage !== (result as any).pageIndex) return false;
              const raw = block.mathpixLatex || (block as any).googleVisionText || '';
              const cleanRaw = raw.replace(/\s/g, '').toLowerCase();
              return cleanRaw.includes(cleanTarget) || cleanTarget.includes(cleanRaw);
            });
          }
          if (matchingBlock && matchingBlock.coordinates) {
            bbox = [matchingBlock.coordinates.x, matchingBlock.coordinates.y, matchingBlock.coordinates.width, matchingBlock.coordinates.height];
            if ((matchingBlock as any).pageIndex !== undefined) pageIdx = (matchingBlock as any).pageIndex;
          }
        }

        if ((result as any).pageIndex !== undefined) pageIdx = (result as any).pageIndex;
        if (pageIdx === -1 && lineData?.pageIndex !== undefined) pageIdx = lineData.pageIndex;
        if (pageIdx === -1) pageIdx = (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);

        const finalId = (result as any).line_id || (result as any).lineId || (result as any).id || (result as any).sequentialId || `p${pageIdx}_q${questionId}_line_${stepIndex + 1}`;
        return {
          line_id: finalId, pageIndex: pageIdx, globalBlockId: result.blockId || finalId, text: result.content, lineId: finalId, cleanedText: (result.content || '').trim(), bbox: bbox, ocrSource: result.source || 'classification', isHandwritten: true, unit: (result as any).unit || ((result as any).source === 'classification' ? 'percentage' : 'pixels'), subQuestionLabel: (result as any).subQuestionLabel
        };
      }).filter(step => {
        if (step.text.includes('[VISUAL WORKSPACE]') || step.text.includes('[DRAWING]')) return true;
        if (step.line_id && step.text && step.text.trim().length > 0) return true;
        return !(step.bbox[0] === 0 && step.bbox[1] === 0 && step.bbox[2] === 0 && step.bbox[3] === 0);
      });

      const ocrSteps = task.mathBlocks.filter(b => b.isHandwritten !== false).map((b, i) => ({
        line_id: `p${(b as any).pageIndex ?? 0}_ocr_${i}`, pageIndex: (b as any).pageIndex ?? 0, globalBlockId: (b as any).globalBlockId, text: (b as any).mathpixLatex || '', cleanedText: (b as any).mathpixLatex || '', bbox: b.coordinates ? [b.coordinates.x, b.coordinates.y, b.coordinates.width, b.coordinates.height] : [0, 0, 0, 0], ocrSource: (b as any).ocrSource, isHandwritten: b.isHandwritten, unit: 'pixels'
      }));
      stepsDataForMapping = [...stepsDataForMapping, ...ocrSteps as any];
    } else {
      stepsDataForMapping = task.mathBlocks.map((b, i) => ({
        line_id: `p${(b as any).pageIndex ?? 0}_q${questionId}_line_${i}`, pageIndex: (b as any).pageIndex ?? 0, globalBlockId: (b as any).globalBlockId, text: (b as any).mathpixLatex || '', cleanedText: (b as any).mathpixLatex || '', bbox: b.coordinates ? [b.coordinates.x, b.coordinates.y, b.coordinates.width, b.coordinates.height] : [0, 0, 0, 0], ocrSource: (b as any).ocrSource, isHandwritten: b.isHandwritten, unit: 'pixels'
      })) as any;
    }

    let ocrTextForPrompt = task.classificationStudentWork || "Student's Work:\n";
    if (ocrTextForPrompt.length < 15 && task.aiSegmentationResults?.length > 0) {
      task.aiSegmentationResults.forEach((result, index) => {
        const clean = result.content.replace(/\s+/g, ' ').trim();
        if (clean && clean !== '--') {
          const idTag = (result as any).sequentialId ? `[ID: ${(result as any).sequentialId}] ` : `${index + 1}. `;
          ocrTextForPrompt += `${idTag}${clean}\n`;
        }
      });
    }

    // --- 2. ZONE ARCHITECTURE ---
    const primaryPageDims = task.pageDimensions?.get(task.sourcePages?.[0] || 0);
    const pageHeight = primaryPageDims?.height || 2000;

    const semanticZones = ZoneArchitect.detectAndRefineZones(task, pageHeight);
    ZoneArchitect.backfillInjectedZones(semanticZones, stepsDataForMapping, pageHeight);

    const allLabels = Object.keys(semanticZones);

    // --- 3. AI EXECUTION ---
    const rawOcrBlocks = task.mathBlocks.map((block, idx) => {
      const id = (block as any).globalBlockId || `p${(block as any).pageIndex ?? 0}_ocr_${idx}`;
      const text = block.text || (block as any).mathpixLatex || (block as any).latex || (block as any).content || "";
      return { ...block, id: id, pageIndex: (block as any).pageIndex ?? 0, text: text };
    });

    const rawOcrText = rawOcrBlocks.map(b => `[${b.id}]: "${b.text}"`).join('\n');
    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));

    const markingInputs = {
      imageData: task.imageData || '', images: task.images, model: model,
      processedImage: { ocrText: rawOcrText, cleanDataForMarking: { steps: stepsDataForMapping }, rawOcrBlocks: rawOcrBlocks, classificationStudentWork: ocrTextForPrompt } as any,
      questionDetection: task.markingScheme, questionText: task.markingScheme?.databaseQuestionText, questionNumber: String(questionId), sourceImageIndices: task.sourcePages, tracker: tracker
    };

    const markingResult = await MarkingInstructionService.executeMarking(markingInputs);
    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
      throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // Phantom ID Sanitizer (Whitelist ALL IDs to resolve IDs reliably)
    const validLineIds = new Set([
      ...stepsDataForMapping.map(s => s.line_id),
      ...rawOcrBlocks.map(b => b.id)
    ]);

    if (markingResult.annotations) {
      markingResult.annotations.forEach((anno: any) => {
        const lid = anno.line_id || (anno as any).lineId;
        if (lid && !validLineIds.has(lid)) {
          console.warn(`⚠️ [EXECUTOR] Found phantom ID "${lid}" for Q${anno.subQuestion}. Nullifying.`);
          anno.line_id = null;
          if (!anno.visual_position) anno.visual_position = { x: 50, y: 50, width: 10, height: 10 };
        }
      });
    }

    // --- 4. VETO LIST CONSTRUCTION ---
    const vetoList: string[] = [];
    if (task.questionText) vetoList.push(AnnotationLinker.normalizeForMatching(task.questionText));
    if (task.classificationBlocks) task.classificationBlocks.forEach(cb => cb.text && cb.text.length > 2 && vetoList.push(AnnotationLinker.normalizeForMatching(cb.text)));
    if (task.subQuestionMetadata?.subQuestions) task.subQuestionMetadata.subQuestions.forEach((sq: any) => sq.text && vetoList.push(AnnotationLinker.normalizeForMatching(sq.text)));

    // --- 5. LINKING & VETO ---
    if (markingResult.annotations) {
      markingResult.annotations = AnnotationLinker.resolveLinksWithZones(
        markingResult.annotations,
        semanticZones,
        rawOcrBlocks as any[],
        pageHeight,
        vetoList,
        String(questionId),
        stepsDataForMapping,
        task.pageDimensions,
        allLabels
      );
    }

    const rawAnnotationsFromAI = JSON.parse(JSON.stringify(markingResult.annotations || []));

    // --- 6. MARK SPLITTING ---
    markingResult.annotations = AnnotationLinker.preProcess(markingResult.annotations || []);

    // --- 7. POST-PROCESSING (Path 3, Staggering, Iron Dome Snap, Fuzzy Recovery) ---
    markingResult.annotations = AnnotationLinker.postProcess(
      markingResult.annotations,
      stepsDataForMapping,
      task,
      semanticZones,
      pageHeight,
      task.pageDimensions
    );

    // --- 8. ENRICHMENT (Physics & Coordinates) ---
    const defaultPageIndex = (task.sourcePages && task.sourcePages.find(p => p !== 0)) ?? task.sourcePages?.[0] ?? 0;

    const combinedLookupBlocks = [
      ...stepsDataForMapping.map(s => {
        const isClassification = s.ocrSource === 'classification' || (s.line_id && s.line_id.includes('_line_'));
        return {
          ...s,
          unit: isClassification ? 'percentage' : 'pixels',
          _source: isClassification ? 'CLASSIFICATION' : 'SEGMENTED'
        };
      }),
      ...rawOcrBlocks.map(block => ({
        line_id: (block as any).id,
        pageIndex: (block as any).pageIndex ?? 0,
        text: block.text,
        cleanedText: block.text,
        bbox: [
          block.coordinates?.x || 0,
          block.coordinates?.y || 0,
          block.coordinates?.width || 0,
          block.coordinates?.height || 0
        ] as [number, number, number, number],
        unit: 'pixels',
        _source: 'RESCUE_RAW',
        isHandwritten: block.isHandwritten
      }))
    ];

    const enrichedAnnotations = enrichAnnotationsWithPositions(
      markingResult.annotations,
      combinedLookupBlocks,
      String(questionId),
      defaultPageIndex,
      task.pageDimensions,
      task.classificationBlocks,
      task,
      (markingResult as any).visualObservation,
      (markingResult as any).globalOffsetX || 0,
      (markingResult as any).globalOffsetY || 0,
      semanticZones
    ).filter((anno: any) => (anno.text || '').trim() !== '');

    // Final UI placement patch & Final [ZONE PROTECTION]
    enrichedAnnotations.forEach(anno => {
      const pIdx = anno.pageIndex ?? task.sourcePages?.[0] ?? 0;
      let dims = task.pageDimensions?.get(pIdx);
      if (!dims && task.pageDimensions && task.pageDimensions.size > 0) dims = Array.from(task.pageDimensions.values())[0];
      if (anno.bbox && dims && dims.width > 0 && dims.height > 0) {
        anno.visual_position = {
          x: (anno.bbox[0] / dims.width) * 100,
          y: (anno.bbox[1] / dims.height) * 100,
          width: (anno.bbox[2] / dims.width) * 100,
          height: (anno.bbox[3] / dims.height) * 100
        };
      } else if (!anno.visual_position && (anno as any).ai_visual_position) {
        anno.visual_position = (anno as any).ai_visual_position;
      }
      if (!anno.visual_position) anno.visual_position = { x: 50, y: 50, width: 10, height: 10 };

      // 🛡️ [ZONE PROTECTION - ABSOLUTE FINAL CHECK]
      // Principle: Footprint-Aware Shield. Check if any part of the icon breaches the boundary.
      const zoneData = AnnotationLinker.getEffectiveZone(anno.subQuestion, semanticZones, anno.pageIndex || 0);
      if (zoneData && anno.visual_position) {
        const h = anno.visual_position.height || 10;
        const halfH = h / 2;
        const rawY = anno.visual_position.y;

        // Boundaries in Percent
        const startYPercent = (zoneData.startY / pageHeight) * 100;
        const endYPercent = (zoneData.endY / pageHeight) * 100;

        // Check against extents (Top/Bottom), not just center.
        let wasClamped = false;
        if ((rawY - halfH) < startYPercent) {
          anno.visual_position.y = startYPercent + 10; // 10% Pull-back
          wasClamped = true;
        } else if (endYPercent && (rawY + halfH) > endYPercent) {
          anno.visual_position.y = endYPercent - 10; // 10% Pull-back
          wasClamped = true;
        }

        if (wasClamped) {
          console.log(` 🛡️ [ZONE-PROTECT] Q${anno.subQuestion}: Footprint breach at Y=${rawY.toFixed(1)}% (Bottom=${(rawY + halfH).toFixed(1)}%). Clamping back 10% to ${anno.visual_position.y.toFixed(1)}%`);
        } else {
          console.log(` ✅ [ZONE-OK] Q${anno.subQuestion}: Footprint at Y=${rawY.toFixed(1)}% (Range ${(rawY - halfH).toFixed(1)}-${(rawY + halfH).toFixed(1)}%) is safe within ${startYPercent.toFixed(1)}-${endYPercent.toFixed(1)}%`);
        }
      }
    });

    // --- 9. SCORING & AUDIT (The Guillotine) ---
    const parsedScore = ScoreAuditor.parseScore(markingResult.studentScore);
    const strictResult = ScoreAuditor.enforceStrictBudget(enrichedAnnotations, task.markingScheme);

    if (parsedScore.totalMarks === 0 && task.markingScheme?.totalMarks) {
      parsedScore.totalMarks = Number(task.markingScheme.totalMarks);
    }
    parsedScore.awardedMarks = strictResult.awardedMarks;
    parsedScore.scoreText = `${strictResult.awardedMarks}/${parsedScore.totalMarks}`;

    // DB Payload Sanitization
    const cleanMarkingScheme: any = {};
    if (task.markingScheme) {
      const allowedKeys = ['marks', 'totalMarks', 'questionNumber', 'questionLevelAnswer', 'marksWithAnswers', 'subQuestionNumbers', 'subQuestionMarks', 'subQuestionMaxScores', 'subQuestionAnswersMap', 'subQuestionTexts', 'hasAlternatives', 'alternativeMethod', 'parentQuestionMarks', 'isGeneric', 'guidance', 'subQuestionMetadata'];
      allowedKeys.forEach(key => { if ((task.markingScheme as any)[key] !== undefined) cleanMarkingScheme[key] = (task.markingScheme as any)[key]; });
    }

    return {
      questionNumber: questionId,
      score: parsedScore,
      annotations: strictResult.annotations,
      pageIndex: task.sourcePages?.[0] ?? 0,
      usageTokens: markingResult.usage?.llmTokens || 0,
      inputTokens: markingResult.usage?.llmInputTokens || 0,
      outputTokens: markingResult.usage?.llmOutputTokens || 0,
      marks: parsedScore.awardedMarks,
      totalMarks: parsedScore.totalMarks,
      mathpixCalls: 0,
      confidence: 0.9,
      markingScheme: markingResult.schemeTextForPrompt || JSON.stringify(cleanMarkingScheme),
      studentWork: (markingResult as any).cleanedOcrText || task.classificationStudentWork,
      databaseQuestionText: task.markingScheme?.databaseQuestionText || task.questionText,
      questionText: markingResult.promptQuestionText || task.questionText || '',
      promptQuestionText: markingResult.promptQuestionText,
      promptMarkingScheme: markingResult.schemeTextForPrompt,
      overallPerformanceSummary: (markingResult as any).overallPerformanceSummary,
      rawAnnotations: rawAnnotationsFromAI,
      semanticZones: semanticZones
    };
  } catch (error) {
    console.error(`Error executing marking for Q${questionId}:`, error);
    throw error;
  }
}

/**
 * Task Creation Proxy
 */
export function createMarkingTasksFromClassification(
  classificationResult: any,
  allPagesOcrData: any[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>,
  standardizedPages: any[],
  allClassificationResults?: any[]
): MarkingTask[] {
  return MarkingTaskFactory.createTasksFromClassification(
    classificationResult,
    allPagesOcrData,
    markingSchemesMap,
    pageDimensionsMap,
    standardizedPages,
    allClassificationResults
  );
}