/**
 * Marking Executor Service
 * Final Polish: Single Source of Truth for Zones
 */


import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import { MarkingTask, MathBlock, ModelType } from "../../types/index.js";
import type { QuestionResult } from '../../types/marking.js';
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { CoordinateTransformationService } from './CoordinateTransformationService.js';
import { MarkingPositioningService } from './MarkingPositioningService.js';
import { sanitizeAiLineId, generateDiagnosticTable } from './MarkingHelpers.js';
import { sanitizeAnnotations } from './MarkingSanitizer.js';
import { MarkingZoneService } from './MarkingZoneService.js';
import { ZoneUtils } from '../../utils/ZoneUtils.js';

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

        // 🛡️ [FIX 1]: ROBUST BBOX EXTRACTION
        // Check every possible location where the box might be hiding
        const rawSource = (result as any).bbox ||
          (result as any).position ||
          (result as any).lineData?.coordinates ||
          (result as any).lineData?.box ||
          (result as any).lineData?.region;

        if (rawSource) {
          // Normalize Object {x,y,w,h} to Array [x,y,w,h]
          if (Array.isArray(rawSource) && rawSource.length === 4) {
            bbox = rawSource as [number, number, number, number];
          } else if (typeof rawSource.x === 'number') {
            bbox = [rawSource.x, rawSource.y, rawSource.width, rawSource.height];
          }
        }
        // Fallback: Robust BBox Rescue
        else {
          // 1. Try ID Match
          let matchingBlock = task.mathBlocks.find(block => {
            const blockId = (block as any).globalBlockId;
            return blockId && blockId === result.blockId;
          });

          // 2. If ID failed, try Fuzzy Text Match (Critical for 11c/11d)
          if (!matchingBlock && result.content && result.content.length > 2) {
            const cleanTarget = result.content.replace(/\s/g, '').toLowerCase();
            matchingBlock = task.mathBlocks.find(block => {
              const blockPage = (block as any).pageIndex ?? task.sourcePages[0];
              // Only search on the correct page if we know it
              if ((result as any).pageIndex !== undefined && blockPage !== (result as any).pageIndex) return false;

              const raw = block.mathpixLatex || block.googleVisionText || '';
              const cleanRaw = raw.replace(/\s/g, '').toLowerCase();
              return cleanRaw.includes(cleanTarget) || cleanTarget.includes(cleanRaw);
            });
          }

          if (matchingBlock && matchingBlock.coordinates) {
            bbox = [
              matchingBlock.coordinates.x,
              matchingBlock.coordinates.y,
              matchingBlock.coordinates.width,
              matchingBlock.coordinates.height
            ];
            // If we found it on a specific page, update the page index
            if ((matchingBlock as any).pageIndex !== undefined) {
              pageIdx = (matchingBlock as any).pageIndex;
            }
          }
        }

        // Determine Page Index
        if ((result as any).pageIndex !== undefined) pageIdx = (result as any).pageIndex;
        if (pageIdx === -1 && lineData?.pageIndex !== undefined) pageIdx = lineData.pageIndex;
        if (pageIdx === -1) pageIdx = (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);

        // 🛡️ [FIX 2]: ID DISCIPLINE
        // Use the explicit 'line_id' from the task. DO NOT generate new IDs using stepIndex.
        // Only fall back to generation if absolutely necessary.
        const finalId = (result as any).line_id ||
          (result as any).lineId ||
          (result as any).id ||
          (result as any).sequentialId ||
          `p${pageIdx}_q${questionId}_line_${stepIndex + 1}`; // Last resort

        const ocrSource = result.source || 'classification';

        return {
          line_id: finalId, // ✅ Trust the Task Builder ID
          pageIndex: pageIdx,
          globalBlockId: result.blockId || finalId,
          text: result.content,
          lineId: finalId,
          cleanedText: (result.content || '').trim(),
          bbox: bbox,
          ocrSource: ocrSource,
          isHandwritten: true,
          unit: (result as any).unit || ((result as any).source === 'classification' ? 'percentage' : 'pixels'),
          // 🚨 CRITICAL FIX: Pass the label so Iron Dome knows which zone this is!
          subQuestionLabel: (result as any).subQuestionLabel
        };
      }).filter((step) => {
        // 1. Always keep visual placeholders
        if (step.text.includes('[VISUAL WORKSPACE]') || step.text.includes('[DRAWING]')) return true;

        // 2. 🛡️ ORPHAN PROTECTION: Keep line if it has a valid ID and text, 
        // even if bbox is missing (0,0,0,0). 
        // The Enrichment Service will clamp it to the Question Zone later.
        if (step.line_id && step.text && step.text.trim().length > 0) return true;

        // 3. Only delete empty noise
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


    // =========================================================================
    // 🛡️ [USER DESIGN FIX] CREATE BACKFILL ZONE FROM VISUAL VOID
    // Requirement: If TaskBuilder injected a void, we MUST create a Zone.
    //              Do not check if zone exists. FORCE IT.
    // =========================================================================
    stepsDataForMapping.forEach(step => {
      // Look for the "Visual Void" we injected in TaskBuilder
      if ((step as any).ocrSource === 'system-injection') {
        const qLabel = (step as any).subQuestionLabel;
        const pIdx = step.pageIndex;

        // [DEBUG 1] Confirm we found the trigger
        console.log(`🔍 [BACKFILL-DEBUG] Found Injection Step: ${qLabel} on P${pIdx}`);

        let ceilingY = pageHeightForZones;
        Object.values(semanticZones).flat().forEach(z => {
          if (z.pageIndex === pIdx && z.startY < ceilingY && z.startY > 10 && z.label !== qLabel) {
            ceilingY = z.startY;
          }
        });

        // [DEBUG 2] Confirm the calculation
        console.log(`   📏 [BACKFILL-DEBUG] Calculated Ceiling: ${ceilingY} (Page Height: ${pageHeightForZones})`);

        if (!semanticZones[qLabel]) semanticZones[qLabel] = [];

        semanticZones[qLabel].push({
          label: qLabel,
          pageIndex: pIdx,
          startY: 0,
          endY: ceilingY,
          x: 0,
          width: 100
        } as any);

        // [DEBUG 3] Confirm the push
        console.log(`   ✅ [BACKFILL-DEBUG] Pushed Zone to semanticZones[${qLabel}]. Total Zones: ${semanticZones[qLabel].length}`);
      }
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

    // Track usage to stagger multiple marks on the same unmatched line (e.g., M1, A0)
    // This prevents them from stacking directly on top of each other.
    const unmatchedLineUsage: Record<string, number> = {};

    let correctedAnnotations = explodedAnnotations.map(anno => {
      const currentId = sanitizeAiLineId(anno.line_id || anno.lineId || "");
      anno.line_id = currentId;

      const sourceStep = stepsDataForMapping.find(s => s.line_id === currentId || s.globalBlockId === currentId);

      // 1. Standard Page Index Update (Iron Dome)
      // 🛡️ [FIX] DRAWING FREEDOM
      // For standard text, we trust the Source Step location (don't let AI hallucinate page).
      // For DRAWINGS, the source might be the Question Text (P0) while the grid is on P1.
      // So we ALLOW the AI to set the page index for drawings.
      const isDrawingLine = sourceStep?.text === '[DRAWING]' || (sourceStep as any)?.content === '[DRAWING]' || (sourceStep as any)?.source === 'system-injection';

      if (sourceStep && sourceStep.pageIndex !== undefined && !isDrawingLine) {
        if (anno.pageIndex !== sourceStep.pageIndex) anno.pageIndex = sourceStep.pageIndex;
      } else if (task.sourcePages?.length === 1 && !isDrawingLine) {
        anno.pageIndex = task.sourcePages[0];
      }

      // =======================================================================
      // 🛡️ [PATH 3: UNMATCHED] CLASSIFICATION COORDINATE RECOVERY
      // Principle: The system knows the coordinates. Use sourceStep.bbox.
      // Rule: Honesty - Do NOT change 'UNMATCHED' status.
      // =======================================================================
      if (anno.ocr_match_status === 'UNMATCHED') {
        // 1. We lookup the step using the ID
        if (sourceStep && (sourceStep.bbox || (sourceStep as any).position)) {

          const box: any = sourceStep.bbox || (sourceStep as any).position;

          // Handle both Array [x,y,w,h] and Object {x,y,width,height}
          let x = box.x !== undefined ? box.x : box[0];
          let y = box.y !== undefined ? box.y : box[1];
          let w = box.width !== undefined ? box.width : box[2];
          let h = box.height !== undefined ? box.height : box[3];

          // 🛡️ [FIX 3] UNIT NORMALIZATION (The "Top-Left" Killer)
          // If x is 0.5 (Normalized), we need 50 (Percentage). 
          // If x is 500 (Pixels), we leave it (assuming canvas is 1000).
          // Heuristic: If values are small (< 1), assume Normalized 0-1.
          const isNormalized = x <= 1 && y <= 1 && w <= 1 && h <= 1 && (x > 0 || y > 0);

          if (isNormalized) {
            console.log(`   ⚖️ [UNIT-FIX] Converting Normalized Coords to Percentage for ${currentId}`);
            x *= 100;
            y *= 100;
            w *= 100;
            h *= 100;
          }

          // 2. Stagger Logic (Prevent M1/A0 stacking on the exact same point)
          const usageKey = currentId;
          const usageCount = unmatchedLineUsage[usageKey] || 0;
          unmatchedLineUsage[usageKey] = usageCount + 1;

          // Stagger: 2% shift if using %, 15px if using pixels
          const staggerAmount = isNormalized ? 2 : 15;
          const staggerX = usageCount * staggerAmount;

          console.log(`   📍 [PATH 3] Q${anno.subQuestion}: Line "${currentId}" is UNMATCHED. Recovering position.`);
          console.log(`      ↳ Final Box: [x:${x}, y:${y}, w:${w}, h:${h}]`);

          // 3. Populate visual_position (Contract Fulfilled)
          // Center the mark and apply stagger.
          anno.visual_position = {
            x: x + (w / 2) + staggerX,
            y: y + (h / 2),
            width: isNormalized ? 2 : 10, // Use smaller width for %
            height: isNormalized ? 2 : 10
          };

          // STATUS REMAINS 'UNMATCHED' (Honest Data)
        } else {
          // This confirms if the upstream fix worked or not
          console.error(`   ❌ [CRITICAL] Q${anno.subQuestion}: Line "${currentId}" is UNMATCHED but has NO BOX data. Check TaskBuilder.`);
        }
      }
      // =======================================================================

      // =======================================================================
      // 🛡️ [USER DESIGN FIX] IRON DOME PATCH
      // Requirement: If Annotation is on P0, but Backfill Zone is on P1, SNAP IT.
      // =======================================================================
      const validZones = semanticZones[anno.subQuestion];
      if (validZones) {
        // Find the Backfilled Zone (The one on the highest page)
        const targetZone = validZones.sort((a, b) => b.pageIndex - a.pageIndex)[0];

        // Check: Is Mark on P0 (0) and Zone on P1 (1)?
        if (targetZone && (anno.pageIndex || 0) < targetZone.pageIndex) {
          const isVisual = (anno.ocr_match_status === 'VISUAL') ||
            (anno.line_id === null) ||
            (anno.text && ['M1', 'A1', 'B1'].includes(anno.text));

          if (isVisual) {
            console.log(`   🧲 [IRON-DOME-PATCH] Snapping Q${anno.subQuestion} from P${anno.pageIndex} -> P${targetZone.pageIndex}`);
            anno.pageIndex = targetZone.pageIndex;
            // We preserve visual_position (User Requirement)
          }
        }
      }
      // =======================================================================

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

    let sanitizedAnnotations = enrichedAnnotations;

    const parsedScore: any = parseScore(markingResult.studentScore);

    // ---------------------------------------------------------
    // 💀 THE GUILLOTINE: Strict Budget Enforcement
    // ---------------------------------------------------------
    // Regardless of what AI said, we recalculate and cut.
    const strictResult = enforceStrictBudget(sanitizedAnnotations, task.markingScheme);

    // Update Annotations (Survivors only)
    sanitizedAnnotations = strictResult.annotations;

    // Update Score (Recalculated)
    parsedScore.awardedMarks = strictResult.awardedMarks;

    // [DEBUG-GUILLOTINE] Log if we changed the score
    if (parsedScore.awardedMarks !== Number(markingResult.studentScore?.awardedMarks)) {
      console.log(`   ⚖️ [GUILLOTINE-FIX] Recalculated Score: ${markingResult.studentScore?.awardedMarks} -> ${parsedScore.awardedMarks} (Survivors: ${sanitizedAnnotations.length})`);
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


    // ---------------------------------------------------------
    // 🧹 SANITIZATION: Clean db payload
    // ---------------------------------------------------------
    const cleanMarkingScheme: any = {};
    if (task.markingScheme) {
      const allowedKeys = [
        'marks', 'totalMarks', 'questionNumber', 'questionLevelAnswer', 'marksWithAnswers',
        'subQuestionNumbers', 'subQuestionMarks', 'subQuestionMaxScores', 'subQuestionAnswersMap',
        'subQuestionTexts', 'hasAlternatives', 'alternativeMethod', 'parentQuestionMarks',
        'isGeneric', 'guidance', 'subQuestionMetadata'
      ];

      allowedKeys.forEach(key => {
        if ((task.markingScheme as any)[key] !== undefined) {
          cleanMarkingScheme[key] = (task.markingScheme as any)[key];
        }
      });
    }

    // NEW: Capture the exact prompt texts
    const finalPromptQuestionText = markingResult.promptQuestionText;
    const finalPromptSchemeText = markingResult.schemeTextForPrompt;

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
      markingScheme: finalPromptSchemeText || (typeof cleanMarkingScheme === 'string' ? cleanMarkingScheme : JSON.stringify(cleanMarkingScheme)), // [PERSISTENCE FIX] Force string
      studentWork: (markingResult as any).cleanedOcrText || task.classificationStudentWork,
      databaseQuestionText: task.markingScheme?.databaseQuestionText || task.questionText,
      questionText: finalPromptQuestionText || task.questionText || '', // [PERSISTENCE FIX] Overwrite with prompt text
      overallPerformanceSummary: (markingResult as any).overallPerformanceSummary,
      rawAnnotations: rawAnnotationsFromAI,
      semanticZones: semanticZones // ✅ PASSED THROUGH
    };

  } catch (error) {
    console.error(`Error executing marking for Q${questionId}:`, error);
    throw error;
  }
}

const flattenQuestionTree = (node: any, result: any[] = []) => {
  result.push(node);
  if (node.subQuestions && Array.isArray(node.subQuestions)) {
    node.subQuestions.forEach((child: any) => flattenQuestionTree(child, result));
  }
  return result;
};

export function createMarkingTasksFromClassification(
  classificationResult: any,
  allPagesOcrData: any[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>,
  standardizedPages: any[],
  mapperResults?: any[]
): MarkingTask[] {
  const tasks: MarkingTask[] = [];

  if (!classificationResult?.questions) return tasks;

  const questionGroups = new Map<string, any>();

  // =========================================================================
  // PHASE 1: GROUPING & TRUTH TRACKING
  // =========================================================================
  for (const q of classificationResult.questions) {
    const baseQNum = getBaseQuestionNumber(String(q.questionNumber || ''));
    if (!baseQNum) continue;

    const groupingKey = baseQNum;
    const sourceImageIndices = q.sourceImageIndices && q.sourceImageIndices.length > 0 ? q.sourceImageIndices : [q.sourceImageIndex ?? 0];

    // --- Anchor Page Logic (Standard) ---
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
        markingScheme: markingScheme,
        baseQNum: baseQNum,
        sourceImageIndices: sourceImageIndices,
        classificationBlocks: [],
        aiSegmentationResults: [],
        subQuestionMetadata: { hasSubQuestions: false, subQuestions: [] },
        lineCounter: 1,
        // ✅ KEY DATA: Tracks parts that have ACTUAL content found by Classifier
        processedSubQuestions: new Set<string>()
      });
    } else {
      const group = questionGroups.get(groupingKey);
      const combined = [...new Set([...group.sourceImageIndices, ...sourceImageIndices])].sort();
      group.sourceImageIndices = combined;
    }

    const group = questionGroups.get(groupingKey);
    const currentQPageIndex = anchorMainPage;
    (q as any).pageIndex = currentQPageIndex;

    const allNodes = flattenQuestionTree(q);

    allNodes.forEach((node: any) => {
      const blockId = `class_block_${baseQNum}_${node.part || 'main'}`;
      const nodeBox = node.box || node.region || node.rect || node.coordinates;

      // 1. Store Block for Geometric Calculations
      if (nodeBox) {
        group.classificationBlocks.push({
          id: blockId,
          text: node.text || '',
          box: nodeBox,
          pageIndex: node.pageIndex ?? currentQPageIndex,
          part: node.part || 'main'
        });
      }

      // 2. Metadata Extraction
      if (node.part && node.part !== 'main') {
        const IGNORED = ['id', 'questionnumber', 'totalmarks'];
        if (!IGNORED.includes(node.part.toLowerCase())) {
          group.subQuestionMetadata.hasSubQuestions = true;
          group.subQuestionMetadata.subQuestions.push({
            part: node.part,
            text: node.text || ''
          });
        }
      }

      // 3. Process Student Work Lines
      let hasContent = false;
      if (node.studentWorkLines && node.studentWorkLines.length > 0) {
        node.studentWorkLines.forEach((l: any) => {

          const pIdx = l.pageIndex ?? node.pageIndex ?? currentQPageIndex;
          const globalId = `p${pIdx}_q${baseQNum}_line_${group.lineCounter++}`;

          // =========================================================
          // 🛠️ FIX 1: Q11 DRAWING RESTORATION (The "Drawing Flow")
          // =========================================================
          // We DO NOT filter this. We pass it downstream so Executor sees it on Page 1.
          if (l.text === '[DRAWING]') {
            group.aiSegmentationResults.push({
              line_id: `visual_drawing_${baseQNum}_${group.lineCounter}`, // Distinct ID
              content: '[DRAWING]',
              source: 'classification',    // Honest Source
              blockId: `drawing_${baseQNum}_${group.lineCounter}`,
              subQuestionLabel: node.part || 'main',
              pageIndex: pIdx,             // Uses the correct Page Index (e.g. Page 1)
              // Use box if present, otherwise safe default for zone creation
              bbox: l.box || l.position || nodeBox || { x: 0, y: 0, width: 100, height: 50 }
            });
            hasContent = true;
            return; // Done with this item
          }

          // =========================================================
          // 🛠️ FIX 2: Q2 POSITION RECOVERY (The "Data Clog")
          // =========================================================
          // Your logs proved the key is 'position'. We must grab it.
          let rawBox = l.position || l.box || l.region || l.rect || l.coordinates;

          // Fallback: If line has no box, INHERIT from the parent Node
          if (!rawBox || (rawBox.x === 0 && rawBox.y === 0 && rawBox.width === 0)) {
            rawBox = node.position || nodeBox;
          }

          const positionData = rawBox || { x: 0, y: 0, width: 0, height: 0, unit: 'percentage' };

          group.aiSegmentationResults.push({
            line_id: globalId,
            content: l.text,
            source: 'classification',
            blockId: globalId,
            subQuestionLabel: node.part || 'main',
            pageIndex: pIdx,
            // 🚨 THIS IS THE CRITICAL BRIDGE
            bbox: positionData,
            position: positionData
          });
          hasContent = true;
        });
      }

      if (node.hasStudentDrawing) {
        hasContent = true; // Found Drawing
      }

      // ✅ TRUTH SETTING: If we found content, mark this part as "Processed".
      if (hasContent && node.part) {
        group.processedSubQuestions.add(node.part);
      }
    });
  }

  // =========================================================================
  // PHASE 2: TASK GENERATION
  // =========================================================================
  const sortedQuestionGroups = Array.from(questionGroups.entries()).sort((a, b) => {
    const numA = parseInt(String(a[0]).replace(/\D/g, '')) || 0;
    const numB = parseInt(String(b[0]).replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  sortedQuestionGroups.forEach(([baseQNum, group], idx) => {

    // --- 3. Build Transcript (Standard) ---
    let promptMainWork = "";
    let currentHeader = "";

    group.aiSegmentationResults.sort((a: any, b: any) => {
      if (a.subQuestionLabel === 'main') return -1;
      if (b.subQuestionLabel === 'main') return 1;
      return (a.subQuestionLabel || '').localeCompare(b.subQuestionLabel || '');
    });

    group.aiSegmentationResults.forEach((seg: any) => {
      const clean = seg.content.replace(/\s+/g, ' ').trim();
      const isContentValid = (clean.length > 0 && clean !== '--') || seg.isVisualPlaceholder;

      if (isContentValid) {
        if (seg.subQuestionLabel && seg.subQuestionLabel !== currentHeader && seg.subQuestionLabel !== 'main') {
          promptMainWork += `\n[SUB-QUESTION ${seg.subQuestionLabel}]\n`;
          currentHeader = seg.subQuestionLabel;
        }
        const id = seg.line_id || seg.blockId || seg.sequentialId;
        promptMainWork += `[ID: ${id}] ${clean}\n`;
      }
    });

    // --- 4. Gather OCR (Standard) ---
    let allOcrBlocks: any[] = [];
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
    });

    // --- 5. Final Task Assembly ---
    const questionImages: string[] = [];
    group.sourceImageIndices.forEach((imageIdx: number) => {
      const page = standardizedPages.find(p => p.pageIndex === imageIdx);
      if (page?.imageData) questionImages.push(page.imageData);
    });

    let nextQuestionText: string | undefined;
    const nextGroup = sortedQuestionGroups[idx + 1];
    if (nextGroup) nextQuestionText = nextGroup[1].mainQuestion.text;

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
        hasSubQuestions: group.subQuestionMetadata.hasSubQuestions,
        subQuestions: group.subQuestionMetadata.subQuestions
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
 * THE GUILLOTINE (Strict Budget Enforcement)
 * 1. Parses mark values (e.g. "B2" -> 2, "M1" -> 1).
 * 2. Groups by Sub-Question.
 * 3. Cuts excess marks to enforce Max Score budgets.
 */
function enforceStrictBudget(
  annotations: any[],
  scheme: any
): { annotations: any[], awardedMarks: number } {
  const sanitizeValue = (text: string) => {
    // Standard Codes: M1, A1, B2 -> Extract Number
    const match = text.match(/[A-Z]+(\d+)/i);
    if (match) return parseInt(match[1]);

    // Fallback: Just numbers "2"
    const num = parseInt(text.replace(/\D/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // Group by Sub-Question
  const buckets: Record<string, any[]> = {};
  annotations.forEach(a => {
    const key = a.subQuestion || 'main'; // Use 'main' if no sub-question
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(a);
  });

  let grandTotal = 0;
  const survivorList: any[] = [];

  Object.keys(buckets).forEach(subQ => {
    const anns = buckets[subQ];

    // Determine Budget for this Sub-Question
    // 1. Try Scheme Lookup (If precise mapping exists)
    // 2. Fallback: Parse from Scheme Text? 
    // 3. Fallback: If "main" and only 1 Q, use TotalMarks.
    // For now, if we lack granular budget, we assume INFINITE (or rely on TotalMarks later).
    // BUT, for Q12 (Total 2), we know the limit.

    let budget = 99; // Default open

    // Attempt to find specific max score in scheme
    // Schema structure varies, we try a few paths
    if (scheme) {
      // Path A: scheme.markBreakdown['12']
      if (scheme.markBreakdown && scheme.markBreakdown[subQ]) {
        budget = scheme.markBreakdown[subQ].maxScore || budget;
      }
      // Path B: scheme.subQuestions (Array)
      else if (Array.isArray(scheme.subQuestions)) { // Typo fix: removed duplicate 'scheme'
        const match = (scheme.subQuestions as any[]).find((sq: any) => sq.label === subQ || sq.questionNumber === subQ);
        if (match && match.maxScore) budget = Number(match.maxScore);
      }
      // Path C: If this is the ONLY sub-question (e.g. "12" is main), use TotalMarks
      else if (Object.keys(buckets).length === 1 && scheme.totalMarks) {
        budget = Number(scheme.totalMarks);
      }
    }

    // Calculate current breakdown
    let currentVal = 0;
    const survivors: any[] = [];

    for (const ann of anns) {
      const val = sanitizeValue(ann.text || "0");
      if (currentVal + val <= budget) {
        survivors.push(ann);
        currentVal += val;
      } else {
        // [CUT] Exceeds budget
        console.log(`   ✂️ [GUILLOTINE] Q${subQ}: Cutting annotation "${ann.text}" (Value: ${val}). Budget: ${budget}, Current: ${currentVal}`);
      }
    }

    survivors.forEach(s => survivorList.push(s));
    grandTotal += currentVal;
  });

  return { annotations: survivorList, awardedMarks: grandTotal };
}

/**
 * THE NORMALIZER (The Judge)
 * 1. Validates AI intent against Physical Zones.
 * 2. Resolves specific Target IDs (Text vs Handwriting).
 * 3. Never passes ambiguity downstream.
 */
function resolveLinksWithZones(
  annotations: any[],
  semanticZones: Record<string, Array<{ startY: number; endY: number; pageIndex: number; x: number }>>,
  allOcrBlocks: any[],
  pageHeight: number
): any[] {

  return annotations.map(anno => {


    // 1. Initialize
    if (!(anno as any).ai_raw_status) {
      (anno as any).ai_raw_status = anno.ocr_match_status;
    }

    // 2. THE LAW: MATCHED REQUIRES AN ID
    // If AI says "MATCHED" but gives NULL ID -> FORCE UNMATCHED.
    const hasId = anno.linked_ocr_id || anno.linkedOcrId;
    if (anno.ocr_match_status === "MATCHED" && !hasId) {
      console.log(`   🛡️ [IRON-DOME-TRAP] ${anno.subQuestion}: MATCHED with NULL ID. Demoting to UNMATCHED.`);
      anno.ocr_match_status = "UNMATCHED";
    }

    // 3. ZONE CHECK (For Valid IDs)
    const zoneData = ZoneUtils.findMatchingZone(anno.subQuestion, semanticZones);
    let zone: { startY: number; endY: number } | null = null;
    if (zoneData) {
      zone = { startY: zoneData.startY, endY: zoneData.endY };
    }

    // 4. IRON DOME VETO (Only check if we have an ID)
    const physicalId = anno.linked_ocr_id || anno.linkedOcrId;

    if (physicalId && zone) {
      const block = allOcrBlocks.find(b => b.id === physicalId);
      if (block) {
        const markY = block.coordinates?.y ?? block.bbox?.[1];
        if (markY !== null) {
          const inZone = ZoneUtils.isPointInZone(markY, zoneData, 0.05);

          // 🛡️ [FIX]: Exception for Split-Page Visuals
          // If it's a Visual Placeholder on the "Next Page" (e.g. Zone P0, Block P1), allow it.
          const isVisualPlaceholder = (block.text || '').includes('VISUAL') || physicalId.includes('visual');
          const isNextPage = (block.pageIndex === (zoneData.pageIndex + 1));

          if (!inZone && !(isVisualPlaceholder && isNextPage)) {
            console.log(`   ⚖️ [IRON-DOME-VETO] ${anno.subQuestion}: ID ${physicalId} is OUT OF ZONE. Vetoing.`);
            anno.ocr_match_status = "UNMATCHED";
            anno.linked_ocr_id = null;
          }
        }
      }
    }

    // 5. OUTPUT: Pure State. No Swapping. No Magic.
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