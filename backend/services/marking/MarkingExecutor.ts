/**
 * Marking Executor Service
 * Final Polish: Single Source of Truth for Zones
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { ModelType, MarkingTask, EnrichedAnnotation, MathBlock } from '../../types/index.js';
import type { QuestionResult } from '../../types/marking.js';
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { MarkingPositioningService } from './MarkingPositioningService.js';
import { sanitizeAiLineId, generateDiagnosticTable } from './MarkingHelpers.js';
import { sanitizeAnnotations } from './MarkingSanitizer.js';
import { MarkingZoneService } from './MarkingZoneService.js';

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
    const normalizeLaTeXSingleLetter = (text: string): string => {
      const trimmed = text.trim();
      const singleLetterMatch = trimmed.match(/^\\?\(?\s*\$?\s*([A-Z])\s*\$?\s*\\?\)?$/);
      if (singleLetterMatch) return singleLetterMatch[1];
      return trimmed;
    };

    let stepsDataForMapping: Array<{
      line_id: string;
      pageIndex: number;
      globalBlockId?: string;
      text: string;
      cleanedText: string;
      bbox: [number, number, number, number];
      ocrSource?: string;
      isHandwritten?: boolean;
    }>;

    // --- 1. DATA MAPPING ---
    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        let bbox: [number, number, number, number] = [0, 0, 0, 0];
        let pageIdx = -1;

        const lineData = (result as any).lineData;
        const coords = lineData?.coordinates || lineData?.position;

        if (coords?.x != null && coords?.y != null) {
          bbox = [coords.x, coords.y, coords.width, coords.height];
          pageIdx = lineData?.pageIndex != null ? lineData.pageIndex : (task.sourcePages[0] || 0);
        } else {
          let matchingBlock = task.mathBlocks.find(block => {
            const blockId = (block as any).globalBlockId || `${(block as any).pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
            return blockId === result.blockId;
          });

          if (matchingBlock?.coordinates?.x != null) {
            bbox = [matchingBlock.coordinates.x, matchingBlock.coordinates.y, matchingBlock.coordinates.width, matchingBlock.coordinates.height];
            pageIdx = (matchingBlock as any).pageIndex != null ? (matchingBlock as any).pageIndex : (task.sourcePages[0] || 0);
          }
        }

        if (pageIdx === -1 && lineData && typeof lineData.pageIndex === 'number') {
          pageIdx = lineData.pageIndex;
        }
        if (pageIdx === -1) {
          pageIdx = (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);
        }

        const ocrSource = result.source || 'classification';

        return {
          line_id: (result as any).sequentialId || `p${pageIdx}_q${questionId}_line_${stepIndex + 1}`,
          pageIndex: pageIdx,
          globalBlockId: result.blockId,
          text: result.content,
          lineId: result.blockId,
          cleanedText: result.content.trim(),
          bbox: bbox,
          ocrSource: ocrSource,
          isHandwritten: true,
          unit: (result as any).source === 'classification' ? 'percentage' : 'pixels'
        };
      }).filter((step) => {
        if (step.text.includes('[DRAWING]')) return true;
        return !(step.bbox[0] === 0 && step.bbox[1] === 0 && step.bbox[2] === 0 && step.bbox[3] === 0);
      });

      const ocrStepsForMapping = task.mathBlocks
        .filter(block => block.isHandwritten !== false)
        .map((block, ocrIdx) => {
          const blockId = (block as any).globalBlockId || `block_${task.sourcePages[0] || 0}_${ocrIdx}`;
          const rawText = block.mathpixLatex || block.googleVisionText || '';
          const normalizedText = normalizeLaTeXSingleLetter(rawText);
          const blockPageIndex = (block as any).pageIndex ?? task.sourcePages[0] ?? 0;

          return {
            line_id: `p${blockPageIndex}_ocr_${ocrIdx + 1}`,
            pageIndex: blockPageIndex as number,
            globalBlockId: blockId as string,
            text: normalizedText,
            cleanedText: normalizedText,
            bbox: (block.coordinates ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height] : [0, 0, 0, 0]) as [number, number, number, number],
            ocrSource: block.ocrSource as string | undefined,
            isHandwritten: block.isHandwritten as boolean | undefined,
            unit: 'pixels'
          };
        });
      stepsDataForMapping = [...stepsDataForMapping, ...ocrStepsForMapping];

    } else {
      stepsDataForMapping = task.mathBlocks.map((block, stepIndex) => {
        const rawText = block.mathpixLatex || block.googleVisionText || '';
        return {
          line_id: `p${((block as any).pageIndex ?? task.sourcePages[0] ?? 0)}_q${questionId}_line_${stepIndex + 1}`,
          pageIndex: ((block as any).pageIndex ?? task.sourcePages[0] ?? 0) as number,
          globalBlockId: (block as any).globalBlockId as string | undefined,
          text: normalizeLaTeXSingleLetter(rawText),
          cleanedText: normalizeLaTeXSingleLetter(rawText),
          bbox: (block.coordinates ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height] : [0, 0, 0, 0]) as [number, number, number, number],
          ocrSource: block.ocrSource as string | undefined,
          isHandwritten: block.isHandwritten as boolean | undefined,
          unit: 'pixels'
        };
      });
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

    const primaryPageDims = task.pageDimensions?.get(task.sourcePages?.[0] || 0);
    const pageHeightForZones = primaryPageDims?.height || 2000;

    let classificationExpected: Array<{ label: string; text: string }> = deriveExpectedQuestionsFromClassification(task);

    const IGNORED_KEYS = [
      'id', 'examdetails', 'totalquestions', 'totalmarks', 'confidence', 'generalmarkingguidance',
      'questionmarks', 'parentquestionmarks', 'questionnumber', 'questiondetection', 'databasequestiontext',
      'subquestionnumbers', 'subquestionanswers', 'isgeneric', 'sourceimageindex', 'classificationblocks',
      'aisegmentationresults', 'subquestionmetadata', 'linecounter', 'pageindex',
      'subquestionmaxscores', 'subquestiontexts'
    ];

    const schemeObj = task.markingScheme as any;
    const subQuestionLabels = schemeObj?.subQuestionMaxScores ? Object.keys(schemeObj.subQuestionMaxScores) :
      schemeObj?.allQuestions ? Object.keys(schemeObj.allQuestions) : [];

    const schemeExpected = subQuestionLabels
      .map(rawLabel => {
        const label = rawLabel.startsWith(String(questionId)) ? rawLabel : `${questionId}${rawLabel}`;
        return label;
      })
      .filter(label => {
        const base = label.replace(/\D/g, '');
        return base === String(questionId) || label.startsWith(String(questionId));
      })
      .map(label => {
        const rawLabel = label.startsWith(String(questionId)) ? label.substring(String(questionId).length) : label;
        const questionText = (schemeObj?.subQuestionTexts?.[label]) || (schemeObj?.allQuestions?.[label]) ||
          (schemeObj?.subQuestionTexts?.[rawLabel]) || (schemeObj?.allQuestions?.[rawLabel]) || "";
        return { label, text: questionText };
      }).filter(q => q.label.length > 0 && !IGNORED_KEYS.includes(q.label.toLowerCase()));

    let expectedQuestions: Array<{ label: string; text: string; targetPageIndex?: number }> = [];

    if (schemeExpected.length > 0) {
      expectedQuestions = schemeExpected.map(q => {
        const matchBlock = task.classificationBlocks?.find(cb => {
          const cbPart = (cb as any).part || (cb as any).blockId?.split('_').pop();
          const qPartOnly = q.label.startsWith(String(questionId)) ? q.label.substring(String(questionId).length) : q.label;
          return cbPart === q.label || cbPart === qPartOnly;
        });

        if (matchBlock && (matchBlock as any).pageIndex !== undefined) {
          return { ...q, targetPageIndex: (matchBlock as any).pageIndex };
        }
        return q;
      });

    } else {
      const blockDerived = task.classificationBlocks
        ?.filter(cb => (cb as any).questionNumber === questionId || (cb as any).part)
        .map(cb => {
          let label = (cb as any).part || questionId;
          const qNumRegex = /^[a-z]{1,2}$/i;
          if (label !== questionId && (qNumRegex.test(label) || label.length === 1)) {
            label = `${questionId}${label}`;
          }
          return {
            label,
            text: (cb as any).text || "",
            targetPageIndex: (cb as any).pageIndex
          };
        });

      if (blockDerived && blockDerived.length > 0) {
        console.log(`   🏛️ [ZONE-STRATEGY] Fallback to Mapper Truth. Found ${blockDerived.length} blocks.`);
        expectedQuestions = blockDerived;
      } else {
        console.log(`   🤖 [ZONE-STRATEGY] Generic Loop. Using ${classificationExpected.length} Classification-derived zones.`);
        expectedQuestions = classificationExpected;
      }
    }

    const rawOcrBlocksForZones = task.mathBlocks.map((block) => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      coordinates: block.coordinates,
      pageIndex: (block as any).pageIndex ?? 0
    }));

    let nextQuestionText = task.nextQuestionText;

    if (!nextQuestionText) {
      const blocks = task.classificationBlocks || [];
      const currentBlockIdx = blocks.findIndex(b =>
        (b as any).questionNumber === questionId ||
        (b as any).part === questionId ||
        (b as any).subQuestions?.some((sq: any) => sq.part === questionId || sq.questionNumber === questionId)
      );

      if (currentBlockIdx !== -1 && currentBlockIdx < blocks.length - 1) {
        const nextBlock = blocks[currentBlockIdx + 1];
        nextQuestionText = (nextBlock as any).text;
      } else {
        const allQs = schemeObj?.allQuestions ? Object.keys(schemeObj.allQuestions) : [];
        const currentIdx = allQs.indexOf(String(questionId));
        if (currentIdx !== -1 && currentIdx < allQs.length - 1) {
          const nextQ = allQs[currentIdx + 1];
          nextQuestionText = (schemeObj.allQuestions[nextQ] || schemeObj.subQuestionTexts?.[nextQ] || "");
        }
      }
    }

    // 🌟 SINGLE SOURCE OF TRUTH: CALCULATE ZONES ONCE
    const semanticZones = MarkingPositioningService.detectSemanticZones(
      rawOcrBlocksForZones,
      pageHeightForZones,
      expectedQuestions,
      nextQuestionText
    );

    Object.entries(semanticZones).forEach(([key, zones]) => {
      zones.forEach(z => {
        if (isNaN(z.startY) || isNaN(z.endY)) {
          console.log(`\x1b[31m[ZONE-NaN-DEBUG] Q${questionId} Zone "${key}" has NaN: startY=${z.startY}, endY=${z.endY}, page=${z.pageIndex}\x1b[0m`);
        }
      });
    });

    const rawOcrBlocks = [
      ...task.mathBlocks.map((block, idx) => {
        const globalId = (block as any).globalBlockId || `p${(block as any).pageIndex ?? 0}_ocr_${idx}`;
        return {
          ...block,
          id: globalId,
          text: block.mathpixLatex || block.googleVisionText || '',
          pageIndex: (block as any).pageIndex ?? 0,
          coordinates: block.coordinates,
          isHandwritten: !!block.isHandwritten,
          subQuestions: (block as any).subQuestions
        };
      })
    ];

    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));

    const markingInputs = {
      imageData: task.imageData || '',
      images: task.images,
      model: model,
      processedImage: {
        ocrText: ocrTextForPrompt,
        boundingBoxes: stepsDataForMapping.map(step => {
          const stepPageDims = task.pageDimensions?.get(step.pageIndex) || { width: 1000, height: 1000 };
          const ppt = CoordinateTransformationService.toPPT(step.bbox, stepPageDims.width, stepPageDims.height);
          return { x: ppt.x, y: ppt.y, width: ppt.width, height: ppt.height, text: step.text };
        }),
        cleanDataForMarking: { steps: stepsDataForMapping },
        cleanedOcrText: ocrTextForPrompt,
        rawOcrBlocks: rawOcrBlocks,
        classificationStudentWork: ocrTextForPrompt,
        classificationBlocks: task.classificationBlocks,
        subQuestionMetadata: task.subQuestionMetadata,
        // Still needed for prompt context, but NOT for Logic anymore
        landmarks: Object.entries(semanticZones).flatMap(([label, zones]) =>
          zones.map(data => ({
            label,
            y: data.startY,
            endY: data.endY,
            x: data.x,
            top: data.startY,
            left: data.x,
            pageIndex: data.pageIndex
          }))
        )
      } as any,
      questionDetection: task.markingScheme,
      questionText: task.markingScheme?.databaseQuestionText || null,
      questionNumber: String(questionId),
      allPagesOcrData: allPagesOcrData,
      sourceImageIndices: task.sourcePages,
      tracker: tracker,
      generalMarkingGuidance: task.markingScheme?.generalMarkingGuidance
    };

    const markingResult = await MarkingInstructionService.executeMarking(markingInputs);

    if (markingResult.annotations) {
      let instructionHeatMap: Set<string> | undefined;
      try {
        instructionHeatMap = MarkingZoneService.generateInstructionHeatMap(
          markingInputs.processedImage.rawOcrBlocks,
          expectedQuestions,
          nextQuestionText
        );
      } catch (e) {
        console.warn(`⚠️ [MARKING-EXECUTOR] Failed to generate instruction heat map:`, e);
      }

      markingResult.annotations = sanitizeAnnotations(
        markingResult.annotations,
        markingInputs.processedImage.rawOcrBlocks,
        instructionHeatMap
      );
    }

    if (markingResult.annotations) {
      const aiStatusMap = new Map<string, string>();
      (markingResult.annotations || []).forEach((a: any) => {
        if (a.line_id) aiStatusMap.set(a.line_id, a.ocr_match_status);
      });

      const pageDims = task.pageDimensions?.get(task.sourcePages?.[0] || 0);
      const pageHeight = pageDims?.height || 2000;

      // 🛡️ [FIX]: PASS semanticZones DIRECTLY (Single Source of Truth)
      markingResult.annotations = resolveLinksWithZones(
        markingResult.annotations,
        semanticZones, // <--- Passing the Full Object
        markingInputs.processedImage.rawOcrBlocks,
        pageHeight
      );

      markingResult.annotations.forEach((a: any) => {
        if (a.line_id && aiStatusMap.has(a.line_id)) {
          a.ai_raw_status = aiStatusMap.get(a.line_id);
        }
        if (!a.ai_raw_status) a.ai_raw_status = 'UNKNOWN';
      });
    }

    const rawAnnotationsFromAI = JSON.parse(JSON.stringify(markingResult.annotations || []));

    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
      throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    const explodedAnnotations: any[] = [];
    (markingResult.annotations || []).forEach((anno: any) => {
      const cleaned = (anno.text || '').replace(/,/g, ' ').trim();
      const parts = cleaned.split(/\s+/);

      if (parts.length > 1 && parts.every(p => /^[A-Z]+\d+$/.test(p))) {
        console.warn(`   ⚠️ [CLUMP-SPLIT] Splitting "${anno.text}" into ${parts.length} atoms early.`);
        parts.forEach(part => {
          explodedAnnotations.push({
            ...anno,
            text: part,
            ocr_match_status: anno.ocr_match_status,
            line_id: anno.line_id?.startsWith('visual_redirect_')
              ? `${anno.line_id}_${Math.random().toString(36).substr(2, 5)}`
              : (anno.line_id || anno.lineId)
          });
        });
      } else {
        explodedAnnotations.push(anno);
      }
    });

    let correctedAnnotations = explodedAnnotations.map(anno => {
      const currentId = sanitizeAiLineId(anno.line_id || anno.lineId || "");
      anno.line_id = currentId;

      const sourceStep = stepsDataForMapping.find(s => s.line_id === currentId || s.globalBlockId === currentId);

      if (sourceStep && sourceStep.pageIndex !== undefined) {
        if (anno.pageIndex !== sourceStep.pageIndex) anno.pageIndex = sourceStep.pageIndex;
      } else if (task.sourcePages?.length === 1) {
        anno.pageIndex = task.sourcePages[0];
      }

      const isPrinted = !sourceStep || sourceStep.isHandwritten === false;
      if (isPrinted) {
        const isDrawing = (anno as any).ocr_match_status === 'VISUAL' || (anno.text || '').includes('[DRAWING]') || (anno.reasoning && (anno.reasoning.includes('[DRAWING]') || anno.reasoning.includes('plan')));

        if (anno.subQuestion === "11a") {
          console.log(`[IRON-DOME-DEBUG] Q11a Annotation: Status=${(anno as any).ocr_match_status}, Text="${anno.text}", IsDrawing=${isDrawing}`);
        }

        if (!isDrawing) {
          const clean = (str: string) => str.toLowerCase()
            .replace(/[\s\\]/g, '')
            .replace(/frac|sqrt|times|div/g, '')
            .replace(/[(){}\[\]]/g, '');

          if (anno.subQuestion === "11a") {
            console.log(`[LINKER-DEBUG] Q11a Text: "${anno.text}" | ID: ${anno.line_id} | Drawing? NO (Proceeding to Fuzzy Match)`);
          }

          const targetText = clean(anno.studentText || anno.text || "");
          if (targetText.length > 0) {
            let betterMatch = stepsDataForMapping.find(s =>
              s.line_id.startsWith('block_') && s.isHandwritten !== false && clean(s.text) === targetText
            ) || stepsDataForMapping.find(s =>
              s.line_id.startsWith('block_') && s.isHandwritten !== false && clean(s.text).includes(targetText)
            );

            if (!betterMatch) {
              const numbers = targetText.match(/\d+/g);
              if (numbers && numbers.length > 0) {
                betterMatch = stepsDataForMapping.find(s =>
                  s.line_id.startsWith('block_') && s.isHandwritten !== false && numbers.every(n => clean(s.text).includes(n))
                );
              }
            }

            if (betterMatch) {
              (anno as any).aiMatchedId = currentId;
              anno.line_id = betterMatch.line_id;
              anno.pageIndex = betterMatch.pageIndex;
            }
          }
        }
      }
      return anno;
    });

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
      ...rawOcrBlocks.map(block => {
        const blockPageIdx = (block as any).pageIndex ?? 0;
        return {
          line_id: (block as any).id,
          pageIndex: blockPageIdx,
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
        };
      })
    ];

    task.classificationBlocks?.filter(cb => (cb as any).questionNumber === "2" || (cb as any).part?.startsWith("2")).forEach(cb => {
      console.log(`\x1b[35m[MAPPER-BOX-DEBUG] Q${questionId} | Block: ${(cb as any).id} | Box: ${JSON.stringify((cb as any).box || (cb as any).coordinates)}\x1b[0m`);
    });

    let enrichedAnnotations = enrichAnnotationsWithPositions(
      correctedAnnotations,
      combinedLookupBlocks,
      String(questionId),
      defaultPageIndex,
      task.pageDimensions,
      task.classificationBlocks,
      task,
      (markingResult as any).visualObservation,
      (markingResult as any).globalOffsetX || 0,
      (markingResult as any).globalOffsetY || 0,
      semanticZones // <--- Identical Source
    ).filter((anno: any) => (anno.text || '').trim() !== '');

    const bestMarks = new Set<string>();
    enrichedAnnotations.forEach(a => {
      const text = (a.text || '').trim();
      const isMath = /[\\{}=]/.test(text) || text.includes('sqrt');
      const val = isMath ? 1 : (parseInt(text.replace(/\D/g, '') || '0'));
      if (val > 0) bestMarks.add(a.subQuestion || 'main');
    });

    enrichedAnnotations = enrichedAnnotations.filter(anno => {
      const subQ = anno.subQuestion || 'main';
      const text = (anno.text || '').trim();
      const isMath = /[\\{}=]/.test(text) || text.includes('sqrt');
      const isZero = !isMath && (parseInt(text.replace(/\D/g, '') || '0') === 0);

      if (isZero && bestMarks.has(subQ)) {
        return false;
      }
      return true;
    });

    enrichedAnnotations.forEach(anno => {
      const pIdx = anno.pageIndex ?? task.sourcePages?.[0] ?? 0;
      let dims = task.pageDimensions?.get(pIdx);

      if (!dims && task.pageDimensions && task.pageDimensions.size > 0) {
        dims = Array.from(task.pageDimensions.values())[0];
      }

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

      if (!anno.visual_position) {
        anno.visual_position = { x: 50, y: 50, width: 10, height: 10 };
      }
    });

    const sanitizedAnnotations = enrichedAnnotations;

    const parsedScore: any = parseScore(markingResult.studentScore);

    if (parsedScore.awardedMarks === 0 && sanitizedAnnotations.length > 0) {
      const hasTicks = sanitizedAnnotations.some(a =>
        (a.action && !a.action.includes('cross')) ||
        (a.text && !a.text.includes('0') && !a.text.toLowerCase().includes('lost'))
      );
      if (hasTicks) {
        const count = sanitizedAnnotations.filter(a => !a.action?.includes('cross')).length;
        const budget = parsedScore.totalMarks || (task.markingScheme?.totalMarks ? Number(task.markingScheme.totalMarks) : 99);
        parsedScore.awardedMarks = Math.min(count, budget);
      }
    }

    const debug11a = sanitizedAnnotations.filter(a => a.subQuestion === "11a");
    if (debug11a.length > 0) {
      console.log(`[OUTPUT-DEBUG] Q11a Final Output:`);
      debug11a.forEach(a => console.log(`   - Text: "${a.text}" | Status: ${(a as any).ocr_match_status} | ID: ${(a as any).line_id || "NULL"} | Pos: ${JSON.stringify(a.visual_position)}`));
    }

    if (parsedScore.totalMarks === 0 && task.markingScheme?.totalMarks) {
      parsedScore.totalMarks = Number(task.markingScheme.totalMarks);
    }

    parsedScore.scoreText = `${parsedScore.awardedMarks}/${parsedScore.totalMarks}`;

    return {
      questionNumber: questionId,
      score: parsedScore,
      annotations: sanitizedAnnotations,
      pageIndex: task.sourcePages?.[0] ?? 0,
      usageTokens: markingResult.usage?.llmTokens || 0,
      inputTokens: markingResult.usage?.llmInputTokens || 0,
      outputTokens: markingResult.usage?.llmOutputTokens || 0,
      mathpixCalls: 0,
      confidence: 0.9,
      markingScheme: task.markingScheme,
      studentWork: (markingResult as any).cleanedOcrText || task.classificationStudentWork,
      databaseQuestionText: task.markingScheme?.databaseQuestionText || task.questionText,
      promptMarkingScheme: (markingResult as any).schemeTextForPrompt,
      overallPerformanceSummary: (markingResult as any).overallPerformanceSummary,
      rawAnnotations: rawAnnotationsFromAI,
      semanticZones: semanticZones // ✅ PASSED THROUGH
    };

  } catch (error) {
    console.error(`Error executing marking for Q${questionId}:`, error);
    throw error;
  }
}

// ... (flattenQuestionTree, createMarkingTasksFromClassification, parseScore remain unchanged) ...
function flattenQuestionTree(node: any): any[] {
  let list = [node];
  if (node.subQuestions && Array.isArray(node.subQuestions)) {
    node.subQuestions.forEach((sub: any) => {
      sub.pageIndex = sub.pageIndex ?? node.pageIndex;
      list = list.concat(flattenQuestionTree(sub));
    });
  }
  return list;
}

export function createMarkingTasksFromClassification(
  classificationResult: any,
  allPagesOcrData: any[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>,
  standardizedPages: any[],
  mapperResults?: any[]
): MarkingTask[] {
  const tasks: MarkingTask[] = [];
  const globalIdCounter = { val: 1 };

  if (!classificationResult?.questions) return tasks;

  if (process.env.DEBUG_RAW_CLASSIFICATION_RESPONSE === 'true') {
  }

  const questionGroups = new Map<string, any>();

  for (const q of classificationResult.questions) {
    const baseQNum = getBaseQuestionNumber(String(q.questionNumber || ''));
    if (!baseQNum) continue;

    const groupingKey = baseQNum;
    const sourceImageIndices = q.sourceImageIndices && q.sourceImageIndices.length > 0 ? q.sourceImageIndices : [q.sourceImageIndex ?? 0];

    let anchorMainPage = sourceImageIndices[0] ?? 0;
    if (allPagesOcrData) {
      const snippet = q.text ? q.text.replace(/\n/g, ' ').substring(0, 25).trim() : null;
      if (snippet && snippet.length > 5) {
        for (const page of allPagesOcrData) {
          const match = page.ocrData?.mathBlocks?.some((b: any) => (b.mathpixLatex || b.googleVisionText || '').includes(snippet));
          if (match) { anchorMainPage = page.pageIndex; break; }
        }
      }
    }

    if (!sourceImageIndices.includes(anchorMainPage)) sourceImageIndices.unshift(anchorMainPage);
    else if (sourceImageIndices[0] !== anchorMainPage) {
      const idx = sourceImageIndices.indexOf(anchorMainPage);
      sourceImageIndices.splice(idx, 1);
      sourceImageIndices.unshift(anchorMainPage);
    }

    let markingScheme = null;
    for (const [key, scheme] of markingSchemesMap.entries()) {
      if (key.startsWith(`${baseQNum}_`) && key.split('_')[0] === baseQNum) {
        markingScheme = scheme;
        break;
      }
    }

    if (!questionGroups.has(groupingKey)) {
      questionGroups.set(groupingKey, {
        mainQuestion: q,
        mainStudentWorkParts: [],
        classificationBlocks: [],
        subQuestions: [],
        markingScheme: markingScheme,
        baseQNum: baseQNum,
        sourceImageIndices: sourceImageIndices,
        aiSegmentationResults: [],
        subQuestionPageMap: {},
        subQuestionMetadata: { hasSubQuestions: false, subQuestions: [] },
        lineCounter: 1
      });
    } else {
      const group = questionGroups.get(groupingKey);
      const combined = [...new Set([...group.sourceImageIndices, ...sourceImageIndices])].sort();
      group.sourceImageIndices = combined;
    }

    const group = questionGroups.get(groupingKey);
    const currentQPageIndex = anchorMainPage;
    (q as any).pageIndex = currentQPageIndex;

    group.classificationBlocks.push(q);

    const allNodes = flattenQuestionTree(q);

    allNodes.forEach((node: any) => {
      const blockId = `class_block_${baseQNum}_${node.part || 'main'}`;
      const nodeBox = node.box || node.region || node.rect || node.coordinates;

      if (nodeBox) {
        group.classificationBlocks.push({
          id: blockId,
          blockId: blockId,
          text: node.text || '',
          box: nodeBox,
          pageIndex: node.pageIndex ?? currentQPageIndex,
          part: node.part || 'main'
        });
      }

      const IGNORED_METADATA_KEYS = [
        'id', 'examdetails', 'totalquestions', 'totalmarks', 'confidence', 'generalmarkingguidance',
        'questionmarks', 'parentquestionmarks', 'questionnumber', 'questiondetection', 'databasequestiontext',
        'subquestionnumbers', 'subquestionanswers', 'isgeneric', 'sourceimageindex', 'classificationblocks',
        'aisegmentationresults', 'subquestionmetadata', 'linecounter', 'pageindex'
      ];

      if (node.part && node.part !== 'main') {
        const isGarbage = IGNORED_METADATA_KEYS.includes(node.part.toLowerCase());

        if (!isGarbage) {
          group.subQuestionMetadata.hasSubQuestions = true;
          group.subQuestionMetadata.subQuestions.push({
            part: node.part,
            text: node.text || ''
          });
        }
      } else if (!node.part || node.part === 'main') {
        (group.subQuestionMetadata as any).mainText = node.text || '';
      }

      if (node.studentWorkLines) {
        node.studentWorkLines.forEach((l: any) => {
          if (l.text === '[DRAWING]') return;
          const pIdx = l.pageIndex ?? node.pageIndex ?? currentQPageIndex;
          l.pageIndex = pIdx;

          const globalId = `p${pIdx}_q${baseQNum}_line_${group.lineCounter++}`;

          l.id = globalId;
          l.lineId = globalId;

          group.aiSegmentationResults.push({
            content: l.text,
            source: 'classification',
            blockId: globalId,
            lineData: { ...l, id: globalId, lineId: globalId },
            sequentialId: globalId,
            subQuestionLabel: node.part || 'main'
          });
        });
      }
      if (node.hasStudentDrawing) {
        if (!node.studentWorkLines) node.studentWorkLines = [];
        if (!node.studentWorkLines.some((l: any) => l.text === '[DRAWING]')) {
          const pIdx = node.pageIndex ?? currentQPageIndex;
          const pageDim = pageDimensionsMap.get(pIdx);
          let pos = { x: 0, y: 0, width: 0, height: 0 };
          if (node.studentDrawingPosition && pageDim) {
            pos = {
              x: (node.studentDrawingPosition.x / 100) * pageDim.width,
              y: (node.studentDrawingPosition.y / 100) * pageDim.height,
              width: (node.studentDrawingPosition.width / 100) * pageDim.width,
              height: (node.studentDrawingPosition.height / 100) * pageDim.height
            };
          }
          const lineGlobalId = `p${pIdx}_q${baseQNum}_line_drawing_${group.lineCounter++}`;
          const line = {
            id: lineGlobalId,
            text: "[DRAWING]",
            pageIndex: pIdx,
            position: pos
          };
          node.studentWorkLines.push(line);
          group.aiSegmentationResults.push({
            content: "[DRAWING]",
            source: "classification",
            blockId: lineGlobalId,
            lineData: line,
            sequentialId: lineGlobalId,
            subQuestionLabel: node.part || 'main'
          });
        }
      }
    });

    if (q.subQuestions) {
      group.subQuestions.push(...q.subQuestions);
    }
  }

  const sortedQuestionGroups = Array.from(questionGroups.entries()).sort((a, b) => {
    const numA = parseInt(String(a[0]).replace(/\D/g, '')) || 0;
    const numB = parseInt(String(b[0]).replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  sortedQuestionGroups.forEach(([baseQNum, group], idx) => {
    let allOcrBlocks: MathBlock[] = [];
    group.sourceImageIndices.forEach((pageIndex: number) => {
      const pageOcr = allPagesOcrData.find(d => d.pageIndex === pageIndex);
      let ocrIdx = 0;

      if (pageOcr?.ocrData?.mathBlocks) {
        pageOcr.ocrData.mathBlocks.forEach((b: any) => {
          b.pageIndex = pageIndex;
          b.globalBlockId = `p${pageIndex}_ocr_${ocrIdx++}`;
          allOcrBlocks.push(b);
        });
      }

      if (pageOcr?.ocrData?.blocks) {
        pageOcr.ocrData.blocks.forEach((b: any) => {
          b.pageIndex = pageIndex;
          b.globalBlockId = `block_${pageIndex}_${ocrIdx++}`;
          allOcrBlocks.push(b);
        });
      }
    });

    let promptMainWork = "";
    let currentHeader = "";
    group.aiSegmentationResults.forEach((seg: any, index: number) => {
      const clean = seg.content.replace(/\s+/g, ' ').trim();
      const isContentValid = clean.length > 0 && clean !== '--' && !/^[_\-\s]+$/.test(clean);
      if (isContentValid) {
        if (seg.subQuestionLabel && seg.subQuestionLabel !== currentHeader && seg.subQuestionLabel !== 'main') {
          promptMainWork += `\n[SUB-QUESTION ${seg.subQuestionLabel}]\n`;
          currentHeader = seg.subQuestionLabel;
        }
        const idTag = seg.sequentialId ? `[ID: ${seg.sequentialId}] ` : `${index + 1}. `;
        promptMainWork += `${idTag}${clean}\n`;
      }
    });

    const questionImages: string[] = [];
    group.sourceImageIndices.forEach((imageIdx: number) => {
      const page = standardizedPages.find(p => p.pageIndex === imageIdx);
      if (page?.imageData) questionImages.push(page.imageData);
    });

    let nextQuestionText: string | undefined;
    const nextGroup = sortedQuestionGroups[idx + 1];
    if (nextGroup) {
      nextQuestionText = nextGroup[1].mainQuestion.text;
    }

    tasks.push({
      questionNumber: baseQNum,
      questionText: group.mainQuestion.text,
      nextQuestionText: nextQuestionText,
      mathBlocks: allOcrBlocks,
      markingScheme: group.markingScheme,
      sourcePages: group.sourceImageIndices,
      classificationStudentWork: promptMainWork,
      classificationBlocks: group.classificationBlocks,
      pageDimensions: pageDimensionsMap,
      imageData: questionImages[0],
      images: questionImages,
      aiSegmentationResults: group.aiSegmentationResults,
      subQuestionMetadata: {
        hasSubQuestions: group.subQuestions.length > 0,
        subQuestions: group.subQuestions
      }
    });
  });

  return tasks;
}

function parseScore(scoreInput: any): { awardedMarks: number; totalMarks: number } {
  if (!scoreInput) return { awardedMarks: 0, totalMarks: 0 };

  if (typeof scoreInput === 'object') {
    const awarded = parseFloat(scoreInput.awardedMarks);
    const total = parseFloat(scoreInput.totalMarks);

    if (!isNaN(awarded) && !isNaN(total) && total > 0) {
      return { awardedMarks: awarded, totalMarks: total };
    }
  }

  const scoreStr = String(typeof scoreInput === 'object' ? (scoreInput.scoreText || scoreInput.awardedMarks || '0') : scoreInput);

  if (scoreStr.includes('/')) {
    const parts = scoreStr.split('/');
    return {
      awardedMarks: parseFloat(parts[0]) || 0,
      totalMarks: parseFloat(parts[1]) || 0
    };
  }

  const numericValue = parseFloat(scoreStr);
  return {
    awardedMarks: isNaN(numericValue) ? 0 : numericValue,
    totalMarks: 0
  };
}

/**
 * Deterministic Linker (Smart Mode):
 * 1. Audits the AI's link. If valid, keeps it.
 * 2. If invalid (or missing), hunts for the correct link using strict Zone + Value logic.
 */
