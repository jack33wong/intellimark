import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import { MarkingTask, ModelType } from "../../types/index.js";
import type { QuestionResult } from '../../types/marking.js';
import UsageTracker from '../../utils/UsageTracker.js';

// Core Service Imports
import { MarkingTaskFactory } from './core/MarkingTaskFactory.js';
import { ZoneArchitect } from './core/ZoneArchitect.js';
import { MarkingZoneService } from './MarkingZoneService.js';
import { AnnotationLinker } from './core/AnnotationLinker.js';
import { ScoreAuditor } from './core/ScoreAuditor.js';

// Utils
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
import { sanitizeAiLineId } from './MarkingHelpers.js';

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

    // --- 1. DATA MAPPING (TYPE-SANITIZED) ---
    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        let bbox: [number, number, number, number] = [0, 0, 0, 0];

        // BBox Recovery
        const rawSource = (result as any).bbox || (result as any).position || (result as any).lineData?.coordinates || (result as any).lineData?.box || (result as any).lineData?.region;
        if (rawSource) {
          if (Array.isArray(rawSource) && rawSource.length === 4) {
            bbox = rawSource as [number, number, number, number];
          } else if (typeof rawSource.x === 'number') {
            bbox = [rawSource.x, rawSource.y, rawSource.width, rawSource.height];
          }
        } else {
          // Fallback BBox
          let matchingBlock = task.mathBlocks.find(block => block.globalBlockId === result.blockId);
          if (!matchingBlock && result.content && result.content.length > 2) {
            const cleanTarget = result.content.replace(/\s/g, '').toLowerCase();
            matchingBlock = task.mathBlocks.find(block => {
              const raw = block.mathpixLatex || (block as any).googleVisionText || '';
              const cleanRaw = raw.replace(/\s/g, '').toLowerCase();
              return cleanRaw.includes(cleanTarget) || cleanTarget.includes(cleanRaw);
            });
          }
          if (matchingBlock && matchingBlock.coordinates) {
            bbox = [matchingBlock.coordinates.x, matchingBlock.coordinates.y, matchingBlock.coordinates.width, matchingBlock.coordinates.height];
          }
        }

        // ---------------------------------------------------------
        // 🛡️ PAGE MAPPING (STRICT TYPE SAFETY)
        // ---------------------------------------------------------
        const aiPageNum = Number((result as any).pageIndex ?? 0);
        const sourcePagesNum = (task.sourcePages || []).map(p => Number(p));
        let globalPage = aiPageNum;

        // 1. TRUST-FIRST MAPPING: Extract physical page from Global ID prefix
        const idToCheck = (result as any).line_id || (result as any).id || (result as any).lineId;
        if (idToCheck && typeof idToCheck === 'string' && idToCheck.match(/^p(\d+)_/)) {
          const match = idToCheck.match(/^p(\d+)_/);
          if (match) globalPage = parseInt(match[1], 10);
        }
        // 2. FALLBACK: If ID isn't fixed yet but pageIndex is in sourcePages, trust it.
        else if (sourcePagesNum.includes(aiPageNum)) {
          globalPage = aiPageNum;
        }

        const finalId = (result as any).line_id || (result as any).lineId || (result as any).id || (result as any).sequentialId || `p${globalPage}_q${questionId}_line_${stepIndex + 1}`;

        if (globalPage !== aiPageNum) {
          console.log(` 🕵️ [STEP-PAGE-FIX] Step "${finalId}" re-mapped P${aiPageNum} -> P${globalPage}`);
        }

        return {
          line_id: finalId,
          relative_line_id: (result as any).relative_line_id,
          pageIndex: globalPage,
          globalBlockId: result.blockId || finalId,
          text: result.content,
          lineId: finalId,
          cleanedText: (result.content || '').trim(),
          bbox: bbox,
          ocrSource: result.source || 'classification',
          isHandwritten: true,
          unit: (result as any).unit || ((result as any).source === 'classification' ? 'percentage' : 'pixels'),
          subQuestionLabel: (result as any).subQuestionLabel
        };
      }).filter(step => {
        if (step.text.includes('[VISUAL WORKSPACE]') || step.text.includes('[DRAWING]')) return true;
        if (step.line_id && step.text && step.text.trim().length > 0) return true;
        return !(step.bbox[0] === 0 && step.bbox[1] === 0 && step.bbox[2] === 0 && step.bbox[3] === 0);
      });

      // OCR Steps Mapping (Same Strict Logic)
      const ocrSteps = task.mathBlocks.filter(b => b.isHandwritten !== false).map((b, i) => {
        const rawPage = Number((b as any).pageIndex ?? 0);
        const sourcePagesNum = (task.sourcePages || []).map(p => Number(p));
        let gPage = rawPage;

        if (sourcePagesNum.includes(rawPage)) {
          gPage = rawPage;
        } else if (sourcePagesNum.length > 0) {
          if (rawPage < sourcePagesNum.length) {
            gPage = sourcePagesNum[rawPage];
          } else {
            gPage = sourcePagesNum[sourcePagesNum.length - 1];
          }
        }

        const bId = (b as any).id || (b as any).globalBlockId || `p${gPage}_ocr_GEN_${i}`;
        return {
          line_id: bId,
          pageIndex: gPage,
          globalBlockId: (b as any).globalBlockId,
          text: (b as any).text || (b as any).mathpixLatex || '',
          cleanedText: (b as any).text || (b as any).mathpixLatex || '',
          bbox: b.coordinates ? [b.coordinates.x, b.coordinates.y, b.coordinates.width, b.coordinates.height] : [0, 0, 0, 0],
          ocrSource: (b as any).ocrSource,
          isHandwritten: b.isHandwritten,
          unit: 'pixels',
          hasLineData: (b as any).hasLineData,
          isSplitBlock: (b as any).isSplitBlock
        };
      });
      stepsDataForMapping = [...stepsDataForMapping, ...ocrSteps as any];

    } else {
      stepsDataForMapping = task.mathBlocks.map((b, i) => {
        const rawPage = Number((b as any).pageIndex ?? 0);
        const sourcePagesNum = (task.sourcePages || []).map(p => Number(p));
        let gPage = rawPage;
        if (sourcePagesNum.includes(rawPage)) gPage = rawPage;
        else if (sourcePagesNum.length > 0) {
          if (rawPage < sourcePagesNum.length) gPage = sourcePagesNum[rawPage];
          else gPage = sourcePagesNum[sourcePagesNum.length - 1];
        }
        return {
          line_id: `p${gPage}_q${questionId}_line_${i}`, pageIndex: gPage, globalBlockId: (b as any).globalBlockId, text: (b as any).text || (b as any).mathpixLatex || '', cleanedText: (b as any).mathpixLatex || '', bbox: b.coordinates ? [b.coordinates.x, b.coordinates.y, b.coordinates.width, b.coordinates.height] : [0, 0, 0, 0], ocrSource: (b as any).ocrSource, isHandwritten: b.isHandwritten, unit: 'pixels',
          hasLineData: (b as any).hasLineData,
          isSplitBlock: (b as any).isSplitBlock
        };
      }) as any;
    }

    // Generate Prompt
    let ocrTextForPrompt = task.classificationStudentWork || "Student's Work:\n";
    if (ocrTextForPrompt.length < 15 && task.aiSegmentationResults?.length > 0) {
      task.aiSegmentationResults.forEach((result, index) => {
        const clean = result.content.replace(/\s+/g, ' ').trim();
        if (clean && clean !== '--') {
          // [TRUTH-FIRST]: Only use the physical ID or the sequential ID.
          const id = (result as any).id || (result as any).lineId || (result as any).sequentialId || `${index + 1}`;
          const idTag = `[ID: ${id}] `;
          ocrTextForPrompt += `${idTag}${clean}\n`;
        }
      });
    }

    // --- 2. ZONE ARCHITECTURE ---
    const semanticZones = task.semanticZones || ZoneArchitect.detectAndRefineZones(task, task.pageDimensions as any);
    MarkingZoneService.backfillInjectedZones(semanticZones, stepsDataForMapping, task.pageDimensions as any);
    const allLabels = Object.keys(semanticZones);

    // --- 3. AI EXECUTION ---
    // [FIXED] OCR Mapping (Same Logic)
    const rawOcrBlocks = task.mathBlocks.map((block, idx) => {
      const rawPage = Number((block as any).pageIndex ?? 0);
      const sourcePagesNum = (task.sourcePages || []).map(p => Number(p));
      let globalPage = rawPage;

      if (sourcePagesNum.includes(rawPage)) {
        globalPage = rawPage;
      } else if (sourcePagesNum.length > 0) {
        if (rawPage < sourcePagesNum.length) {
          globalPage = sourcePagesNum[rawPage];
        } else {
          globalPage = sourcePagesNum[sourcePagesNum.length - 1];
        }
      }

      // [TRUTH-FIRST]: Prioritize globalBlockId (Physical) over others.
      const id = (block as any).globalBlockId || (block as any).id || `p${globalPage}_ocr_${idx}`;
      const text = block.text || (block as any).mathpixLatex || (block as any).latex || (block as any).content || "";
      const bbox = block.coordinates ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height] : (block as any).bbox;

      return { ...block, id: id, pageIndex: globalPage, text: text, bbox: bbox };
    });

    const rawOcrText = rawOcrBlocks.map(b => `[${b.id}]: "${b.text}"`).join('\n');
    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));

    const markingInputs = {
      imageData: task.imageData || '', images: task.images, model: model,
      processedImage: { ocrText: rawOcrText, cleanDataForMarking: { steps: stepsDataForMapping }, rawOcrBlocks: rawOcrBlocks, classificationStudentWork: ocrTextForPrompt } as any,
      questionDetection: task.markingScheme, questionText: task.markingScheme?.databaseQuestionText, questionNumber: String(questionId),
      sourceImageIndices: task.sourcePages, subQuestionPageMap: task.subQuestionPageMap, tracker: tracker
    };

    const markingResult = await MarkingInstructionService.executeMarking(markingInputs);

    // 🕵️ [DEBUG-ID-SYNC]: Inspect IDs for Q23
    if (String(questionId).includes("23")) {
      console.log(`🕵️ [DEBUG-ID-SYNC] Q23 Prompt Raw Annotations:`, JSON.stringify(markingResult.annotations.map((a: any) => ({ t: a.text, l: a.line_id, o: a.linked_ocr_id, p: a.pageIndex })), null, 2));
      const sampleBlock17 = rawOcrBlocks.find(b => b.id?.includes('ocr_17'));
      if (sampleBlock17) {
        console.log(`🕵️ [DEBUG-ID-SYNC] Q23 OCR Block 17 Raw:`, JSON.stringify(sampleBlock17));
      }
    }

    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
      throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // ========================= 🛡️ CLEAN OUTPUT =========================
    // Translation is no longer needed because IDs are Global-by-Design.
    if (markingResult.annotations) {
      const qNumStr = String(questionId);
      markingResult.annotations.forEach((anno: any) => {
        // Safe mapping of sub-question labels (Maintenance)
        // 🛡️ [LABEL-HARMONY]: Preserve the full sub-question label (e.g. "3a")
        // We no longer strip the question number to prevent lookup collisions and "Missing Red Zone" bugs.
        if (anno.subQuestion && !String(anno.subQuestion).startsWith(qNumStr)) {
          anno.subQuestion = `${qNumStr}${anno.subQuestion}`;
        }

        // Sync pageIndex from the Global ID (Ground Truth)
        // [TRUTH-FIRST]: Check all possible ID fields for the physical page prefix p{N}_
        const probeIds = [anno.line_id, (anno as any).id, (anno as any).linked_ocr_id, (anno as any).lineId];
        for (const probeId of probeIds) {
          if (typeof probeId === 'string' && probeId.match(/^p(\d+)_/)) {
            const match = probeId.match(/^p(\d+)_/);
            if (match) {
              anno.pageIndex = parseInt(match[1], 10);
              anno.isPhysicalPage = true;
              break;
            }
          }
        }
      });
    }

    // --- 4. VETO LIST ---
    const vetoList: string[] = [];
    if (task.questionText) vetoList.push(AnnotationLinker.normalizeForMatching(task.questionText));
    if (task.classificationBlocks) task.classificationBlocks.forEach(cb => cb.text && cb.text.length > 2 && vetoList.push(AnnotationLinker.normalizeForMatching(cb.text)));
    if (task.subQuestionMetadata?.subQuestions) task.subQuestionMetadata.subQuestions.forEach((sq: any) => sq.text && vetoList.push(AnnotationLinker.normalizeForMatching(sq.text)));

    // --- 5. LINKING ---
    if (markingResult.annotations) {
      markingResult.annotations = AnnotationLinker.resolveLinksWithZones(
        markingResult.annotations,
        semanticZones,
        (markingResult as any).taggedOcrBlocks || rawOcrBlocks as any[],
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

    // --- 7. POST-PROCESSING ---
    markingResult.annotations = AnnotationLinker.postProcess(
      markingResult.annotations,
      stepsDataForMapping,
      task,
      semanticZones,
      task.pageDimensions
    );

    // --- 8. ENRICHMENT ---
    const defaultPageIndex = (task.sourcePages && task.sourcePages.find(p => p !== 0)) ?? task.sourcePages?.[0] ?? 0;

    const combinedLookupBlocks = [
      ...stepsDataForMapping.map(s => {
        const isClassification = s.ocrSource === 'classification' || (s.line_id && s.line_id.includes('_line_'));
        const detectedUnit = isClassification ? 'percentage' : 'pixels';
        return {
          ...s,
          unit: s.unit || detectedUnit,
          _source: isClassification ? 'CLASSIFICATION' : 'SEGMENTED',
          hasLineData: s.hasLineData ?? !isClassification,
          isSplitBlock: s.isSplitBlock ?? false
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
        isHandwritten: block.isHandwritten,
        hasLineData: (block as any).hasLineData,
        isSplitBlock: (block as any).isSplitBlock
      }))
    ];

    /*
    // 🕵️ [COORDS-IDENTITY]: Print all OCR blocks to verify IDs vs Coordinates
    if (combinedLookupBlocks.length > 0) {
      console.log(`🕵️ [COORDS-IDENTITY] Q${questionId} OCR Pool Sample (Block 0):`, JSON.stringify(combinedLookupBlocks[0]));
      console.log(`🕵️ [COORDS-IDENTITY] Q${questionId} OCR Pool (${combinedLookupBlocks.length} blocks):`);
      combinedLookupBlocks.forEach(b => {
        if (b.line_id?.includes('ocr') || b.line_id?.includes('_line_')) {
          console.log(`   - ID: ${b.line_id.padEnd(12)} | Coords: ${JSON.stringify(b.bbox).padEnd(25)} | Text: "${(b.text || '').substring(0, 30)}" | S:${b.isSplitBlock} L:${b.hasLineData}`);
        }
      });
    }
    */

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

    // Final UI placement patch
    enrichedAnnotations.forEach(anno => {
      const pIdx = anno.pageIndex ?? task.sourcePages?.[0] ?? 0;
      let dims = task.pageDimensions?.get(pIdx);
      if (!dims && task.pageDimensions && task.pageDimensions.size > 0) dims = Array.from(task.pageDimensions.values())[0];
      if (anno.bbox && dims && dims.width > 0 && dims.height > 0) {
        if (String(task.questionNumber).includes("23") && (anno.linked_ocr_id?.includes('ocr_17') || anno.line_id?.includes('ocr_17'))) {
          console.log(`   🎯 [COORD-INTEGRITY] Block 17: BBox ${JSON.stringify(anno.bbox)}, Dims [${dims.width}x${dims.height}], PageIndex: ${pIdx}, Result:`, {
            x: (anno.bbox[0] / dims.width) * 100,
            y: (anno.bbox[1] / dims.height) * 100
          });
        }
        anno.visual_position = {
          x: (anno.bbox[0] / dims.width) * 100,
          y: (anno.bbox[1] / dims.height) * 100,
          width: (anno.bbox[2] / dims.width) * 100,
          height: (anno.bbox[3] / dims.height) * 100
        };
      } else if (!anno.visual_position && (anno as any).ai_visual_position) {
        anno.visual_position = (anno as any).ai_visual_position;
      }

      if (!anno.visual_position) {
        anno.visual_position = { x: 50, y: 50, width: 10, height: 10 };
      }

      // Zone Protection (DEPRECATED: Handled Upstream in EnrichmentService)
    });

    // --- 9. SCORING ---
    const parsedScore = ScoreAuditor.parseScore(markingResult.studentScore);
    const strictResult = ScoreAuditor.enforceStrictBudget(enrichedAnnotations, task.markingScheme);

    if (parsedScore.totalMarks === 0 && task.markingScheme?.totalMarks) {
      parsedScore.totalMarks = Number(task.markingScheme.totalMarks);
    }
    parsedScore.awardedMarks = strictResult.awardedMarks;
    parsedScore.scoreText = `${strictResult.awardedMarks}/${parsedScore.totalMarks}`;

    const cleanMarkingScheme: Record<string, any> = {};
    if (task.markingScheme) {
      const allowedKeys = [
        'marks', 'totalMarks', 'questionNumber', 'questionLevelAnswer',
        'marksWithAnswers', 'subQuestionNumbers', 'subQuestionMarks',
        'subQuestionMaxScores', 'subQuestionAnswersMap', 'subQuestionTexts',
        'hasAlternatives', 'alternativeMethod', 'parentQuestionMarks',
        'isGeneric', 'guidance', 'subQuestionMetadata'
      ];

      allowedKeys.forEach(key => {
        const source = task.markingScheme as any;
        if (source[key] !== undefined) {
          cleanMarkingScheme[key] = source[key];
        }
      });
    }

    const result = {
      questionNumber: questionId,
      score: parsedScore,
      annotations: strictResult.annotations,
      pageIndex: task.sourcePages?.[0] ?? 0,
      sourceImageIndices: task.sourcePages,
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

    return result;
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