/**
 * Marking Executor Service
 * Final Polish: Robust Coordinate Re-Homing
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { ModelType, MarkingTask, EnrichedAnnotation, MathBlock } from '../../types/index.js';
import type { QuestionResult } from '../../types/marking.js';
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import UsageTracker from '../../utils/UsageTracker.js';
import { MarkingPositioningService } from './MarkingPositioningService.js';
import { sanitizeAiLineId, generateDiagnosticTable } from './MarkingHelpers.js';
import { sanitizeAnnotations } from './MarkingSanitizer.js';





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
        // Percentage Scale Check (0-100)
        else if (bbox[0] < 100 && bbox[1] < 100 && (bbox[0] !== 0 || bbox[1] !== 0)) {
          bbox = [
            (bbox[0] / 100) * w,
            (bbox[1] / 100) * h,
            (bbox[2] / 100) * w,
            (bbox[3] / 100) * h
          ];
        }

        return {
          line_id: (result as any).sequentialId || `p${pageIdx}_q${questionId}_line_${stepIndex + 1}`,
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
            line_id: `p${blockPageIndex}_ocr_${ocrIdx + 1}`,
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
          line_id: `p${((block as any).pageIndex ?? task.sourcePages[0] ?? 0)}_q${questionId}_line_${stepIndex + 1}`,
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
          // ID VISIBLE: Inject explicit ID for strict copy-pasting
          const idTag = (result as any).sequentialId ? `[ID: ${(result as any).sequentialId}] ` : `${index + 1}. `;
          ocrTextForPrompt += `${idTag}${clean}\n`;
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

    const semanticZones = MarkingPositioningService.detectSemanticZones(rawOcrBlocksForZones, pageHeightForZones);
    console.log(`\n🔍 [ZONE DEBUG] Detected Semantic Zones:`, Object.keys(semanticZones).join(', '));

    // BIBLE §2 COMPLIANCE (REFINED): "Isolate Rescue Layer"
    // To ensure "Perfect Placement", the AI must ONLY see raw geometric IDs (p0_ocr...) 
    // in the Rescue Layer. If we include semantic IDs (p0_q...), the AI will pick them 
    // and bypass the precise Mathpix coordinates.
    const rawOcrBlocks = [
      ...task.mathBlocks.map((block, idx) => {
        const globalId = (block as any).globalBlockId || `p${(block as any).pageIndex ?? 0}_ocr_${idx + 1}`;
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

    // [DEBUG] Verify ID Generation Strategy
    console.log('\n🔍 [ID-VERIFICATION] Checking Target IDs for Prompt Generation:');
    console.log(`   👉 Question: Q${questionId} (Page ${task.sourcePages[0] ?? '?'})`);

    // Check first 3 Structured Targets (Tier 1)
    if (stepsDataForMapping.length > 0) {
      console.log(`   ✅ Structured Targets (First 3 of ${stepsDataForMapping.length}):`);
      stepsDataForMapping.slice(0, 3).forEach((t, i) => {
        console.log(`      [${i}] ID: "${t.line_id}" | Text: "${(t.text || '').substring(0, 20)}..."`);
      });
    } else {
      console.log('   ⚠️ No Structured Targets found.');
    }

    // Check first 3 Raw OCR Targets (Rescue Layer)
    if (rawOcrBlocks && rawOcrBlocks.length > 0) {
      console.log(`   ✅ Rescue Layer Targets (First 3 of ${rawOcrBlocks.length}):`);
      rawOcrBlocks.slice(0, 3).forEach((t, i) => {
        console.log(`      [${i}] ID: "${t.id}" | Text: "${(t.text || '').substring(0, 20)}..."`);
      });
    }
    console.log('------------------------------------------------------------------\n');

    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));

    const markingInputs = {
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
    };

    const markingResult = await MarkingInstructionService.executeMarking(markingInputs);

    // =========================================================================
    // 🛡️ THE IRON DOME (Sanitization)
    // Before we do ANYTHING else, we scrub the result for False Positives.
    // =========================================================================
    if (markingResult.annotations) {
      markingResult.annotations = sanitizeAnnotations(
        markingResult.annotations,
        markingInputs.processedImage.rawOcrBlocks
      );
    }
    // =========================================================================

    // ✅ DIAGNOSTIC: Truth vs. Hallucination Table
    console.log(generateDiagnosticTable(
      markingResult.annotations || [],
      markingInputs.processedImage.rawOcrBlocks
    ));

    // =========================================================================
    // 🧮 DETERMINISTIC LINKER (The Proper Fix)
    // Runs AFTER sanitization to authoritatively restore valid links.
    // =========================================================================
    if (markingResult.annotations) {
      console.log("🧮 [DETERMINISTIC-LINK] Running post-sanitization verification...");

      // 1. Capture AI Status Map (ID -> Status)
      const aiStatusMap = new Map<string, string>();
      (markingResult.annotations || []).forEach((a: any) => {
        if (a.line_id) aiStatusMap.set(a.line_id, a.ocr_match_status);
      });

      const pageDims = task.pageDimensions?.get(task.sourcePages?.[0] || 0);
      const pageHeight = pageDims?.height || 2000;

      markingResult.annotations = resolveLinksWithZones(
        markingResult.annotations,
        markingInputs.processedImage.landmarks,
        markingInputs.processedImage.rawOcrBlocks,
        pageHeight
      );

      // 2. Restore AI Raw Status (Survive Object Replacement)
      markingResult.annotations.forEach((a: any) => {
        if (a.line_id && aiStatusMap.has(a.line_id)) {
          a.ai_raw_status = aiStatusMap.get(a.line_id);
        }
        if (!a.ai_raw_status) a.ai_raw_status = 'UNKNOWN';
      });
    }
    // =========================================================================

    const rawAnnotationsFromAI = JSON.parse(JSON.stringify(markingResult.annotations || []));

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


    // =========================================================================
    // 🔄 PHASE 1: LOGICAL RE-HOMING (ID Correction)
    // =========================================================================
    console.log(`\n🔍 [ANNOTATION-AUDIT] Phase 1: ID Correction for Q${questionId}`);

    // Fix IDs and resolve handwritten locks BEFORE calculating final positions
    let correctedAnnotations = explodedAnnotations.map(anno => {
      // 1. Sanitize AI-provided ID
      // This strips hallucinations like "p 0 _ q 12" -> "p0_q12"
      const currentId = sanitizeAiLineId(anno.line_id || anno.lineId || "");
      anno.line_id = currentId; // Update annotation with clean ID

      const sourceStep = stepsDataForMapping.find(s => s.line_id === currentId || s.globalBlockId === currentId);

      // [REVERT V32] No longer skip line_ IDs. Allow them to flow into fuzzy snapping
      // so we use Mathpix block coordinates instead of Gemini percentage coordinates.
      // if (currentId.startsWith('line_')) return anno;

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
              (anno as any).aiMatchedId = currentId; // Preserve original ID (e.g., line_13) for transparency
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

    console.log(`🔍 [PIPELINE-PROOF] Incoming Annotation Count: ${correctedAnnotations.length}`);
    if (correctedAnnotations.length > 0) {
      console.log(`   👉 IDs: ${correctedAnnotations.map(a => a.line_id || 'null').join(', ')}`);
    }

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

      // BIBLE §3B & §4 COMPLIANCE
      // If the AI found a mark but couldn't anchor it (no line_id),
      // we must trust the AI's semantic subQuestion intent over spatial heuristics.
      if (!anno.line_id || anno.ocr_match_status === 'UNMATCHED') {
        if (anno.subQuestion) {
          console.log(`      🛡️ [BIBLE-COMPLIANCE] Trusting AI subQuestion '${anno.subQuestion}' for Ghost Mark`);
        } else {
          // Only fall back to spatial guessing if the AI was silent
          const zones = Object.entries(semanticZones || {}).map(([label, data]) => ({ label, ...data }));
          const guessedSubQ = zones[0]?.label || "unknown";
          console.log(`      🛡️ [BIBLE-COMPLIANCE] AI silent on subQuestion. Defaulting Ghost Mark to '${guessedSubQ}'`);
          anno.subQuestion = guessedSubQ;
        }
      }

      // A. ZONE ENFORCEMENT
      // 🛡️ CRITICAL FIX: NEVER Move a "MATCHED" OCR Annotation OR a "VISUAL/REDIRECTED" mark
      // If Mathpix found the text exactly, we trust Mathpix's coordinates 100%.
      // If the system redirected the mark to handwriting for precision, we trust that too.
      // We ONLY apply Zone Snapping to "UNMATCHED" or "FALLBACK" annotations.
      const isVisual = anno.ocr_match_status === 'VISUAL' || String(anno.line_id || '').startsWith('visual_redirect_');

      if (anno.subQuestion && anno.bbox && semanticZones && anno.ocr_match_status !== 'MATCHED' && !isVisual) {
        // Clean SubQ: "10(a)" -> "10a", "(b)(i)" -> "bi"
        let fullSubQ = anno.subQuestion.replace(/[()\s]/g, '').toLowerCase();
        let partOnlySubQ = anno.subQuestion.replace(/^\d+/, '').replace(/[()\s]/g, '').toLowerCase();

        // Strategy: Try Full Match first (e.g. "10a"), then 'q' prefixed (e.g. "q10"), then Part Match (e.g. "a")
        let targetZone = semanticZones[fullSubQ] || semanticZones[`q${fullSubQ}`] || semanticZones[partOnlySubQ];

        // Try Recursive Fallback for parts (e.g. "bi" -> "b")
        if (!targetZone && partOnlySubQ.length > 1) {
          targetZone = semanticZones[partOnlySubQ.charAt(0)]; // "b" from "bi"
        }

        if (targetZone) {
          const currentY = anno.bbox[1];
          const subQToLog = fullSubQ || partOnlySubQ;
          // If annotation is drifting (or falling back), snap it.
          // We trust the zone even if the AI is slightly off.
          if (currentY < targetZone.startY || currentY > targetZone.endY || (anno.bbox[0] === 0)) {
            console.log(`      🛡️ [ZONE SNAP] "${anno.text}" snapped to ${subQToLog} (Y=${Math.round(targetZone.startY)})`);

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
      const text = (a.text || '').trim();
      // Atomic Math Check
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
    // 🧮 PHASE 5: TRUSTED SCORE CALCULATION
    // =========================================================================
    // We explicitly TRUST the score from the Parser (MarkingResultParser).
    // It already handles Atomic Math, Mark Capping, and Generic Mode logic.
    // DO NOT use regex here - it accidentally sums LaTeX numbers like \sqrt{27}.
    const parsedScore: any = parseScore(markingResult.studentScore);

    // [OPTIONAL] Sanity Check: If Parser said 0 but we have ticks, force at least count of ticks
    if (parsedScore.awardedMarks === 0 && sanitizedAnnotations.length > 0) {
      const hasTicks = sanitizedAnnotations.some(a =>
        (a.action && !a.action.includes('cross')) ||
        (a.text && !a.text.includes('0') && !a.text.toLowerCase().includes('lost'))
      );
      if (hasTicks) {
        // Safe fallback: 1 mark per valid annotation, capped at total
        const count = sanitizedAnnotations.filter(a => !a.action?.includes('cross')).length;
        const budget = parsedScore.totalMarks || (task.markingScheme?.totalMarks ? Number(task.markingScheme.totalMarks) : 99);
        parsedScore.awardedMarks = Math.min(count, budget);
      }
    }

    // CRITICAL: Final safety net for totalMarks denominator
    if (parsedScore.totalMarks === 0 && task.markingScheme?.totalMarks) {
      parsedScore.totalMarks = Number(task.markingScheme.totalMarks);
    }

    // Final score consistency
    parsedScore.scoreText = `${parsedScore.awardedMarks}/${parsedScore.totalMarks}`;

    console.log(`[SCORE DEBUG] Q${questionId}: rawScore=${JSON.stringify(markingResult.studentScore)}, finalAwarded=${parsedScore.awardedMarks}, finalTotal=${parsedScore.totalMarks}, schemeTotal=${task.markingScheme?.totalMarks}`);

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
      rawAnnotations: rawAnnotationsFromAI
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
        subQuestionPageMap: {},
        lineCounter: 1 // 🛠️ BUG FIX: Question-wide counter to prevent ID collisions
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
      // ✅ POPULATE CLASSIFICATION BLOCKS (For Global Offset Calculation)
      const nodeBox = node.box || node.region || node.rect || node.coordinates;
      if (nodeBox) {
        group.classificationBlocks.push({
          id: `class_block_${baseQNum}_${node.part || 'main'}`,
          text: node.text || '',
          box: nodeBox,
          pageIndex: node.pageIndex ?? currentQPageIndex
        });
      }

      if (node.studentWorkLines) {
        node.studentWorkLines.forEach((l: any) => {
          if (l.text === '[DRAWING]') return;
          const pIdx = l.pageIndex ?? node.pageIndex ?? currentQPageIndex;
          l.pageIndex = pIdx;

          // GLOBAL ID: p{Page}_q{Question}_line_{Index}
          // 🛠️ BUG FIX: Use group.lineCounter instead of per-node lineIdx to prevent collisions
          const globalId = `p${pIdx}_q${baseQNum}_line_${group.lineCounter++}`;

          // Update the line object itself (MANDATORY OVERRIDE)
          l.id = globalId;
          l.lineId = globalId;

          group.aiSegmentationResults.push({
            content: l.text,
            source: 'classification',
            // Use the global ID for the blockId as well for consistency
            blockId: globalId, // EXPLICIT Global ID
            lineData: { ...l, id: globalId, lineId: globalId }, // Spread + Explicit Override to prevent shadowing
            sequentialId: globalId, // EXPLICIT Global ID
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
          // 🛠️ BUG FIX: Unique ID for drawings across sub-questions
          const lineGlobalId = `p${pIdx}_q${baseQNum}_line_drawing_${group.lineCounter++}`;
          const line = {
            id: lineGlobalId, // Unique ID for drawing
            text: "[DRAWING]",
            pageIndex: pIdx,
            position: pos
          };
          node.studentWorkLines.push(line);
          group.aiSegmentationResults.push({
            content: "[DRAWING]",
            source: "classification",
            blockId: lineGlobalId, // EXPLICIT Global ID
            lineData: line,
            sequentialId: lineGlobalId, // EXPLICIT Global ID
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
          b.globalBlockId = `p${pageIndex}_ocr_${ocrIdx++}`;
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

    // Global IDs (p0_q12_line_1) are now preserved. 

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
        // ID VISIBLE: Inject explicit ID for strict copy-pasting
        // If sequentialId is missing (unlikely), fallback to index
        const idTag = seg.sequentialId ? `[ID: ${seg.sequentialId}] ` : `${index + 1}. `;
        promptMainWork += `${idTag}${clean}\n`;
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

/**
 * Deterministic Linker (Smart Mode):
 * 1. Audits the AI's link. If valid, keeps it.
 * 2. If invalid (or missing), hunts for the correct link using strict Zone + Value logic.
 */