function resolveLinksWithZones(
  annotations: any[],
  semanticZones: Record<string, Array<{ startY: number; endY: number; pageIndex: number; x: number }>>,
  allOcrBlocks: any[],
  pageHeight: number
): any[] {

  // Flatten landmarks for search
  let landmarks = Object.entries(semanticZones).flatMap(([label, zones]) =>
    zones.map(data => ({
      label,
      y: data.startY,
      endY: data.endY,
      pageIndex: data.pageIndex
    }))
  );

  // 🛡️ [CRITICAL] Sort landmarks physically
  landmarks = landmarks.sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return (a.pageIndex || 0) - (b.pageIndex || 0);
    return a.y - b.y;
  });

  return annotations.map(anno => {
    if (!(anno as any).ai_raw_status) {
      (anno as any).ai_raw_status = anno.ocr_match_status;
    }

    // 🚨 FIX: THE NULL-LINK TRAP
    // If AI says "MATCHED" but provides NO ID, it's a hallucination or failure.
    // Force it to "UNMATCHED" so it enters the Zone Protection (Emergency) path downstream.
    const hasId = anno.linked_ocr_id || anno.linkedOcrId || (anno.line_id && !anno.line_id.startsWith('p'));
    if (anno.ocr_match_status === "MATCHED" && !hasId) {
      console.log(`   🛡️ [IRON-DOME-TRAP] ${anno.subQuestion}: Status is MATCHED but ID is NULL. Downgrading to UNMATCHED to force Zone Protection.`);
      anno.ocr_match_status = "UNMATCHED";
      anno.line_id = null; // Clear the semantic line ID too to prevent bad Smart Snaps
    }

    const clean = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanSubQ = clean(anno.subQuestion || ''); // e.g. "bi"

    let zone: { startY: number; endY: number } | null = null;

    // 🔍 [FIXED MATCHING LOGIC]
    // 1. Exact Match: "10bi" === "10bi"
    // 2. Container Match (Zone holds Question): "10bi".endsWith("bi") -> TRUE
    // 3. Child Match (Question extends Zone): "10bi_1".startsWith("10bi") -> TRUE
    const allMatchingLandmarks = landmarks.filter(l => {
      const L = clean(l.label); // "10bi"
      const Q = cleanSubQ;      // "bi"
      return L === Q || L.endsWith(Q) || Q.startsWith(L);
    });

    // Sort to find best fit (shortest suffix match preferred to avoid "10bii" matching "ii" over "i")
    const matchingLandmarks = allMatchingLandmarks.sort((a, b) => {
      const La = clean(a.label);
      const Lb = clean(b.label);
      return La.length - Lb.length; // Prefer shorter/exact matches
    });

    if (matchingLandmarks.length > 0) {
      const z = matchingLandmarks[0]; // Pick best fit
      zone = { startY: z.y, endY: z.endY ?? pageHeight };
      console.log(`   🎯 [ZONE-MATCH] SubQ: "${anno.subQuestion}" | Mapped to Zone "${z.label}": ${Math.round(z.y)}-${Math.round(z.endY ?? 0)}`);
    } else {
      console.log(`   ⚠️ [ZONE-MISS] No zone found for "${anno.subQuestion}" (Clean: ${cleanSubQ})`);
      // Fallback for first question or generic headers if needed
      return anno;
    }

    // =========================================================================
    // 🛡️ IRON DOME: STRICT ZONE PROTECTION
    // =========================================================================
    const physicalId = anno.linked_ocr_id || anno.linkedOcrId || (anno.line_id?.startsWith('p') && anno.line_id?.includes('_ocr_') ? anno.line_id : null);

    let markY: number | null = null;

    if (physicalId) {
      const block = allOcrBlocks.find(b => b.id === physicalId);
      if (block) {
        markY = block.coordinates?.y ??
          (Array.isArray(block.bbox) ? block.bbox[1] :
            Array.isArray(block.box) ? block.box[1] :
              block.box?.y) ?? null;
      }
    } else if (anno.ocr_match_status === "VISUAL" && anno.visual_position?.y !== undefined) {
      markY = (anno.visual_position.y / 100) * pageHeight;
    }

    if (markY !== null && zone) {
      // 🛡️ [BUFFER] Add 5% tolerance to prevent vetoing borderline cases
      const buffer = (zone.endY - zone.startY) * 0.05;
      const inZone = markY >= (zone.startY - buffer) && markY <= (zone.endY + buffer);

      if (!inZone) {
        console.log(`   ⚖️ [IRON-DOME-VETO] Violation detected for ${anno.subQuestion} (ID: ${physicalId || 'VISUAL'}).`);
        console.log(`      📍 Position: Y=${Math.round(markY)}px | Allowed Zone: ${Math.round(zone.startY)}-${Math.round(zone.endY)}px`);

        return {
          ...anno,
          ocr_match_status: "UNMATCHED", // Force Unmatched so Enrichment uses offsets
          linked_ocr_id: null,
          _pipeline_action: "IRON DOME VETO (ZONE_MISMATCH)",
          _iron_dome_veto: true
        };
      }
    }

    return anno;
  });
}

