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

        // NO-OP: Delayed Transformation (Keep relative units for Prompt)

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

    // [NEW] Extract expected sub-questions with texts to guide text-driven zone detection
    // ✅ [ZONE STRUCTURE ENHANCEMENT] 
    // We synchronize the physical question structure (Classification) with the zone detector.
    // Non-past-papers often have generic marking schemes, but the classification data contains the real physical labels (Q12, Q13, etc).
    let classificationExpected: Array<{ label: string; text: string }> = deriveExpectedQuestionsFromClassification(task);

    // [GARBAGE FILTER] Explicit blacklist of internal keys to prevent Zone Detector confusion
    const IGNORED_KEYS = [
      'id', 'examdetails', 'totalquestions', 'totalmarks', 'confidence', 'generalmarkingguidance',
      'questionmarks', 'parentquestionmarks', 'questionnumber', 'questiondetection', 'databasequestiontext',
      'subquestionnumbers', 'subquestionanswers', 'isgeneric', 'sourceimageindex', 'classificationblocks',
      'aisegmentationresults', 'subquestionmetadata', 'linecounter', 'pageindex',
      'subquestionmaxscores', 'subquestiontexts' // [FIX] Prevent meta keys from becoming zones
    ];

    const schemeObj = task.markingScheme as any;
    // [DS-FIX] 1. TRUST DATABASE LIST (Don't guess specific keys)
    // Preference: subQuestionMaxScores (if structured) -> allQuestions (list) -> NO FALLBACK to raw keys (prevents meta-garbage)
    const subQuestionLabels = schemeObj?.subQuestionMaxScores ? Object.keys(schemeObj.subQuestionMaxScores) :
      schemeObj?.allQuestions ? Object.keys(schemeObj.allQuestions) :
        []; // If no explicit list, return empty (force fallback to Classification or Block-based matching)

    const schemeExpected = subQuestionLabels
      .map(rawLabel => {
        // [SYNC-FIX] Normalize to Full Label (e.g. "a" -> "3a")
        // SAFE-APPEND: If it already starts with questionId, keep it. Otherwise, prefix it.
        const label = rawLabel.startsWith(String(questionId)) ? rawLabel : `${questionId}${rawLabel}`;
        return label;
      })
      .filter(label => {
        // [SAFE-RECOVERY] Only include labels related to this questionId
        // This prevents "pollution" from other questions if the scheme is shared
        const base = label.replace(/\D/g, '');
        return base === String(questionId) || label.startsWith(String(questionId));
      })
      .map(label => {
        // Find the raw key in schemeObj. AllQuestions or subQuestionTexts
        // Try both the prefixed and original labels to find the text
        const rawLabel = label.startsWith(String(questionId)) ? label.substring(String(questionId).length) : label;
        const questionText = (schemeObj?.subQuestionTexts?.[label]) || (schemeObj?.allQuestions?.[label]) ||
          (schemeObj?.subQuestionTexts?.[rawLabel]) || (schemeObj?.allQuestions?.[rawLabel]) || "";
        return { label, text: questionText };
      }).filter(q => q.label.length > 0 && !IGNORED_KEYS.includes(q.label.toLowerCase()));

    // ✅ [DATASOURCE STRATEGY] SINGLE SOURCE OF TRUTH
    let expectedQuestions: Array<{ label: string; text: string; targetPageIndex?: number }> = [];

    if (schemeExpected.length > 0) {
      // PAST PAPER MODE: Database/Scheme is King.
      console.log(`   🏛️ [ZONE-STRATEGY] Past Paper Detected (DB Schema Available). Using ${schemeExpected.length} DB-verified zones.`);

      // [MAPPER-TRUTH] Enrich with Page Index from Classification Blocks
      expectedQuestions = schemeExpected.map(q => {
        // Find matching block
        const matchBlock = task.classificationBlocks?.find(cb => {
          const cbPart = (cb as any).part || (cb as any).blockId?.split('_').pop();
          // Support both direct match (3a === 3a) and stripped match (a === a)
          const qPartOnly = q.label.startsWith(String(questionId)) ? q.label.substring(String(questionId).length) : q.label;
          return cbPart === q.label || cbPart === qPartOnly;
        });

        if (matchBlock && (matchBlock as any).pageIndex !== undefined) {
          return { ...q, targetPageIndex: (matchBlock as any).pageIndex };
        }
        return q;
      });

    } else {
      // GENERIC MODE OR FALLBACK
      // If Database returned nothing (e.g. Q4 had no sub-qs list), verify against Classification Blocks
      // The Mapper found "Q4" block? Use it.

      // Try to rebuild from Classification Blocks if Scheme failed
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

    console.log(`🔍 [ZONE SCAN] Targeting ${expectedQuestions.length} sub-questions for Q${questionId}`);

    // [DEBUG-USER-REQUEST] Inspect what we are sending for Zone Creation (Critical for Past Paper comparison)
    console.log(`   🏗️ [ZONE-INPUT] Expected Questions Payload:`);
    expectedQuestions.forEach((q, idx) => {
      console.log(`      [${idx}] Label: "${q.label}" | Text: "${(q.text || '').substring(0, 30)}..."`);
    });

    // Create temp blocks list for zone detection
    const rawOcrBlocksForZones = task.mathBlocks.map((block) => ({
      text: block.mathpixLatex || block.googleVisionText || '',
      coordinates: block.coordinates,
      pageIndex: (block as any).pageIndex ?? 0
    }));

    // [SEMANTIC-STOP] Resolve Next Question Text for Zone Termination
    // 1. Prioritize Physical Lookahead injected during task creation
    let nextQuestionText = task.nextQuestionText;

    if (!nextQuestionText) {
      // 2. Fallback to Physical Order from Classification Buttons (Mapper)
      const blocks = task.classificationBlocks || [];
      const currentBlockIdx = blocks.findIndex(b =>
        (b as any).questionNumber === questionId ||
        (b as any).part === questionId ||
        (b as any).subQuestions?.some((sq: any) => sq.part === questionId || sq.questionNumber === questionId)
      );

      if (currentBlockIdx !== -1 && currentBlockIdx < blocks.length - 1) {
        const nextBlock = blocks[currentBlockIdx + 1];
        nextQuestionText = (nextBlock as any).text;
        console.log(`   🛑 [SEMANTIC-STOP] Resolved Next Q (Mapper): ${(nextBlock as any).part || (nextBlock as any).questionNumber} -> "${(nextQuestionText || '').substring(0, 20)}..."`);
      } else {
        // 3. Fallback to DB Scheme if Mapper fails (e.g. generic catch-all bucket)
        const allQs = schemeObj?.allQuestions ? Object.keys(schemeObj.allQuestions) : [];
        const currentIdx = allQs.indexOf(String(questionId));
        if (currentIdx !== -1 && currentIdx < allQs.length - 1) {
          const nextQ = allQs[currentIdx + 1];
          nextQuestionText = (schemeObj.allQuestions[nextQ] || schemeObj.subQuestionTexts?.[nextQ] || "");
          console.log(`   🛑 [SEMANTIC-STOP] Resolved Next Q (DB): ${nextQ} -> "${(nextQuestionText || '').substring(0, 20)}..."`);
        }
      }
    } else {
      console.log(`   🛑 [SEMANTIC-STOP] Using Lookahead Signal: "${nextQuestionText.substring(0, 20)}..."`);
    }

    const semanticZones = MarkingPositioningService.detectSemanticZones(
      rawOcrBlocksForZones,
      pageHeightForZones,
      expectedQuestions,
      nextQuestionText // <--- PASS THE STOP SIGNAL
    );
    console.log(`\n🔍 [ZONE DEBUG] Detected Semantic Zones:`, Object.keys(semanticZones).join(', '));

    // BIBLE §2 COMPLIANCE (REFINED): "Isolate Rescue Layer"
    // To ensure "Perfect Placement", the AI must ONLY see raw geometric IDs (p0_ocr...)
    // in the Rescue Layer. If we include semantic IDs (p0_q...), the AI will pick them
    // and bypass the precise Mathpix coordinates.
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
        landmarks: Object.entries(semanticZones).flatMap(([label, zones]) =>
          zones.map(data => ({
            label,
            y: data.startY,
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

    // =========================================================================
    // 🛡️ THE IRON DOME (Sanitization)
    // Before we do ANYTHING else, we scrub the result for False Positives.
    // =========================================================================
    if (markingResult.annotations) {
      // 🔥 NEW: Generate Instruction Heat Map to avoid anchoring marks to question text
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


    // MERGE RESCUE LAYER: Combine segmented steps with raw OCR blocks to prevent data loss during positioning.
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
          unit: 'pixels', // CRITICAL: Preserve raw Mathpix coordinate fidelity
          _source: 'RESCUE_RAW',
          isHandwritten: block.isHandwritten
        };
      })
    ];

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
      semanticZones // NEW: Pass landmarks for per-annotation scoping
    ).filter(anno => (anno.text || '').trim() !== '');

    // =========================================================================
    // 🛡️ ENRICHMENT COMPLETE
    // All spatial logic (Snapping, Clamping, Stacking) is now handled by 
    // AnnotationEnrichmentService. No further spatial mutation allowed.
    // =========================================================================

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
      rawAnnotations: rawAnnotationsFromAI,
      semanticZones: semanticZones
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

  // [DEBUG-USER-REQUEST] Raw Classification Dump
  if (process.env.DEBUG_RAW_CLASSIFICATION_RESPONSE === 'true') {
    console.log('\n🔍 [RAW-CLASSIFICATION-DUMP] Full JSON Response:', JSON.stringify(classificationResult, null, 2));
  }

  console.log(`\n📋 [METADATA-PERSISTENCE] Processing ${classificationResult.questions.length} questions from classification...`);

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
        subQuestionMetadata: { hasSubQuestions: false, subQuestions: [] }, // NEW: Metadata container
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

    // ✅ [SMART-SNAP FIX]: Persist the RAW question object (with studentWorkLines) 
    // This allows AnnotationEnrichmentService to look up geometry using line_ids.
    group.classificationBlocks.push(q);

    const allNodes = flattenQuestionTree(q);

    allNodes.forEach((node: any) => {
      // ✅ POPULATE CLASSIFICATION BLOCKS (For Global Offset Calculation & Zone Creation)
      // Standardize ID: class_block_{baseQNum}_{part}
      const blockId = `class_block_${baseQNum}_${node.part || 'main'}`;
      const nodeBox = node.box || node.region || node.rect || node.coordinates;

      // ✅ [OFFSET SAFETY]: Only add to classificationBlocks if it has a valid box.
      // This prevents legacy offset logic from crashing on box-less worksheet headers.
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

      // ✅ [LABELS PERSISTENCE]: Always add to subQuestionMetadata for zone detection
      // [GARBAGE FILTER] Explicit blacklist of internal keys to prevent Zone Detector confusion
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
        // Parent metadata
        (group.subQuestionMetadata as any).mainText = node.text || '';
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

  sortedQuestionGroups.forEach(([baseQNum, group], idx) => {
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

    // [SEMANTIC-STOP] Lookahead for zone termination
    let nextQuestionText: string | undefined;
    const nextGroup = sortedQuestionGroups[idx + 1];
    if (nextGroup) {
      nextQuestionText = nextGroup[1].mainQuestion.text;
    }

    tasks.push({
      questionNumber: baseQNum,
      questionText: group.mainQuestion.text,
      nextQuestionText: nextQuestionText, // ✅ [STOP-SIGNAL] Correct Lookahead
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
  landmarks: { label: string; y: number; pageIndex?: number }[],
  allOcrBlocks: any[],
  pageHeight: number
): any[] {
  // 🛡️ [CRITICAL] Sort landmarks by Y to ensure "Next Landmark" logic works physically.
  // This prevents inverted zones (Start > End) if landmarks are ingested out of order.
  landmarks = landmarks.sort((a, b) => {
    if (a.pageIndex !== b.pageIndex) return (a.pageIndex || 0) - (b.pageIndex || 0);
    return a.y - b.y;
  });

  return annotations.map(anno => {
    // 0. Preserve original AI status for logging/debugging
    if (!(anno as any).ai_raw_status) {
      (anno as any).ai_raw_status = anno.ocr_match_status;
    }

    // 1. SKIP VISUAL annotations (Trust AI for drawings)
    if (anno.ocr_match_status === "VISUAL") return anno;

    // 2. DEFINE THE ZONE
    // Robust matching for subQuestion labels (e.g. "10a" -> "a")
    const clean = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanSubQ = clean(anno.subQuestion || '');

    let zone: { startY: number; endY: number };

    // [V28 ENHANCEMENT] Multi-char suffix aware filter
    const allMatchingLandmarks = landmarks.filter(l => cleanSubQ.endsWith(clean(l.label)) || cleanSubQ.startsWith(clean(l.label)));

    // Sort by label length (DESC) to favor "ii" over "i"
    const matchingLandmarks = allMatchingLandmarks.sort((a, b) => b.label.length - a.label.length);

    // [V28 FIX] Pick the BEST landmark if multiple exist.
    const b = anno.bbox || [0, 0, 0, 0];
    const originalY = b[1];
    let currentLandmark = matchingLandmarks.find((l, idx) => {
      const next = landmarks[landmarks.indexOf(l) + 1];
      const start = Math.max(0, l.y - 50);
      const end = next ? next.y : pageHeight;
      return originalY >= start && originalY <= end;
    }) || matchingLandmarks[0];

    if (currentLandmark && matchingLandmarks.length > 1) {
      console.log(`      🎯 [LINK-ZONE-TRACE] SubQ '${anno.subQuestion}' matched multiple landmarks. Best Fit: '${currentLandmark.label}'`);
    }

    // If no specific landmark found, check if it's the FIRST sub-question (e.g. 'a', 'ai').
    if (!currentLandmark) {
      const isNumeric = /^\d+$/.test(cleanSubQ);
      const firstPart = isNumeric || ['a', 'ai', 'i', '1'].includes(cleanSubQ) || cleanSubQ.endsWith('a') || cleanSubQ.endsWith('ai');

      if (firstPart) {
        console.log(`      📍 [ZONE-DEFAULT] No landmark for '${anno.subQuestion}', defaulting to Start (Y=0).`);
        zone = { startY: 0, endY: landmarks[0]?.y || pageHeight };
        currentLandmark = { label: 'START', y: 0 };
      } else {
        console.log(`      ⚠️ [ZONE-SKIP] No landmark found for '${anno.subQuestion}'`);
        return anno;
      }
    } else {
      const currentIdx = landmarks.indexOf(currentLandmark);
      const nextLandmark = landmarks[currentIdx + 1];

      zone = {
        startY: Math.max(0, currentLandmark.y - 50),
        endY: (nextLandmark && nextLandmark.pageIndex === currentLandmark.pageIndex) ? nextLandmark.y : pageHeight
      };
    }

    // =========================================================================
    // 🛡️ IRON DOME: SIMPLE ZONE PROTECTION
    // =========================================================================
    const physicalId = anno.linked_ocr_id || anno.linkedOcrId || (anno.line_id?.startsWith('p') && anno.line_id?.includes('_ocr_') ? anno.line_id : null);

    if (physicalId) {
      const aiChosenBlock = allOcrBlocks.find(b => b.id === physicalId);

      if (aiChosenBlock) {
        const blockY = aiChosenBlock.coordinates?.y ??
          (Array.isArray(aiChosenBlock.bbox) ? aiChosenBlock.bbox[1] :
            Array.isArray(aiChosenBlock.box) ? aiChosenBlock.box[1] :
              aiChosenBlock.box?.y) ?? 0;

        const inZone = blockY >= zone.startY && blockY <= zone.endY;

        if (!inZone && (anno.ocr_match_status === "MATCHED" || (anno as any)._pipeline_action === "AI PRECISE (V4)")) {
          console.log(`   ⚖️ [IRON-DOME-VETO] AI linked '${anno.student_text}' to block ${aiChosenBlock.id}, but it is at Y=${Math.round(blockY)}, outside Zone ${currentLandmark.label} (${Math.round(zone.startY)}-${Math.round(zone.endY)}). Overriding to UNMATCHED.`);

          return {
            ...anno,
            ocr_match_status: "UNMATCHED",
            linked_ocr_id: null,
            _pipeline_action: "IRON DOME VETO"
          };
        } else if (inZone) {
          console.log(`   ✅ [IRON-DOME-PASS] AI link to ${aiChosenBlock.id} is within Zone ${currentLandmark.label}`);
        }
      } else {
        console.warn(`   ⚠️ [IRON-DOME-MISS] AI pointed to ID '${physicalId}' but it was not found in the lookup table.`);
      }
    }

    return anno;
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

/**
 * STANDALONE HELPER: Extracts physical question structure (labels and text) from Classification data.
 * Used to guide zone detection for non-past-papers where marking schemes are generic.
 */
function deriveExpectedQuestionsFromClassification(task: MarkingTask): Array<{ label: string; text: string }> {
  console.log(`\n📐 [LABELS-SYNC] Analyzing Question Q${task.questionNumber}...`);

  // [DEBUG] Check input sources
  if (task.subQuestionMetadata) {
    console.log(`   🔍 [METADATA-INPUT] Found subQuestionMetadata: hasSubQuestions=${task.subQuestionMetadata.hasSubQuestions}, Count=${task.subQuestionMetadata.subQuestions.length}`);
  } else {
    console.log(`   ⚠️ [METADATA-INPUT] subQuestionMetadata is missing or empty.`);
  }

  const classificationExpected: Array<{ label: string; text: string }> = [];

  // 1. From subQuestionMetadata (Primary source for AI-detected parts)
  // [RECURSIVE-FIX] Traverse deeply to find LEAF nodes (e.g. bi, bii) and preserve path
  const traverse = (nodes: any[], parentPart: string = "") => {
    nodes.forEach(qs => {
      const currentPart = qs.part || "";
      if (qs.subQuestions && qs.subQuestions.length > 0) {
        // Recurse with current part as parent context
        traverse(qs.subQuestions, currentPart);
      } else {
        // Leaf node - add strictly
        if (currentPart) {
          // [SAFE-APPEND] Normalize to Full Label (e.g. "10bii")
          const label = currentPart.startsWith(String(task.questionNumber)) ? currentPart : `${task.questionNumber}${currentPart}`;
          classificationExpected.push({ label, text: qs.text || "" });
        }
      }
    });
  };

  if (task.subQuestionMetadata?.subQuestions) {
    traverse(task.subQuestionMetadata.subQuestions);
  }

  // 2. From classificationBlocks (Secondary source)
  // Only add if not already present (leaves already added by traversal)
  if (task.classificationBlocks) {
    task.classificationBlocks.forEach(cb => {
      let part = (cb as any).part || (cb as any).blockId?.split('_').pop();
      if (part && part !== 'main') {
        // [SAFE-APPEND] Normalize to Full Label
        const label = part.startsWith(String(task.questionNumber)) ? part : `${task.questionNumber}${part}`;
        if (!classificationExpected.some(q => q.label === label)) {
          classificationExpected.push({ label, text: cb.text || "" });
        }
      }
    });
  }

  // 3. Fallback: Base Question (Essential for past papers)
  const baseNum = String(task.questionNumber).replace(/\D/g, '');
  if (baseNum && !classificationExpected.some(q => q.label === baseNum)) {
    classificationExpected.push({ label: baseNum, text: task.questionText || "" });
  }

  console.log(`   👉 [LABELS-OUTPUT] Derived ${classificationExpected.length} labels for targeting:`, classificationExpected.map(q => q.label).join(', '));

  return classificationExpected.filter(q => q.label.length > 0);
}