function resolveLinksWithZones(
  annotations: any[],
  landmarks: { label: string; y: number }[],
  allOcrBlocks: any[],
  pageHeight: number
): any[] {

  return annotations.map(anno => {
    // 1. SKIP VISUAL annotations (Trust AI for drawings)
    if (anno.ocr_match_status === "VISUAL") return anno;

    // 2. DEFINE THE ZONE
    // Robust matching for subQuestion labels (e.g. "10a" -> "a")
    const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanSubQ = clean(anno.subQuestion || '');

    let zone: { startY: number; endY: number };
    let currentLandmark = landmarks.find(l => cleanSubQ.endsWith(clean(l.label))) ||
      landmarks.find(l => cleanSubQ.startsWith(clean(l.label)));

    // If no specific landmark found, check if it's the FIRST sub-question (e.g. 'a', 'ai').
    // If so, default to Start of Page/Question (Y=0).
    if (!currentLandmark) {
      // Check if it's the FIRST sub-question part (e.g. 'a', 'ai') OR a raw Question Number (e.g. '10', '2').
      const isNumeric = /^\d+$/.test(cleanSubQ);
      const firstPart = isNumeric || ['a', 'ai', 'i', '1'].includes(cleanSubQ) || cleanSubQ.endsWith('a') || cleanSubQ.endsWith('ai');

      if (firstPart) {
        console.log(`      📍 [ZONE-DEFAULT] No landmark for '${anno.subQuestion}', defaulting to Start (Y=0).`);
        zone = { startY: 0, endY: landmarks[0]?.y || pageHeight };
        // Mock landmark to prevent crash downstream
        currentLandmark = { label: 'START', y: 0 };
      } else {
        console.log(`      ⚠️ [ZONE-SKIP] No landmark found for '${anno.subQuestion}'`);
        return anno; // Skip this annotation if no landmark and not a recognized first sub-question
      }
    } else {
      // Find next landmark to define bottom of zone
      const currentIdx = landmarks.indexOf(currentLandmark);
      const nextLandmark = landmarks[currentIdx + 1];

      zone = {
        startY: Math.max(0, currentLandmark.y - 50), // Buffer for inline/tall content
        endY: nextLandmark ? nextLandmark.y : pageHeight
      };
    }

    // Preserve original AI status for logging/debugging
    if (!(anno as any).ai_raw_status) {
      (anno as any).ai_raw_status = anno.ocr_match_status;
    }

    // =========================================================================
    // 🕵️ STEP A: AUDIT THE AI'S CHOICE (Trust but Verify)
    // =========================================================================
    // Support both underscore and camelCase from AI. Also check if line_id itself is physical.
    const physicalId = anno.linked_ocr_id || anno.linkedOcrId || (anno.line_id?.startsWith('p') && anno.line_id?.includes('_ocr_') ? anno.line_id : null);

    if (anno.ocr_match_status === "MATCHED" && physicalId) {
      const aiChosenBlock = allOcrBlocks.find(b => b.id === physicalId);

      if (aiChosenBlock) {
        const blockY = aiChosenBlock.coordinates?.y ??
          (Array.isArray(aiChosenBlock.bbox) ? aiChosenBlock.bbox[1] :
            Array.isArray(aiChosenBlock.box) ? aiChosenBlock.box[1] :
              aiChosenBlock.box?.y) ?? 0;
        const inZone = blockY >= zone.startY && blockY <= zone.endY;
        const textMatch = isExactValueMatch(aiChosenBlock.text, anno.student_text || anno.text);

        if (inZone) {
          // ✅ SPATIAL SOVEREIGNTY: If AI ID is in the valid Zone, TRUST IT.
          // This bypasses OCR typos (e.g. "anites" vs "counters") generically.
          if (!textMatch) {
            console.log(`   🛡️ [SPATIAL-TRUST] Text mismatch ('${anno.student_text}' vs '${aiChosenBlock.text}') ignored because ID '${aiChosenBlock.id}' is in Zone ${currentLandmark.label}.`);
          }
          return anno;
        } else {
          console.log(`   ⚖️ [AI-AUDIT-FAIL] AI linked '${anno.student_text}' to block ${aiChosenBlock.id} ("${aiChosenBlock.text}"), but it failed validation (Zone: ${inZone}, Text: ${textMatch}). Overriding...`);
          // Fall through to Step B to find the REAL match
        }
      }
    }

    // =========================================================================
    // 🦅 STEP B: DETERMINISTIC HUNT (The Override)
    // AI failed or was unmatched. We search for the correct block ourselves.
    // =========================================================================

    // 1. Spatial Filter (Get candidates in the Zone)
    const candidates = allOcrBlocks.filter(block => {
      const y = block.coordinates?.y ??
        (Array.isArray(block.bbox) ? block.bbox[1] :
          Array.isArray(block.box) ? block.box[1] :
            block.box?.y) ?? 0;
      return y >= zone.startY && y <= zone.endY;
    });

    console.log(`      📍 [ZONE-TRACE] Anno '${anno.subQuestion || '?'}' -> Landmark '${currentLandmark.label}' (Y=${zone.startY}-${zone.endY}). Candidates: ${candidates.length}`);

    // 🔍 CANDIDATE DUMP
    if (candidates.length > 0) {
      console.log(`      🧐 [CANDIDATES-DUMP] Zone ${currentLandmark.label}:`);
      candidates.forEach(c => {
        const y = c.coordinates?.y ??
          (Array.isArray(c.bbox) ? c.bbox[1] :
            Array.isArray(c.box) ? c.box[1] :
              c.box?.y) ?? 0;
        console.log(`         - [${c.id}] (Y=${y}) Text: "${c.text}"`);
      });
    }

    // 2. Semantic Match (Find exact or fuzzy text)
    const match = candidates.find(block => isExactValueMatch(block.text, anno.student_text || anno.text));

    if (match) {
      console.log(`   ✅ [LINK-RESTORED] Found correct match for '${anno.student_text || anno.text}' -> Block ${match.id} (Zone ${currentLandmark.label})`);
      return {
        ...anno,
        ocr_match_status: "MATCHED",
        linked_ocr_id: match.id,
        reasoning: `${anno.reasoning} [System Verified: Found in Zone ${currentLandmark.label}]`
      };
    } else {
      // 3. No match found in the correct zone.
      // If AI had a bad match, we must kill it (False Positive).
      if (anno.ocr_match_status === "MATCHED") {
        console.log(`   🚫 [LINK-KILLED] '${anno.student_text}' was falsely matched by AI. No valid OCR found in Zone ${currentLandmark.label} (${zone.startY}-${zone.endY}). Resetting to UNMATCHED.`);
        // Log candidates for debugging
        console.log(`      Candidates in zone: ${candidates.map(c => `[${c.id}: ${c.text}]`).join(', ')}`);
        return { ...anno, ocr_match_status: "UNMATCHED", linked_ocr_id: null };
      }
      return anno;
    }
  });
}