/**
 * Calculates the Levenshtein distance between two strings.
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = (s1[i - 1] === s2[j - 1]) ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function isExactValueMatch(ocrText: string, studentText: string): boolean {
  if (!studentText || !ocrText) return false;

  const clean = (str: string) => str.toLowerCase()
    .replace(/[\s\\]/g, '')
    .replace(/frac|sqrt|times|div|rightarrow|Rightarrow|approx/g, '')
    .replace(/[(){}\[\]\/]/g, '');

  const sClean = clean(studentText);
  const oClean = clean(ocrText);

  if (sClean === oClean) return true;
  if (oClean.includes(sClean)) return true;

  const sDigits = sClean.replace(/[^0-9]/g, '');
  const oDigits = oClean.replace(/[^0-9]/g, '');

  if (sDigits.length > 0 && sDigits === oDigits) {
    const dist = levenshteinDistance(sClean, oClean);
    const lenientThreshold = Math.max(3, Math.ceil(sClean.length * 0.4));
    if (dist <= lenientThreshold) {
      return true;
    }
  }

  const dist = levenshteinDistance(sClean, oClean);
  const allowedEdits = sClean.length < 5 ? 0 : sClean.length < 10 ? 1 : 2;

  if (dist <= allowedEdits) {
    return true;
  }

  return false;
}

/**
 * STANDALONE HELPER: Extracts physical question structure (labels and text) from Classification data.
 * Used to guide zone detection for non-past-papers where marking schemes are generic.
 */
