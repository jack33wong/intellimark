/**
 * Marking Executor Service
 * Final Polish: Robust Coordinate Re-Homing
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { ModelType, MarkingTask, EnrichedAnnotation, MathBlock } from '../../types/index.js';
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import UsageTracker from '../../utils/UsageTracker.js';

export interface QuestionResult {
  questionNumber: number | string;
  score: any;
  annotations: EnrichedAnnotation[];
  feedback?: string;
  usageTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  confidence?: number;
  mathpixCalls?: number;
  markingScheme?: any;
  studentWork?: string;
  promptMarkingScheme?: string;
  classificationBlocks?: any[];
  questionText?: string;
  databaseQuestionText?: string;
  pageIndex?: number;
  sourceImageIndices?: number[];
  overallPerformanceSummary?: string;
  cleanedOcrText?: string;
}

// --- 1. ROBUST ZONE DETECTOR ---
// Scans raw OCR blocks to find coordinates of headers like (a), (b)(i), etc.
function detectSemanticZones(rawBlocks: any[], pageHeight: number) {
  const zones: Record<string, { startY: number; endY: number; pageIndex: number; x: number }> = {};

  // 🔥 FIX: Sort by pageIndex FIRST, then by Y position
  const sortedBlocks = [...rawBlocks].sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return (a.pageIndex || 0) - (b.pageIndex || 0);
    return (a.coordinates?.y || 0) - (b.coordinates?.y || 0);
  });

  // Matches: "10a", "(a)", "a)", "b(i)", "(ii)", "``` (b)(i)"
  const landmarkRegex = /^[^\w\(\)]*(\d*[a-z]+|[ivx]+|[\(][a-zivx]+[\)])/i;

  let currentLabel: string | null = null;
  let currentStartY = 0;
  let currentPageIndex = 0;

  console.log("🔍 [ZONE SCAN] Scanning blocks for landmarks...");

  sortedBlocks.forEach((block) => {
    const text = (block.text || '').trim();
    const blockPage = block.pageIndex || 0;

    if (text.length < 100) {
      const match = text.match(landmarkRegex);
      if (match) {
        const cleanLabel = match[1].replace(/[\d\(\)\.\s`]/g, '').toLowerCase();

        if (/^[a-z]$|^[a-z]?[ivx]{1,4}$/.test(cleanLabel)) {
          console.log(`   📍 Found Landmark: "${cleanLabel}" at Page ${blockPage}, Y=${Math.round(block.coordinates?.y || 0)}`);

          if (currentLabel) {
            // Close previous zone (handle page wrap if needed)
            const endY = (blockPage === currentPageIndex) ? (block.coordinates?.y || 0) : pageHeight;
            zones[currentLabel] = {
              startY: currentStartY,
              endY,
              pageIndex: currentPageIndex,
              x: zones[currentLabel]?.x || 0 // Preserve previous x if closing
            };
          }
          currentLabel = cleanLabel;
          currentStartY = block.coordinates?.y || 0;
          currentPageIndex = blockPage;

          // Store start X for this landmark
          const startX = block.coordinates?.x || 0;
          zones[currentLabel] = { startY: currentStartY, endY: pageHeight, pageIndex: currentPageIndex, x: startX };
        }
      }
    }
  });

  // Close final zone
  if (currentLabel) {
    zones[currentLabel] = {
      startY: currentStartY,
      endY: pageHeight,
      pageIndex: currentPageIndex,
      x: zones[currentLabel]?.x || 0
    };
  }

  return zones;
}

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
        // Normalize coords (Handle Percentage vs 0-1000 vs Pixels)
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

        // CRITICAL: Ensure we are dealing with PIXELS here.
        const pageDims = task.pageDimensions?.get(pageIdx);
        const w = pageDims?.width || 2000;
        const h = pageDims?.height || 3000;

        const ocrSource = result.source || 'classification';

        // Gemini Scale Check (0-1000)
        // If values are <= 1000 AND image is clearly larger than 1000px, assume Gemini Scale.
        if (bbox[0] <= 1000 && bbox[1] <= 1000 && bbox[2] <= 1000 && bbox[3] <= 1000 && (w > 1000 || h > 1000) && (bbox[0] !== 0 || bbox[1] !== 0)) {
          bbox = [
            (bbox[0] / 1000) * w,
            (bbox[1] / 1000) * h,
            (bbox[2] / 1000) * w,
            (bbox[3] / 1000) * h
          ];
        }
        // Percentage Scale Check (0-100) - For drawings or legacy classification
        else if (bbox[0] < 100 && bbox[1] < 100 && (bbox[0] !== 0 || bbox[1] !== 0) && (ocrSource === 'classification' || result.content.includes('[DRAWING]'))) {
          bbox = [
            (bbox[0] / 100) * w,
            (bbox[1] / 100) * h,
            (bbox[2] / 100) * w,
            (bbox[3] / 100) * h
          ];
        }

        return {
          line_id: (result as any).sequentialId || `line_${stepIndex + 1}`,
          pageIndex: pageIdx,
          globalBlockId: result.blockId,
          text: result.content,
          lineId: result.blockId,
          cleanedText: result.content.trim(),
          bbox: bbox, // NOW GUARANTEED TO BE PIXELS
          ocrSource: ocrSource,
          isHandwritten: true
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
            line_id: `ocr_${ocrIdx + 1}`,
            pageIndex: blockPageIndex as number,
            globalBlockId: blockId as string,
            text: normalizedText,
            cleanedText: normalizedText,
            bbox: (block.coordinates ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height] : [0, 0, 0, 0]) as [number, number, number, number],
            ocrSource: block.ocrSource as string | undefined,
            isHandwritten: block.isHandwritten as boolean | undefined
          };
        });
      stepsDataForMapping = [...stepsDataForMapping, ...ocrStepsForMapping];

    } else {
      stepsDataForMapping = task.mathBlocks.map((block, stepIndex) => {
        const rawText = block.mathpixLatex || block.googleVisionText || '';
        return {
          line_id: `line_${stepIndex + 1}`,
          pageIndex: ((block as any).pageIndex ?? task.sourcePages[0] ?? 0) as number,
          globalBlockId: (block as any).globalBlockId as string | undefined,
          text: normalizeLaTeXSingleLetter(rawText),
          cleanedText: normalizeLaTeXSingleLetter(rawText),
          bbox: (block.coordinates ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height] : [0, 0, 0, 0]) as [number, number, number, number],
          ocrSource: block.ocrSource as string | undefined,
          isHandwritten: block.isHandwritten as boolean | undefined
        };
      });
    }

    // [DEBUG] Log available coordinate targets
    console.log(`\n🔍 [MAPPING DEBUG] Available Classification Targets for Q${questionId}:`);
    stepsDataForMapping.forEach((s, i) => {
      if (s.ocrSource === 'classification') {
        console.log(`   [${i}] ID: ${s.line_id} | Text: "${s.text}" | Handwriting: ${s.isHandwritten} | Box: [${s.bbox.map(n => Math.round(n)).join(',')}]`);
      }
    });

    // --- 2. PREPARE PROMPT ---
    let ocrTextForPrompt = task.classificationStudentWork || "Student's Work:\n";
    if (ocrTextForPrompt.length < 15 && task.aiSegmentationResults?.length > 0) {
      task.aiSegmentationResults.forEach((result, index) => {
        const clean = result.content.replace(/\s+/g, ' ').trim();
        if (clean && clean !== '--') {
          ocrTextForPrompt += `${index + 1}. [${(result as any).sequentialId}] ${clean}\n`;
        }
      });
    }

    // ✅ DETECT SEMANTIC ZONES BEFORE MARKING
    const primaryPageDims = task.pageDimensions?.get(task.sourcePages?.[0] || 0);
    const pageHeightForZones = primaryPageDims?.height || 2000;

    // Create temp blocks list for zone detection
    const rawOcrBlocksForZones = task.mathBlocks.map((block) => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      coordinates: block.coordinates,
      pageIndex: (block as any).pageIndex ?? 0
    }));

    const semanticZones = detectSemanticZones(rawOcrBlocksForZones, pageHeightForZones);
    console.log(`\n🔍 [ZONE DEBUG] Detected Semantic Zones:`, Object.keys(semanticZones).join(', '));

    const rawOcrBlocks = task.mathBlocks.map((block, idx) => ({
      id: (block as any).globalBlockId,
      text: block.mathpixLatex || block.googleVisionText || '',
      pageIndex: (block as any).pageIndex ?? 0,
      coordinates: block.coordinates,
      isHandwritten: !!block.isHandwritten,
      subQuestions: (block as any).subQuestions
    }));

    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));

    const markingResult = await MarkingInstructionService.executeMarking({
      imageData: task.imageData || '',
      images: task.images,
      model: model,
      processedImage: {
        ocrText: ocrTextForPrompt,
        boundingBoxes: stepsDataForMapping.map(step => ({ x: step.bbox[0], y: step.bbox[1], width: step.bbox[2], height: step.bbox[3], text: step.text })),
        cleanDataForMarking: { steps: stepsDataForMapping },
        cleanedOcrText: ocrTextForPrompt,
        rawOcrBlocks: rawOcrBlocks,
        classificationStudentWork: ocrTextForPrompt,
        classificationBlocks: task.classificationBlocks,
        subQuestionMetadata: task.subQuestionMetadata,
        landmarks: Object.entries(semanticZones).map(([label, data]) => ({
          label,
          y: data.startY,
          x: data.x,
          top: data.startY,
          left: data.x,
          pageIndex: data.pageIndex
        }))
      } as any,
      questionDetection: task.markingScheme,
      questionText: task.markingScheme?.databaseQuestionText || null,
      questionNumber: String(questionId),
      allPagesOcrData: allPagesOcrData,
      sourceImageIndices: task.sourcePages,
      tracker: tracker,
      generalMarkingGuidance: task.markingScheme?.generalMarkingGuidance
    });

    sendSseUpdate(res, createProgressData(6, `Annotations generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
      throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // =========================================================================
    // 🛡️ PHASE 0: PRE-PROCESSING (Explode Clumped Annotations)
    // =========================================================================
    // If AI returns { text: "B2 B2 B2" }, split it early so Phase 1 & 2 can handle atoms.
    const explodedAnnotations: any[] = [];
    (markingResult.annotations || []).forEach((anno: any) => {
      const cleaned = (anno.text || '').replace(/,/g, ' ').trim();
      const parts = cleaned.split(/\s+/);

      // Check if it's a clump of marks (e.g., "B1 B1", "M1 A1")
      if (parts.length > 1 && parts.every(p => /^[A-Z]+\d+$/.test(p))) {
        console.warn(`   ⚠️ [CLUMP-SPLIT] Splitting "${anno.text}" into ${parts.length} atoms early.`);
        parts.forEach(part => {
          explodedAnnotations.push({
            ...anno,
            text: part,
            // V25 Fix: Copy match status and ensure ID is preserved
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

    // 🕵️ PROMPT LOGGING (V25 Troubleshooting)
    console.log(`\n🤖 [G0-PROMPT] Full AI Marking Context for Q${questionId}:`);
    // console.log(`   --- SYSTEM PROMPT ---\n${MarkingInstructionService.lastFullPrompt?.systemPrompt || 'N/A'}`); // V26: Disabled by user request
    console.log(`   --- USER PROMPT ---\n${MarkingInstructionService.lastFullPrompt?.userPrompt || 'N/A'}`);
    console.log(`   --- END PROMPT ---\n`);

    // =========================================================================
    // 🔄 PHASE 1: LOGICAL RE-HOMING (ID Correction)
    // =========================================================================
    console.log(`\n🔍 [ANNOTATION-AUDIT] Phase 1: ID Correction for Q${questionId}`);

    // Fix IDs and resolve handwritten locks BEFORE calculating final positions
    let correctedAnnotations = explodedAnnotations.map(anno => {
      // 1. Skip if already robustly linked to a line_ ID
      const currentId = anno.line_id || anno.lineId || "";
      if (currentId.startsWith('line_')) return anno;

      const sourceStep = stepsDataForMapping.find(s => s.line_id === currentId || s.globalBlockId === currentId);

      // 2. Resolve Page Index
      if (sourceStep && sourceStep.pageIndex !== undefined) {
        if (anno.pageIndex !== sourceStep.pageIndex) anno.pageIndex = sourceStep.pageIndex;
      } else if (task.sourcePages?.length === 1) {
        anno.pageIndex = task.sourcePages[0];
      }

      // 3. Robust Fuzzy Match (If snapped to printed text or missing)
      const isPrinted = !sourceStep || sourceStep.isHandwritten === false;
      if (isPrinted) {
        const isDrawing = (anno.text || '').includes('[DRAWING]') || (anno.reasoning && (anno.reasoning.includes('[DRAWING]') || anno.reasoning.includes('plan')));
        if (isDrawing) {
          const syntheticLine = stepsDataForMapping.find(s => s.text.includes('[DRAWING]'));
          if (syntheticLine) {
            anno.pageIndex = syntheticLine.pageIndex;
            anno.bbox = [syntheticLine.bbox[0], syntheticLine.bbox[1], syntheticLine.bbox[2], syntheticLine.bbox[3]];
            anno.line_id = syntheticLine.line_id;
          }
          // Sovereignty: Do not proceed to fuzzy matching for drawings
          return anno;
        } else {
          // FUZZY MATCHER
          const clean = (str: string) => str.toLowerCase()
            .replace(/[\s\\]/g, '')
            .replace(/frac|sqrt|times|div/g, '')
            .replace(/[(){}\[\]]/g, '');

          const targetText = clean(anno.studentText || anno.text || "");
          if (targetText.length > 0) {
            // 🔥 FINAL ROBUST FIX: Only re-home to physical BLOCKS (block_x)
            // This prevents matching line_1 to line_1 and ensures we get Mathpix coords.
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
              console.log(`      🎯 SUCCESS: Re-homed "${anno.text}" to "${betterMatch.text}" (ID: ${betterMatch.line_id})`);
              anno.line_id = betterMatch.line_id;
              anno.pageIndex = betterMatch.pageIndex;
              // Do NOT pre-fill bbox here, let Enrichment service resolve it fresh from the ID
            }
          }
        }
      }
      return anno;
    });

    // =========================================================================
    // 📐 PHASE 2: COORDINATE ENRICHMENT (Calculate Pixels)
    // =========================================================================
    const defaultPageIndex = (task.sourcePages && task.sourcePages.find(p => p !== 0)) ?? task.sourcePages?.[0] ?? 0;

    let enrichedAnnotations = enrichAnnotationsWithPositions(
      correctedAnnotations,
      stepsDataForMapping,
      String(questionId),
      defaultPageIndex,
      task.pageDimensions,
      task.classificationBlocks,
      task,
      (markingResult as any).visualObservation,
      (markingResult as any).globalOffsetX || 0,
      (markingResult as any).globalOffsetY || 0,
      semanticZones // NEW: Pass landmarks for per-annotation scoping
    ).filter(anno => (anno.text || '').trim() !== '');

    // =========================================================================
    // 🛡️ PHASE 3: SPATIAL SANITIZATION (Zone Snapping & Safety Nets)
    // =========================================================================
    console.log(`\n🔍 [ANNOTATION-AUDIT] Phase 3: Spatial Sanitization for Q${questionId}`);

    enrichedAnnotations.forEach(anno => {
      let isAnchored = false; // TRACKER: Did we successfully place this?

      // A. ZONE ENFORCEMENT
      // 🛡️ CRITICAL FIX: NEVER Move a "MATCHED" OCR Annotation OR a "VISUAL/REDIRECTED" mark
      // If Mathpix found the text exactly, we trust Mathpix's coordinates 100%.
      // If the system redirected the mark to handwriting for precision, we trust that too.
      // We ONLY apply Zone Snapping to "UNMATCHED" or "FALLBACK" annotations.
      const isVisual = anno.ocr_match_status === 'VISUAL' || String(anno.line_id || '').startsWith('visual_redirect_');

      if (anno.subQuestion && anno.bbox && semanticZones && anno.ocr_match_status !== 'MATCHED' && !isVisual) {
        // Clean SubQ: "10(a)" -> "a", "(b)(i)" -> "bi"
        let subQ = anno.subQuestion.replace(/^\d+/, '').replace(/[()\s]/g, '').toLowerCase();

        // Try Exact Match (e.g. "a")
        let targetZone = semanticZones[subQ];

        // Try Recursive Fallback (e.g. "bi" -> "b")
        if (!targetZone && subQ.length > 1) {
          targetZone = semanticZones[subQ.charAt(0)]; // "b" from "bi"
        }

        if (targetZone) {
          const currentY = anno.bbox[1];
          // If annotation is drifting (or falling back), snap it.
          // We trust the zone even if the AI is slightly off.
          if (currentY < targetZone.startY || currentY > targetZone.endY || (anno.bbox[0] === 0)) {
            console.log(`      🛡️ [ZONE SNAP] "${anno.text}" snapped to ${subQ} (Y=${Math.round(targetZone.startY)})`);

            // FORCE SNAP TO HEADER
            anno.bbox[1] = targetZone.startY + 50; // Header + Padding
            anno.pageIndex = targetZone.pageIndex;

            // If X is missing, give it a default indentation
            if (anno.bbox[0] < 100) anno.bbox[0] = 150;

            isAnchored = true; // MARK AS SAFE
          } else {
            // It is already inside the correct zone
            isAnchored = true;
          }
        }
      }

      // B. SAFETY NET (Working Example Anchor)
      // ONLY RUN THIS IF NOT ANCHORED BY A ZONE
      if (!isAnchored && anno.bbox && (anno.bbox[0] === 0 || anno.ocr_match_status === 'UNMATCHED')) {
        // Find a "Working Example" (Any matched block on this page)
        const workingExample = enrichedAnnotations.find(a =>
          a.pageIndex === anno.pageIndex &&
          a.ocr_match_status === 'MATCHED' &&
          a !== anno
        );

        if (workingExample && workingExample.bbox) {
          console.log(`      ⚓ [TETHER] Anchoring floater "${anno.text}" to context neighbor "${workingExample.text}"`);
          anno.bbox[0] = workingExample.bbox[0];
          anno.bbox[1] = workingExample.bbox[1] + 50;
        }
      }
    });

    // Final Cleanup: Deduplication
    const bestMarks = new Set<string>();
    enrichedAnnotations.forEach(a => {
      if (parseInt((a.text || '').replace(/\D/g, '') || '0') > 0) bestMarks.add(a.subQuestion || 'main');
    });

    enrichedAnnotations = enrichedAnnotations.filter(anno => {
      const subQ = anno.subQuestion || 'main';
      const isZero = parseInt((anno.text || '').replace(/\D/g, '') || '0') === 0;
      if (isZero && bestMarks.has(subQ)) {
        console.log(`   🗑️ [DEDUPE] Dropping zero mark "${anno.text}" for ${subQ}`);
        return false;
      }
      return true;
    });

    // =================================================================================
    // 🚨 FINAL FIX: CONVERT PIXELS TO PERCENTAGES (0-100) FOR FRONTEND
    // =================================================================================
    enrichedAnnotations.forEach(anno => {
      if (anno.bbox) {
        const pIdx = anno.pageIndex ?? task.sourcePages?.[0] ?? 0;
        const dims = task.pageDimensions?.get(pIdx);

        if (dims && dims.width > 0 && dims.height > 0) {
          // Check if it's already a percentage (heuristic: < 100)
          // If x > 100, it's definitely pixels on any normal image
          const isPixels = anno.bbox[0] > 100 || anno.bbox[1] > 100 || anno.bbox[2] > 100;

          if (isPixels) {
            anno.visual_position = {
              x: (anno.bbox[0] / dims.width) * 100,
              y: (anno.bbox[1] / dims.height) * 100,
              width: (anno.bbox[2] / dims.width) * 100,
              height: (anno.bbox[3] / dims.height) * 100
            };
          } else {
            // Already percentages, map to visual_position
            anno.visual_position = {
              x: anno.bbox[0],
              y: anno.bbox[1],
              width: anno.bbox[2],
              height: anno.bbox[3]
            };
          }
        }
      }
    });
    // =================================================================================

    console.log(`✅ [ANNOTATION-AUDIT] Complete\n`);

    const sanitizedAnnotations = enrichedAnnotations;

    // =========================================================================
    // 🧮 PHASE 5: ROBUST SCORE CALCULATION
    // =========================================================================
    // Prevents "223" errors by ensuring we only sum distinct integers from all annotations
    let recalculatedAwardedScore = 0;
    sanitizedAnnotations.forEach(anno => {
      // Extract all numbers from the text (e.g. "B2" -> [2], "M1" -> [1])
      const matches = (anno.text || '').match(/\d+/g);
      if (matches) {
        // Sum them up safely for this specific annotation
        const annotationScore = matches.reduce((sum, val) => sum + parseInt(val, 10), 0);
        recalculatedAwardedScore += annotationScore;
      }
    });

    const parsedScore = parseScore(markingResult.studentScore);

    // Override awarded score with our robust calculation
    parsedScore.awardedMarks = recalculatedAwardedScore;

    // CRITICAL: Final safety net for totalMarks denominator
    // If the AI returns 0 or missing totalMarks, fallback to the known total from the scheme
    if (parsedScore.totalMarks === 0 && task.markingScheme?.totalMarks) {
      parsedScore.totalMarks = Number(task.markingScheme.totalMarks);
    }

    console.log(`[SCORE DEBUG] Q${questionId}: rawScore=${JSON.stringify(markingResult.studentScore)}, parsedAwarded=${parsedScore.awardedMarks}, parsedTotal=${parsedScore.totalMarks}, schemeTotal=${task.markingScheme?.totalMarks}`);

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
      overallPerformanceSummary: (markingResult as any).overallPerformanceSummary
    };

  } catch (error) {
    console.error(`Error executing marking for Q${questionId}:`, error);
    throw error;
  }
}

// FLATTEN UTILS
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
        subQuestionPageMap: {}
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
      if (node.studentWorkLines) {
        node.studentWorkLines.forEach((l: any) => {
          if (l.text === '[DRAWING]') return;
          const pIdx = l.pageIndex ?? node.pageIndex ?? currentQPageIndex;
          l.pageIndex = pIdx;
          group.aiSegmentationResults.push({
            content: l.text,
            source: 'classification',
            blockId: `classification_${baseQNum}_${node.part || 'main'}_${l.id || globalIdCounter.val++}`,
            lineData: l,
            sequentialId: l.id,
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
          const line = {
            id: `line_${globalIdCounter.val++}`,
            text: "[DRAWING]",
            pageIndex: pIdx,
            position: pos
          };
          node.studentWorkLines.push(line);
          group.aiSegmentationResults.push({
            content: "[DRAWING]",
            source: "classification",
            blockId: `classification_drawing_${line.id}`,
            lineData: line,
            sequentialId: line.id,
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

  for (const [baseQNum, group] of sortedQuestionGroups) {
    let allOcrBlocks: MathBlock[] = [];
    group.sourceImageIndices.forEach((pageIndex: number) => {
      const pageOcr = allPagesOcrData.find(d => d.pageIndex === pageIndex);
      let ocrIdx = 0;

      // 1. Add Math Blocks
      if (pageOcr?.ocrData?.mathBlocks) {
        pageOcr.ocrData.mathBlocks.forEach((b: any) => {
          b.pageIndex = pageIndex;
          b.globalBlockId = `block_${pageIndex}_${ocrIdx++}`;
          allOcrBlocks.push(b);
        });
      }

      // 2. Add Standard Text Blocks (V27 Fix: Crucial for Instruction Mapping)
      if (pageOcr?.ocrData?.blocks) {
        pageOcr.ocrData.blocks.forEach((b: any) => {
          b.pageIndex = pageIndex;
          b.globalBlockId = `block_${pageIndex}_${ocrIdx++}`;
          allOcrBlocks.push(b);
        });
      }
    });

    group.aiSegmentationResults.forEach((seg: any, idx: number) => {
      seg.sequentialId = `line_${idx + 1}`;
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
        promptMainWork += `${index + 1}. [${seg.sequentialId}] ${clean}\n`;
      }
    });

    const questionImages: string[] = [];
    group.sourceImageIndices.forEach((idx: number) => {
      const page = standardizedPages.find(p => p.pageIndex === idx);
      if (page?.imageData) questionImages.push(page.imageData);
    });

    tasks.push({
      questionNumber: baseQNum,
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
  }

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

  // Handle "X/Y" format
  if (scoreStr.includes('/')) {
    const parts = scoreStr.split('/');
    return {
      awardedMarks: parseFloat(parts[0]) || 0,
      totalMarks: parseFloat(parts[1]) || 0
    };
  }

  // Handle single number (assume total is unknown/0)
  const numericValue = parseFloat(scoreStr);
  return {
    awardedMarks: isNaN(numericValue) ? 0 : numericValue,
    totalMarks: 0
  };
}