/**
 * Calculates the Levenshtein distance between two strings.
 * @param s1 The first string.
 * @param s2 The second string.
 * @returns The Levenshtein distance.
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
        dp[i - 1][j] + 1,      // Deletion
        dp[i][j - 1] + 1,      // Insertion
        dp[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  return dp[m][n];
}

function isExactValueMatch(ocrText: string, studentText: string): boolean {
  if (!studentText || !ocrText) return false;

  // Aggressive Normalization
  const clean = (str: string) => str.toLowerCase()
    .replace(/[\s\\]/g, '') // remove spaces and backslashes
    .replace(/frac|sqrt|times|div|rightarrow|Rightarrow|approx/g, '') // strip latex commands
    .replace(/[(){}\[\]\/]/g, ''); // strip brackets and FORWARD SLASHES

  const sClean = clean(studentText);
  const oClean = clean(ocrText);

  // 1. Exact Match (Normalized)
  if (sClean === oClean) return true;
  if (oClean.includes(sClean)) return true; // Containment fallback

  // 2. [NEW] NUMERIC FIDELITY CHECK
  // If the numbers match EXACTLY, we can be much more lenient with the words.
  const sDigits = sClean.replace(/[^0-9]/g, '');
  const oDigits = oClean.replace(/[^0-9]/g, '');

  if (sDigits.length > 0 && sDigits === oDigits) {
    const dist = levenshteinDistance(sClean, oClean);
    // Allow up to 40% of the string to be different if digits match
    const lenientThreshold = Math.max(3, Math.ceil(sClean.length * 0.4));
    if (dist <= lenientThreshold) {
      console.log(`      ✨ [NUMERIC-PASS] "${studentText}" ~= "${ocrText}" (Digits ${sDigits} match, Dist: ${dist}/${lenientThreshold})`);
      return true;
    }
  }

  // 3. Fuzzy Match (Levenshtein) for typos (e.g. 5/3 vs 3/3)
  // Only allow strict edit distance based on length
  const dist = levenshteinDistance(sClean, oClean);
  const allowedEdits = sClean.length < 5 ? 0 : sClean.length < 10 ? 1 : 2;

  if (dist <= allowedEdits) {
    console.log(`      ✨ [FUZZY-MATCH] "${studentText}" ~= "${ocrText}" (Dist: ${dist}, Allowed: ${allowedEdits})`);
    return true;
  }

  return false;
}