function deriveExpectedQuestionsFromClassification(task: MarkingTask): Array<{ label: string; text: string }> {
  const classificationExpected: Array<{ label: string; text: string }> = [];

  const traverse = (nodes: any[], parentPart: string = "") => {
    nodes.forEach(qs => {
      const currentPart = qs.part || "";
      if (qs.subQuestions && qs.subQuestions.length > 0) {
        traverse(qs.subQuestions, currentPart);
      } else {
        if (currentPart) {
          const label = currentPart.startsWith(String(task.questionNumber)) ? currentPart : `${task.questionNumber}${currentPart}`;
          classificationExpected.push({ label, text: qs.text || "" });
        }
      }
    });
  };

  if (task.subQuestionMetadata?.subQuestions) {
    traverse(task.subQuestionMetadata.subQuestions);
  }

  if (task.classificationBlocks) {
    task.classificationBlocks.forEach(cb => {
      let part = (cb as any).part || (cb as any).blockId?.split('_').pop();
      if (part && part !== 'main') {
        const label = part.startsWith(String(task.questionNumber)) ? part : `${task.questionNumber}${part}`;
        if (!classificationExpected.some(q => q.label === label)) {
          classificationExpected.push({ label, text: cb.text || "" });
        }
      }
    });
  }

  const baseNum = String(task.questionNumber).replace(/\D/g, '');
  if (baseNum && !classificationExpected.some(q => q.label === baseNum)) {
    classificationExpected.push({ label: baseNum, text: task.questionText || "" });
  }

  return classificationExpected.filter(q => q.label.length > 0);
}