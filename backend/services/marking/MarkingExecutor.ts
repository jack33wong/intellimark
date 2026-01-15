/**
 * Marking Executor Service
 * Executes AI marking and feedback generation for a single question task
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { MarkingInstructions, Annotation, ModelType, MarkingTask, EnrichedAnnotation, MathBlock } from '../../types/index.js';
import { enrichAnnotationsWithPositions } from './AnnotationEnrichmentService.js';
// Stale import removed (MathBlock is now in types/index.js)
import type { PageOcrResult } from '../../types/markingRouter.js';
import { formatGroupedStudentWork, getQuestionSortValue } from './MarkingHelpers.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import UsageTracker from '../../utils/UsageTracker.js';

// Types for the marking executor
// MarkingTask type imported from types/index.js

export interface QuestionResult {
  questionNumber: number | string;
  score: any;
  annotations: EnrichedAnnotation[];
  feedback?: string;
  usageTokens?: number; // Add usage tokens from AI responses
  inputTokens?: number; // Add input tokens
  outputTokens?: number; // Add output tokens
  confidence?: number; // Add confidence score
  mathpixCalls?: number; // Add mathpix calls count
  markingScheme?: any; // Include marking scheme for reference
  studentWork?: string; // Raw student work text (OCR/Classification)
  promptMarkingScheme?: string; // The exact text-based marking scheme used in the prompt
  classificationBlocks?: any[]; // Classification blocks with line data
  questionText?: string; // Detected question text
  databaseQuestionText?: string; // Text from database match
  pageIndex?: number; // Primary page index for this question
  sourceImageIndices?: number[]; // NEW: All page indices this question spans (for multi-page questions)
  overallPerformanceSummary?: string; // AI-generated overall performance summary
  cleanedOcrText?: string; // OCR text without LaTeX/markers
}

// EnrichedAnnotation type imported from types/index.js

/**
 * Executes the AI marking and feedback generation for a single question task.
 * Assumes OCR data is already prepared within the task.
 */
export async function executeMarkingForQuestion(
  task: MarkingTask,
  res: any, // Pass the Response object for SSE updates
  submissionId: string, // Pass submissionId for context in SSE
  model: ModelType = 'auto', // Pass the AI model to use for marking
  allPagesOcrData?: any[], // Pass all pages OCR data for multi-page context
  tracker?: UsageTracker // UsageTracker (optional)
): Promise<QuestionResult> {

  const questionId = task.questionNumber;





  // Import createProgressData function
  const { createProgressData } = await import('../../utils/sseUtils.js');
  const MULTI_IMAGE_STEPS = ["Input Validation", "Standardization", "Preprocessing", "OCR & Classification", "Question Detection", "Segmentation", "Marking", "Output Generation"];

  sendSseUpdate(res, createProgressData(6, `Marking Question ${questionId}...`, MULTI_IMAGE_STEPS));

  try {

    // Helper function to normalize LaTeX-wrapped single letters (e.g., "\( F \)" or "$F$" → "F")
    const normalizeLaTeXSingleLetter = (text: string): string => {
      const trimmed = text.trim();
      // Match patterns like "\( F \)", "$F$", "\(F\)", "$ F $", etc.
      const singleLetterMatch = trimmed.match(/^\\?\(?\s*\$?\s*([A-Z])\s*\$?\s*\\?\)?$/);
      if (singleLetterMatch) {
        return singleLetterMatch[1]; // Return just the letter
      }
      return trimmed; // Return as-is if not a LaTeX-wrapped single letter
    };



    // 1. Prepare Question Context Map for simple positioning fallbacks
    // We now use the task.questionsOnPage map provided by createMarkingTasksFromClassification

    // Prepare STEP DATA (still need this array for enriching annotations later)
    // Use AI segmentation results if available, otherwise fall back to OCR blocks
    let stepsDataForMapping: Array<{
      line_id: string;
      pageIndex: number;
      globalBlockId?: string;
      text: string;
      cleanedText: string;
      bbox: [number, number, number, number];
      ocrSource?: string;
    }>;



    // CRITICAL FIX: In Pure Marking Mode, we want to use the RAW OCR blocks (task.mathBlocks) because they contain the accurate BBOXes.
    // The aiSegmentationResults come from Classification/Gemini which has NO spatial awareness (bbox=0).
    // If we use aiSegmentationResults, we lose the coordinates.
    // So, if we have valid mathBlocks, prioritize them over aiSegmentationResults unless aiSegmentationResults have explicit coordinates.
    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      // Use AI segmentation results - map back to original blocks for coordinates
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        // Resolve coordinates: check lineData first, then block
        let bbox: [number, number, number, number] = [0, 0, 0, 0];
        let pageIdx = -1;

        const lineData = (result as any).lineData;
        const coords = lineData?.coordinates || lineData?.position;
        const resultText = result.content || '';

        // [DEBUG] Trace matching attempt
        // console.log(`[MATCH DEBUG] Trying to match SEGMENT: "${resultText.substring(0, 20)}..." (ID: ${result.blockId})`);

        if (coords?.x != null && coords?.y != null) {
          bbox = [coords.x, coords.y, coords.width, coords.height];
          pageIdx = lineData?.pageIndex != null ? lineData.pageIndex : (task.sourcePages[0] || 0);
        } else {
          // Find the corresponding block by blockId
          let matchingBlock = task.mathBlocks.find(block => {
            const blockId = (block as any).globalBlockId || `${(block as any).pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
            return blockId === result.blockId;
          });



          if (matchingBlock?.coordinates &&
            matchingBlock.coordinates.x != null && matchingBlock.coordinates.y != null) {
            bbox = [matchingBlock.coordinates.x, matchingBlock.coordinates.y, matchingBlock.coordinates.width, matchingBlock.coordinates.height];
            pageIdx = (matchingBlock as any).pageIndex != null ? (matchingBlock as any).pageIndex : (task.sourcePages[0] || 0);
          }
        }

        // Use resolved pageIdx or fallback
        if (pageIdx === -1) {
          pageIdx = (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);
        }

        // For drawings without OCR coordinates, estimate bbox from position information
        if ((bbox[0] === 0 && bbox[1] === 0) && result.content?.includes('[DRAWING]')) {
          const annotationText = result.content.toLowerCase();
          let positionMatch = result.content.match(/\[POSITION:\s*([^\]]+)\]/i);
          let position: string | null = null;

          if (positionMatch) {
            position = positionMatch[1];
          } else if (task.classificationStudentWork) {
            const drawingEntries = task.classificationStudentWork.split(/\n|\\n/).filter(e => e.includes('[DRAWING]'));
            let bestMatch: string | null = null;

            for (const entry of drawingEntries) {
              const entryPositionMatch = entry.match(/\[POSITION:\s*([^\]]+)\]/i);
              if (entryPositionMatch) {
                const entryKeywords = entry.toLowerCase();
                const contentKeywords = result.content.toLowerCase();
                const hasMatchingKeywords =
                  (entryKeywords.includes('graph') && contentKeywords.includes('graph')) ||
                  (entryKeywords.includes('y-axis') && contentKeywords.includes('y-axis')) ||
                  (entryKeywords.includes('label') && contentKeywords.includes('label'));

                if (hasMatchingKeywords || !bestMatch) {
                  bestMatch = entryPositionMatch[1];
                  if (hasMatchingKeywords) break;
                }
              }
            }
            if (bestMatch) position = bestMatch;
          }

          const isDrawing = annotationText.includes('drawing') || annotationText.includes('graph');
          let bestBlockIndex = -1;
          for (let i = 0; i < task.classificationBlocks.length; i++) {
            const block = task.classificationBlocks[i];
            const blockText = block.text.toLowerCase();
            if (blockText.includes(annotationText) || annotationText.includes(blockText)) {
              bestBlockIndex = i;
              break;
            }
            if (isDrawing && (blockText.includes('[drawing]') || blockText.includes('graph'))) {
              if (bestBlockIndex === -1) bestBlockIndex = i;
            }
          }

          if (bestBlockIndex !== -1) {
            pageIdx = task.classificationBlocks[bestBlockIndex].pageIndex;
          }

          if (position) {
            const percentMatch = position.match(/x\s*=\s*(\d+(?:\.\d+)?)%\s*,\s*y\s*=\s*(\d+(?:\.\d+)?)%/i);
            if (percentMatch) {
              const pageDims = task.pageDimensions?.get(pageIdx);
              const pageWidth = pageDims?.width || 2000;
              const pageHeight = pageDims?.height || 3000;
              const xPercent = parseFloat(percentMatch[1]);
              const yPercent = parseFloat(percentMatch[2]);
              let drawingWidth = 300;
              let drawingHeight = 300;
              if (result.content.includes('marked at') || result.content.includes('Center of rotation')) {
                drawingWidth = 80; drawingHeight = 80;
              }
              const centerX = (xPercent / 100) * pageWidth;
              const centerY = (yPercent / 100) * pageHeight;
              bbox = [Math.max(0, centerX - drawingWidth / 2), Math.max(0, centerY - drawingHeight / 2), drawingWidth, drawingHeight];
            }
          }
        }

        // Fallback for missing coordinates
        let matchingBlockIndex = -1;
        if (bbox[0] === 0 && bbox[1] === 0 && !result.content?.includes('[DRAWING]') && task.classificationBlocks && task.classificationBlocks.length > 0) {
          const annotationText = result.content.substring(0, 30).toLowerCase();
          for (let i = 0; i < task.classificationBlocks.length; i++) {
            const blockText = task.classificationBlocks[i].text.substring(0, 30).toLowerCase();
            if (blockText.includes(annotationText) || annotationText.includes(blockText)) {
              matchingBlockIndex = i;
              break;
            }
          }

          if (matchingBlockIndex >= 0) {
            const block = task.classificationBlocks[matchingBlockIndex];
            const matchingPageIndex = block.pageIndex;
            const pageDims = task.pageDimensions?.get(matchingPageIndex);
            const pageWidth = pageDims?.width || 2000;
            const pageHeight = pageDims?.height || 3000;
            const totalBlocks = task.classificationBlocks.length;
            const blockFraction = (matchingBlockIndex + 0.5) / totalBlocks;
            const estimatedY = pageHeight * 0.15 + (pageHeight * 0.7 * blockFraction);
            bbox = [Math.max(0, pageWidth - 180), Math.max(0, estimatedY), 150, 60];
          }
        }

        // NEW: Normalize coordinates if they are percentages (from classification/estimated)
        // Classification-derived steps (line_X) use 0-100 range, but we need pixels here for consistency
        let finalBbox: [number, number, number, number] = [bbox[0], bbox[1], bbox[2], bbox[3]];
        const ocrSource = result.source || 'classification';

        if (ocrSource === 'classification' || ocrSource === 'estimated') {
          // DEFENSIVE: Only normalize if values look like percentages (0-100)
          // If they are already large (e.g. > 200), they might be pixels already
          const looksLikePercentage = bbox[0] < 150 && bbox[1] < 150;

          if (looksLikePercentage) {
            const pageDims = task.pageDimensions?.get(pageIdx);
            // FALLBACK: If page dimensions are missing, use a safe default instead of skipping
            const effectiveWidth = pageDims?.width || 2000;
            const effectiveHeight = pageDims?.height || 3000;

            if (!pageDims) {
              console.warn(`[COORD WARNING] Missing pageDimensions for Page ${pageIdx} in Q${task.questionNumber}. Using defaults (2000x3000).`);
            }

            if (bbox[0] !== 0 || bbox[1] !== 0) {
              const oldX = bbox[0];
              finalBbox[0] = (bbox[0] / 100) * effectiveWidth;
              finalBbox[1] = (bbox[1] / 100) * effectiveHeight;
              finalBbox[2] = (bbox[2] / 100) * effectiveWidth;
              finalBbox[3] = (bbox[3] / 100) * effectiveHeight;

              // Log removed
            }
          }
        }

        return {
          line_id: (result as any).sequentialId || `line_${stepIndex + 1}`,
          pageIndex: pageIdx,
          globalBlockId: result.blockId, // Preserve globalBlockId if available
          text: result.content,
          cleanedText: result.content.trim(),
          bbox: finalBbox,
          ocrSource: ocrSource
        };
      }).filter((step, index) => {
        // Filter out [DRAWING] entries that have no valid position (bbox is [0,0,0,0])
        // RELAXATION: If it's a DRAWING, do NOT filter it out even if bbox is 0.
        // This allows AI-mapped visual positions to work later.
        if (step.text.includes('[DRAWING]')) return true;

        if (step.bbox[0] === 0 && step.bbox[1] === 0 && step.bbox[2] === 0 && step.bbox[3] === 0) {
          console.log(`[MARKING EXECUTOR] 👻 Filtering out phantom block (no position) for Q${questionId} ID: ${step.line_id || index + 1}: "${step.text.substring(0, 50)}..."`);
          return false;
        }
        return true;
      });

      // NEW: Merge mathBlocks into stepsDataForMapping so AI-matched raw OCR IDs (block_X_Y) are still resolvable
      // even when aiSegmentationResults (classification) is present.
      const ocrStepsForMapping: typeof stepsDataForMapping = task.mathBlocks.map((block, ocrIdx) => {
        const blockId = (block as any).globalBlockId || `block_${task.sourcePages[0] || 0}_${ocrIdx}`;
        const rawText = block.mathpixLatex || block.googleVisionText || '';
        const normalizedText = normalizeLaTeXSingleLetter(rawText);
        const blockPageIndex = (block as any).pageIndex != null && (block as any).pageIndex >= 0
          ? (block as any).pageIndex
          : (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);

        return {
          line_id: `ocr_${ocrIdx + 1}`, // Fallback OCR ID format
          pageIndex: blockPageIndex,
          globalBlockId: blockId,
          text: normalizedText,
          cleanedText: normalizedText,
          bbox: block.coordinates && block.coordinates.x != null
            ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height]
            : [0, 0, 0, 0],
          ocrSource: block.ocrSource
        };
      });

      stepsDataForMapping = [...stepsDataForMapping, ...ocrStepsForMapping];
    } else {
      // Enhanced marking mode: Use OCR blocks directly (no matching logic)
      // AI will handle mapping classification to OCR blocks
      // We just provide OCR block coordinates for annotation enrichment

      // [DEBUG] Inspect what MarkingExecutor actually sees in task.mathBlocks
      if (task.mathBlocks.length > 0) {
        const firstB = task.mathBlocks[0];
        console.log(`[MARKING EXECUTOR DEBUG] First Block Coords Check:`, JSON.stringify({
          hasCoords: !!firstB.coordinates,
          coords: firstB.coordinates,
          text: (firstB.mathpixLatex || firstB.googleVisionText || '').substring(0, 20)
        }));
      }

      stepsDataForMapping = task.mathBlocks.map((block, stepIndex) => {
        const blockId = (block as any).globalBlockId || `block_${task.sourcePages[0] || 0}_${stepIndex}`;

        const rawText = block.mathpixLatex || block.googleVisionText || '';
        const normalizedText = normalizeLaTeXSingleLetter(rawText);

        let bbox: [number, number, number, number] = block.coordinates &&
          block.coordinates.x != null && block.coordinates.y != null &&
          block.coordinates.width != null && block.coordinates.height != null
          ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height]
          : [0, 0, 0, 0];

        // Get pageIndex from block, or fallback to task.sourcePages, or default to 0
        const blockPageIndex = (block as any).pageIndex;
        const validPageIndex = blockPageIndex != null && blockPageIndex >= 0
          ? blockPageIndex
          : (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);

        // Build step data - preserve all original coordinates and OCR source
        const stepData: any = {
          line_id: `line_${stepIndex + 1}`,
          pageIndex: validPageIndex,
          globalBlockId: (block as any).globalBlockId || blockId,
          text: normalizedText,
          cleanedText: normalizedText,
          bbox, // Keep original OCR coordinates
          ocrSource: block.ocrSource, // Preserve OCR source (Mathpix vs Google Vision)
          hasLineData: block.hasLineData // Preserve line data flag (for border color)
        };



        return stepData;
      });
    }



    // Handle [DRAWING] student work from classification (e.g., Q13a histogram, Q22a sine graph, Q11 coordinate grid)
    // If classification has [DRAWING] student work, create separate synthetic blocks for each drawing entry
    // This allows AI to return separate annotations for each drawing, which can be matched to individual blocks
    // If classification has [DRAWING] student work, create separate synthetic blocks for each drawing entry
    // This allows AI to return separate annotations for each drawing, which can be matched to individual blocks
    if (task.classificationStudentWork && task.classificationStudentWork.includes('[DRAWING]')) {
      // Split student work by \n to get individual entries (text + drawings)
      // Classification uses \n as line separator per prompt specification
      // Handle both actual newline (\n) and literal backslash+n (\\n) for backward compatibility
      const entries = task.classificationStudentWork.split(/\n|\\n/).map(e => e.trim()).filter(e => e.length > 0);

      // Helper function to estimate bbox for drawings (coordinate grids, histograms, geometric diagrams, etc.)
      // Uses order-based interpolation from OCR blocks to improve accuracy
      // AI classification returns percentage-based coordinates: [POSITION: x=XX%, y=YY%]
      // Parse percentages and convert directly to pixel coordinates
      // This is generic and works for all drawing types
      const estimateBboxForDrawing = (position: string, blocksOnSamePage: any[], pageIndex: number, drawingText: string, drawingIndexInSequence: number = -1): [number, number, number, number] => {
        // Get actual page dimensions if available
        const pageDims = task.pageDimensions?.get(pageIndex);
        const pageWidth = pageDims?.width || 2000; // Default fallback
        const pageHeight = pageDims?.height || 3000; // Default fallback

        // Debug: Log input parameters

        // Determine drawing dimensions based on type
        // ALL positions from enhanced classification represent CENTER (consistent with histograms)
        let drawingWidth = 300;
        let drawingHeight = 300;

        // For single point marks (center of rotation, marked points): use small dimensions
        // These are just marks on the grid, not full shapes
        if (drawingText.includes('marked at') || drawingText.includes('Center of rotation') ||
          drawingText.includes('Mark') || (drawingText.includes('at (') && !drawingText.includes('vertices'))) {
          // Single point mark - use small bounding box (50x50 to 100x100)
          // Position represents the center of the mark
          drawingWidth = 80;
          drawingHeight = 80;
        } else if (drawingText.includes('Coordinate grid') || drawingText.includes('vector') || (drawingText.includes('triangle') && drawingText.includes('vertices'))) {
          // For triangles/vectors on coordinate grids: use medium dimensions
          // Q8 fix: vectors also need medium boxes
          const coordsMatch = drawingText.match(/\[COORDINATES:\s*([^\]]+)\]/);
          if (coordsMatch) {
            // Coordinate grids with explicit coordinates - use medium size for triangle
            // Position is center of triangle, so use triangle size (not full grid size)
            drawingWidth = 200;
            drawingHeight = 200;
          } else {
            // Default for coordinate grids without explicit coordinates
            drawingWidth = 180;
            drawingHeight = 180;
          }
        } else if (drawingText.includes('Histogram')) {
          // Histograms: position represents center (current behavior works correctly)
          drawingWidth = 400;
          drawingHeight = 300;
        }

        // STEP 1: Try order-based interpolation using preserved MathPix reading order
        // Match classification student work entries to OCR blocks by order
        if (drawingIndexInSequence >= 0 && blocksOnSamePage.length > 0) {
          // Find surrounding blocks in the sequence
          // Blocks are already sorted by MathPix order (preserved for null Y coordinates)
          // Find blocks with coordinates that appear before and after the drawing position
          let beforeBlock: any = null;
          let afterBlock: any = null;

          // Look for blocks that appear before the drawing in the sequence
          for (let i = Math.min(drawingIndexInSequence, blocksOnSamePage.length - 1); i >= 0; i--) {
            const block = blocksOnSamePage[i];
            if (block && block.bbox && block.bbox[1] != null) {
              beforeBlock = block;
              break;
            }
          }

          // Look for blocks that appear after the drawing in the sequence
          for (let i = Math.min(drawingIndexInSequence + 1, blocksOnSamePage.length - 1); i < blocksOnSamePage.length; i++) {
            const block = blocksOnSamePage[i];
            if (block && block.bbox && block.bbox[1] != null) {
              afterBlock = block;
              break;
            }
          }

          // Use interpolation if we have surrounding blocks
          if (beforeBlock || afterBlock) {

            // NEW: Respect Vertical Zones during estimation
            // Interpolate position from surrounding blocks

            // Interpolate position from surrounding blocks
            if (beforeBlock && afterBlock) {
              // Interpolate Y position between before and after blocks
              const beforeY = beforeBlock.bbox[1] || 0;
              const afterY = afterBlock.bbox[1] || 0;
              const interpolatedY = beforeY + (afterY - beforeY) * 0.5; // Midpoint

              // Use X from before block or average
              const beforeX = beforeBlock.bbox[0] || 0;
              const afterX = afterBlock.bbox[0] || 0;
              const interpolatedX = (beforeX + afterX) / 2;

              // If percentage coordinates are available, use them directly (skip interpolation blending)
              // Percentage coordinates from AI are more accurate than interpolation
              const percentMatch = position.match(/x\s*=\s*(\d+(?:\.\d+)?)%\s*,\s*y\s*=\s*(\d+(?:\.\d+)?)%/i);
              if (percentMatch) {
                const xPercent = parseFloat(percentMatch[1]);
                const yPercent = parseFloat(percentMatch[2]);
                const x = (xPercent / 100) * pageWidth;
                const y = (yPercent / 100) * pageHeight;
                return [x - drawingWidth / 2, y - drawingHeight / 2, drawingWidth, drawingHeight];
              }

              // Fallback to interpolation if no percentage coordinates
              return [interpolatedX - drawingWidth / 2, interpolatedY - drawingHeight / 2, drawingWidth, drawingHeight];
            } else if (beforeBlock) {
              // Only before block - place after it
              const beforeY = beforeBlock.bbox[1] || 0;
              const beforeHeight = beforeBlock.bbox[3] || 50;
              const beforeX = beforeBlock.bbox[0] || 0;
              return [beforeX, beforeY + beforeHeight + 50, drawingWidth, drawingHeight];
            } else if (afterBlock) {
              // Only after block - place before it
              const afterY = afterBlock.bbox[1] || 0;
              const afterX = afterBlock.bbox[0] || 0;
              return [afterX, Math.max(0, afterY - drawingHeight - 50), drawingWidth, drawingHeight];
            }
          }
        }

        // STEP 2: Fallback to percentage-based position from AI
        const percentMatch = position.match(/x\s*=\s*(\d+(?:\.\d+)?)%\s*,\s*y\s*=\s*(\d+(?:\.\d+)?)%/i);
        if (percentMatch) {
          const xPercent = parseFloat(percentMatch[1]);
          const yPercent = parseFloat(percentMatch[2]);
          const x = (xPercent / 100) * pageWidth;
          const y = (yPercent / 100) * pageHeight;
          return [x - drawingWidth / 2, y - drawingHeight / 2, drawingWidth, drawingHeight];
        }

        // STEP 3: Fallback to text-based position hints (center-left, etc.)
        let x = pageWidth / 2 - drawingWidth / 2; // Default center
        let y = pageHeight / 2 - drawingHeight / 2; // Default center

        if (position.includes('left')) x = pageWidth * 0.25 - drawingWidth / 2;
        if (position.includes('right')) x = pageWidth * 0.75 - drawingWidth / 2;
        if (position.includes('top')) y = pageHeight * 0.25 - drawingHeight / 2;
        if (position.includes('bottom')) y = pageHeight * 0.75 - drawingHeight / 2;

        // ZONE CLAMPING: Ensure guessed Y position is within the question's territory


        return [x, y, drawingWidth, drawingHeight];
      };

      // Create separate synthetic blocks for each [DRAWING] entry
      let drawingIndex = 0;
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
        const entry = entries[entryIndex];
        if (entry.includes('[DRAWING]')) {
          // Extract position hint from this specific drawing entry
          const positionMatch = entry.match(/\[POSITION:\s*([^\]]+)\]/);
          const position = positionMatch ? positionMatch[1] : 'center';

          // Find correct page index for this drawing
          // NOTE: We intentionally use the first page as default since the AI will determine
          // the actual page index by visually analyzing all provided images.
          // This drawingPageIndex is only used for bbox estimation within stepsDataForMapping.
          // INTELLIGENT DEFAULT: Prefer non-zero page (Page 0 is usually front cover)
          let drawingPageIndex = 0;
          if (task.sourcePages && task.sourcePages.length > 0) {
            const nonFrontPages = task.sourcePages.filter(p => p > 0);
            drawingPageIndex = nonFrontPages.length > 0 ? nonFrontPages[0] : task.sourcePages[0];
          }

          if (task.classificationBlocks && task.classificationBlocks.length > 0) {
            const matchingBlock = task.classificationBlocks.find(b => b.text && b.text.includes(entry));
            if (matchingBlock) {
              drawingPageIndex = matchingBlock.pageIndex;
              if (matchingBlock.subQuestions && Array.isArray(matchingBlock.subQuestions)) {
                const matchingSubQ = matchingBlock.subQuestions.find((sq: any) =>
                  sq.studentWorkLines && sq.studentWorkLines.some((line: any) => (line.text || '').includes(entry))
                );
                if (matchingSubQ && matchingSubQ.pageIndex !== undefined) {
                  drawingPageIndex = matchingSubQ.pageIndex;
                }
              }
            }
          }


          // Get blocks on the target page for interpolation
          const blocksOnTargetPage = stepsDataForMapping.filter(s => s.pageIndex === drawingPageIndex);

          // Helper to find drawing index in sequence (count text entries before it)
          const findDrawingIndexInSequence = (drawingEntryIndex: number): number => {
            let textEntriesBefore = 0;
            for (let j = 0; j < drawingEntryIndex; j++) {
              if (!entries[j].includes('[DRAWING]')) {
                textEntriesBefore++;
              }
            }
            // Estimate: drawing appears after textEntriesBefore OCR blocks
            // Clamp to valid range
            return Math.min(textEntriesBefore, Math.max(0, blocksOnTargetPage.length - 1));
          };

          // Find drawing position in sequence for order-based interpolation
          const drawingIndexInSequence = findDrawingIndexInSequence(entryIndex);

          // Estimate bbox for drawing using order-based interpolation
          // Pass drawingIndexInSequence to enable order-based position estimation
          const estimatedBbox = estimateBboxForDrawing(position, blocksOnTargetPage, drawingPageIndex, entry, drawingIndexInSequence);

          // CRITICAL: Do NOT override percentage-based positions with stacking
          // If we have percentage-based positions (x=XX%, y=YY%), use them exactly as provided by AI
          // Only apply stacking for fallback positions (old format: center-left, center-right, etc.)
          const hasPercentagePosition = /x\s*=\s*\d+(?:\.\d+)?%\s*,\s*y\s*=\s*\d+(?:\.\d+)?%/i.test(position);

          if (!hasPercentagePosition && drawingIndex > 0) {
            // Only stack if using fallback positions (old format)
            // Stack subsequent drawings below previous ones
            const previousDrawingBlock = stepsDataForMapping.find(s =>
              s.text.includes('[DRAWING]') && s.pageIndex === drawingPageIndex
            );
            if (previousDrawingBlock) {
              const prevY = previousDrawingBlock.bbox[1] || 0;
              const prevHeight = previousDrawingBlock.bbox[3] || 400;
              estimatedBbox[1] = prevY + prevHeight + 50; // 50px spacing between drawings
            }
          }

          // Create synthetic block for this individual drawing
          // Use standardized line ID format (line_1, line_2, etc.)
          const drawingStepIndex = stepsDataForMapping.length + 1;
          const drawingBlock = {
            line_id: `line_${drawingStepIndex}`, // Simplified format (matches AI prompt)
            pageIndex: drawingPageIndex,
            globalBlockId: `drawing_${questionId}_${drawingStepIndex}`,
            text: entry, // Only this drawing entry, not the full combined text
            cleanedText: entry,
            bbox: estimatedBbox as [number, number, number, number]
          };

          stepsDataForMapping.push(drawingBlock);
          // blocksOnSamePage.push(drawingBlock); // No longer needed as we re-filter or don't use it for next iter in this simplified flow

          drawingIndex++;
        }
      }
    }

    // 2. Prepare OCR Text as PLAIN TEXT for the AI Prompt
    // Use AI segmentation results if available (merged content with source), otherwise fall back to OCR blocks
    let ocrTextForPrompt = "Student's Work:\n";

    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      // Use AI segmentation merged content (prioritizes classification, uses OCR only when needed)
      task.aiSegmentationResults.forEach((result, index) => {
        const simplifiedStepId = `line_${index + 1}`;
        const sourceLabel = result.source === 'ocr' ? ' [OCR]' : result.source === 'merged' ? ' [MERGED]' : ' [CLASSIFICATION]';
        // Clean content: replace escaped newlines and actual newlines with spaces to ensure single-line format per step
        // This prevents formatting issues where content might have internal newlines
        const cleanedContent = result.content
          .replace(/\\n/g, ' ')  // Replace escaped newlines with space
          .replace(/\n/g, ' ')   // Replace actual newlines with space
          .replace(/\s+/g, ' ')  // Normalize multiple spaces to single space
          .trim();                // Remove leading/trailing whitespace
        ocrTextForPrompt += `${index + 1}. [${simplifiedStepId}]${sourceLabel} ${cleanedContent}\n`;
      });
    } else {
      // Fallback to OCR blocks (for backward compatibility with old segmentation)
      stepsDataForMapping.forEach((step, index) => {
        // Use simplified step ID format for AI prompt (e.g., [line_1], [line_2])
        const simplifiedStepId = `line_${index + 1}`;
        ocrTextForPrompt += `${index + 1}. [${simplifiedStepId}] ${step.cleanedText}\n`;
      });
    }


    // *** Log for Verification ***

    // Extract question text from marking scheme (from fullExamPapers - source for question detection)
    // Use databaseQuestionText (formatted with common function) - no backward compatibility needed
    const questionText = task.markingScheme?.databaseQuestionText || null;

    // Prepare raw OCR blocks for enhanced marking (bypass segmentation)
    const rawOcrBlocks = task.mathBlocks.map((block, idx) => {
      const blockId = (block as any).globalBlockId || `block_${task.sourcePages[0] || 0}_${idx}`;

      const rawPageIndex = (block as any).pageIndex ?? task.sourcePages[0] ?? 0;

      return {
        id: blockId,
        text: block.mathpixLatex || block.googleVisionText || '',
        pageIndex: rawPageIndex, // Use absolute page index for clear logging
        coordinates: block.coordinates ? {
          x: block.coordinates.x,
          y: block.coordinates.y
        } : undefined,
        isHandwritten: !!block.isHandwritten,
        subQuestions: (block as any).subQuestions // Propagate sub-questions for better sub-question detection in MarkingInstructionService
      };
    }).filter(block => {
      // Filter out noise patterns and empty blocks
      const text = block.text.trim();
      if (!text) return false;

      // Filter out LaTeX placeholders like \( ____ \)
      if (text === '\\( \\_\\_\\_\\_ \\)') return false;

      // Filter out "Turn over" noise (common in exam papers)
      if (text.toLowerCase().includes('turn over')) return false;

      // Filter out isolated table closing tags
      if (text.includes('\\hline') && text.includes('\\end{tabular}')) return false;

      // Filter out specific table start tags
      if (text.includes('\\begin{tabular}{|l|l|}')) return false;

      // Filter out header/footer noise if needed (e.g. page numbers, "Turn over")
      // (User requested removing "this text pattern", assuming specific placeholder for now)

      return true;
    });

    // REMOVED: Drawing blocks are no longer added to rawOcrBlocks.
    // Rationale: Pre-determining the page index for drawings is error-prone because
    // we cannot know where the drawing actually is until the AI performs visual analysis.
    // The AI will see [DRAWING] entries in STUDENT WORK (STRUCTURED) and will determine
    // the correct pageIndex by analyzing all provided images.
    //
    // Drawing blocks remain in stepsDataForMapping for bbox estimation purposes.

    // Call Marking Instruction Service (Pass Raw OCR Blocks + Classification for Enhanced Marking)

    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));

    // Collect all images for this question (for multi-page support)
    const questionImages: string[] = [];
    if (task.sourcePages && task.sourcePages.length > 0) {
      task.sourcePages.forEach(pageIndex => {
        // Find the image for this page index from standardizedPages
        // We need access to standardizedPages here. It's not directly in MarkingTask,
        // but we can pass it or find it.
        // Ideally, MarkingTask should have access to all images.
        // For now, let's assume we can get it from the task if we added it, or we need to pass it.
        // Wait, task.imageData is currently just one string.
        // We need to modify MarkingTask to hold all images or access them.

        // Actually, we are inside createMarkingTasksFromClassification which has access to standardizedPages!
        // But wait, this code block is inside executeMarkingForQuestion (or similar)?
        // No, this is inside executeMarkingForQuestion.

        // Let's check where standardizedPages comes from.
        // It is passed to createMarkingTasksFromClassification, but not to executeMarkingForQuestion.
        // We need to pass standardizedPages to executeMarkingForQuestion.
      });
    }

    // Since I cannot easily change the signature of executeMarkingForQuestion right now without breaking things,
    // I will use a workaround: The MarkingTask object should carry the images.
    // I will update createMarkingTasksFromClassification to populate a new 'images' field in MarkingTask.


    // DEBUG: Log sourcePages for this task
    // 4. Recalculate scores if necessary
    const markingResult = await MarkingInstructionService.executeMarking({
      imageData: task.imageData || '',
      images: task.images,
      model: model,
      processedImage: {
        ocrText: ocrTextForPrompt,
        boundingBoxes: stepsDataForMapping.map(step => ({
          x: step.bbox[0],
          y: step.bbox[1],
          width: step.bbox[2],
          height: step.bbox[3],
          text: step.text,
          confidence: 0.9
        })),
        confidence: 0.9,
        imageDimensions: { width: 1000, height: 1000 },
        cleanDataForMarking: { steps: stepsDataForMapping },
        cleanedOcrText: ocrTextForPrompt,
        unifiedLookupTable: {},
        rawOcrBlocks: rawOcrBlocks,
        classificationStudentWork: task.classificationStudentWork,
        classificationBlocks: task.classificationBlocks,
        subQuestionMetadata: task.subQuestionMetadata
      } as any,
      questionDetection: task.markingScheme,
      questionText: questionText,
      questionNumber: String(questionId),
      allPagesOcrData: allPagesOcrData,
      sourceImageIndices: task.sourcePages,
      tracker: tracker,
      generalMarkingGuidance: task.markingScheme?.generalMarkingGuidance // NEW: Pass injected guidance
    });


    sendSseUpdate(res, createProgressData(6, `Annotations generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));


    // Basic validation of marking result
    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
      throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // 4. Skip feedback generation - removed as requested

    // Identify the first non-frontPage source page as the default
    // This prevents annotations from defaulting to Page 0 (Front Page) when they belong on the question sheet
    const sourcePages = task.sourcePages || [];
    const defaultPageIndex = sourcePages.find(p => p !== 0) ?? sourcePages[0] ?? 0;

    // 5. Enrich annotations with positions (map to OCR blocks or visual positions)

    const enrichedAnnotations = enrichAnnotationsWithPositions(
      markingResult.annotations || [],
      stepsDataForMapping, // Keep stepsDataForMapping as it contains synthetic drawing blocks and line_ids
      String(questionId),
      defaultPageIndex,
      task.pageDimensions, // New argument
      task.classificationBlocks, // Pass classification blocks for sub-question page lookup
      task, // New argument
      (markingResult as any).visualObservation // Pass AI visual observation
    ).filter(anno => (anno.text || '').trim() !== ''); // Clean up empty annotations from mark limits





    // 7. Generate Final Output

    const questionResult: QuestionResult = {
      questionNumber: questionId,
      score: parseScore(markingResult.studentScore),
      annotations: enrichedAnnotations,
      pageIndex: (task.sourcePages && task.sourcePages.length > 0) ? task.sourcePages[0] : 0,
      usageTokens: markingResult.usage?.llmTokens || (markingResult as any).usageTokens || 0, // Map usageTokens correctly from nested object
      inputTokens: markingResult.usage?.llmInputTokens || 0,
      outputTokens: markingResult.usage?.llmOutputTokens || 0,
      mathpixCalls: task.sourcePages ? task.sourcePages.reduce((acc, pageIndex) => {
        // Aggregate mathpix calls from all source pages
        // Find the page data by pageIndex (safer than array index)
        const pageData = allPagesOcrData.find(p => p.pageIndex === pageIndex);
        if (!pageData || !pageData.ocrData) return acc;

        const calls = pageData.ocrData.usage?.mathpixCalls || (pageData.ocrData as any).mathpixCalls || 0;
        return acc + calls;
      }, 0) : 0,
      confidence: task.sourcePages && task.sourcePages.length > 0 ? (
        task.sourcePages.reduce((acc, pageIndex) => {
          const pageData = allPagesOcrData[pageIndex];
          return acc + ((pageData as any)?.confidence || 0.9); // Default to 0.9 if missing
        }, 0) / task.sourcePages.length
      ) : 0.9,
      markingScheme: (markingResult as any).markingScheme || task.markingScheme, // Prefer returned scheme (normalized/used) over task input
      studentWork: (markingResult as any).cleanedOcrText || task.classificationStudentWork || undefined, // Prefer sanitized text from marking result
      databaseQuestionText: task.markingScheme?.databaseQuestionText || task.questionText,
      promptMarkingScheme: (markingResult as any).schemeTextForPrompt, // Exact scheme text from prompt
      overallPerformanceSummary: (markingResult as any).overallPerformanceSummary || undefined // AI-generated performance summary
    };

    return questionResult;

  } catch (error) {
    console.error(`Error executing marking for Q${questionId}:`, error);
    throw error;
  }
}

// Helper function to enrich annotations with positions
// enrichAnnotationsWithPositions moved to AnnotationEnrichmentService.js






export function createMarkingTasksFromClassification(
  classificationResult: any,
  allPagesOcrData: PageOcrResult[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>,
  standardizedPages: any[], // Assuming standardizedPages is passed here
  mapperResults?: any[] // NEW: Pass the authoritative Mapper results (allClassificationResults)
): MarkingTask[] {
  const tasks: MarkingTask[] = [];

  // START: Build Robust Sub-Question Page Map from MAPPER RESULTS
  // This is the "Single Source of Truth" that bypasses any classification drift
  const globalMapperPageMap: Record<string, number[]> = {};

  if (mapperResults) {
    mapperResults.forEach(({ pageIndex, result }) => {
      if (result.questions) {
        result.questions.forEach((q: any) => {
          const baseQStr = String(q.questionNumber || '');
          const baseQ = getBaseQuestionNumber(baseQStr);

          if (q.subQuestions) {
            q.subQuestions.forEach((sq: any) => {
              if (sq.part) {
                const key = `${baseQ}${sq.part}`.toLowerCase(); // e.g. "3b"
                if (!globalMapperPageMap[key]) globalMapperPageMap[key] = [];
                if (!globalMapperPageMap[key].includes(pageIndex)) {
                  globalMapperPageMap[key].push(pageIndex);
                }
              }
            });
          }
          // Also map the main question (for single-part questions like Q15)
          if (!globalMapperPageMap[baseQ]) globalMapperPageMap[baseQ] = [];
          if (!globalMapperPageMap[baseQ].includes(pageIndex)) {
            globalMapperPageMap[baseQ].push(pageIndex);
          }
        });
      }
    });
    // Log removed
  }
  // END: Mapper Page Map

  // This helps place "lazy" annotations in the middle of their respective page area.
  const questionsOnPageMap = new Map<number, string[]>();

  if (classificationResult && classificationResult.questions) {
    classificationResult.questions.forEach((q: any) => {
      const qNum = getBaseQuestionNumber(String(q.questionNumber));
      const sourceIndices = q.sourceImageIndices && Array.isArray(q.sourceImageIndices) && q.sourceImageIndices.length > 0
        ? q.sourceImageIndices
        : [q.sourceImageIndex ?? 0];

      sourceIndices.forEach((pageIdx: number) => {
        if (!questionsOnPageMap.has(pageIdx)) questionsOnPageMap.set(pageIdx, []);
        const list = questionsOnPageMap.get(pageIdx)!;
        if (!list.includes(qNum)) list.push(qNum);
      });
    });
  }

  // Sort question numbers on each page to ensure consistent slicing order (e.g. Q1 before Q2)
  for (const [pageIdx, qList] of questionsOnPageMap.entries()) {
    qList.sort((a, b) => getQuestionSortValue(a) - getQuestionSortValue(b));
  }
  // END: Global Page Question Metadata

  if (!classificationResult?.questions || !Array.isArray(classificationResult.questions)) {
    return tasks;
  }

  // Group questions by base question number
  const questionGroups = new Map<string, {
    mainQuestion: any;
    mainStudentWorkParts: string[]; // Accumulate student work from multiple entries
    classificationBlocks: Array<{ text: string; pageIndex: number }>; // Store original blocks for position data
    subQuestions: Array<{ part: string; studentWork: string; text?: string }>;
    markingScheme: any;
    baseQNum: string;
    sourceImageIndices: number[]; // Array of page indices (for multi-page questions)
    aiSegmentationResults: Array<{ content: string; studentWorkPosition?: any }>; // Store accumulated results
    subQuestionPageMap: Record<string, number[]>; // NEW: Track page indexed(s) for each sub-question
  }>();

  // First pass: Collect all questions, use FULL question number as grouping key (e.g., "3a", "3b" separately)
  // This ensures Q3a and Q3b are separate tasks with their own page indices
  for (const q of classificationResult.questions) {
    const mainQuestionNumber = q.questionNumber || null;
    const baseQNum = getBaseQuestionNumber(String(mainQuestionNumber));

    // Use BASE question number as grouping key to merge sub-questions (e.g., 3a, 3b -> Q3)
    // This prevents duplicate tasks for the same question on the same page (Q6) or split across pages (Q3)
    const groupingKey = baseQNum;

    // Use sourceImageIndices if available (from merged questions), otherwise use sourceImageIndex as array
    const sourceImageIndices = q.sourceImageIndices && Array.isArray(q.sourceImageIndices) && q.sourceImageIndices.length > 0
      ? q.sourceImageIndices
      : [q.sourceImageIndex ?? 0];

    // For non-past papers, questionNumber might be null - use a placeholder or skip grouping
    // If no groupingKey, we can't group, but we can still create a task if there's student work
    if (!groupingKey) {
      // For non-past papers without question numbers, use a placeholder
      // Check if there's student work - if yes, create a task with null markingScheme
      const hasMainWork = q.studentWork && q.studentWork !== 'null' && q.studentWork.trim() !== '';
      const hasSubWork = q.subQuestions && q.subQuestions.some((sq: any) => sq.studentWork && sq.studentWork !== 'null' && sq.studentWork.trim() !== '');

      if (hasMainWork || hasSubWork) {
        // Create a task directly without grouping (for non-past papers)
        // We'll handle this after the grouping loop
      }
      continue; // Skip grouping for questions without groupingKey
    }

    // Find marking scheme using base question number for lookup
    let markingScheme: any = null;
    for (const [key, scheme] of markingSchemesMap.entries()) {
      if (key.startsWith(`${baseQNum}_`)) {
        const keyQNum = key.split('_')[0];
        if (keyQNum === baseQNum) {
          markingScheme = scheme;
          break;
        }
      }
    }

    if (!markingScheme) {
      // Continue to create task with null markingScheme (for non-past papers)
    }

    // Initialize group if not exists (using full question number as key)
    if (!questionGroups.has(groupingKey)) {
      questionGroups.set(groupingKey, {
        mainQuestion: q,
        mainStudentWorkParts: [], // Initialize array
        classificationBlocks: [], // Initialize array to store original blocks
        subQuestions: [],
        markingScheme: markingScheme,
        baseQNum: baseQNum,  // Keep baseQNum for scheme lookup
        sourceImageIndices: sourceImageIndices,
        aiSegmentationResults: [], // Initialize array
        subQuestionPageMap: {} // Initialize map
      });
    } else {
      // Group already exists - this should rarely happen now since we use full question number
      // But keep merge logic as safety fallback
      const existingGroup = questionGroups.get(groupingKey)!;
      const mergedIndices = [...new Set([...existingGroup.sourceImageIndices, ...sourceImageIndices])].sort((a, b) => a - b);
      existingGroup.sourceImageIndices = mergedIndices;
    }

    const group = questionGroups.get(groupingKey)!;

    // Add main student work if present
    // Add main student work if present
    // Handle main question student work
    const hasMainLines = q.studentWorkLines && q.studentWorkLines.length > 0;
    const hasSubQuestions = q.subQuestions && Array.isArray(q.subQuestions) && q.subQuestions.length > 0;
    const hasDrawing = q.hasStudentDrawing === true;



    if (hasMainLines || hasSubQuestions || hasDrawing || (q.studentWork && q.studentWork.trim().length > 0)) {
      // Build text from lines (if any), otherwise use raw studentWork
      let studentWorkText = hasMainLines
        ? q.studentWorkLines.map((line: any) => line.text).join('\n')
        : (q.studentWork || '');

      // Check if we should add this to main parts
      // Note: If it's pure sub-questions, we might not want to add to main parts?
      // Current logic: "if (hasMainLines)" implies it adds to main parts.
      // So if we have fallback text, we should probably add it too.
      if (hasMainLines || (!hasSubQuestions && studentWorkText)) {
        group.mainStudentWorkParts.push(studentWorkText.trim());
      }

      // Store studentWorkLines for position lookup
      // Use the first non-frontPage source page as primary for this block if possible
      const primaryPageIndex = sourceImageIndices.find(p => p !== 0) ?? sourceImageIndices[0] ?? 0;

      const block = {
        text: studentWorkText.trim(),
        pageIndex: primaryPageIndex,
        studentWorkLines: q.studentWorkLines || [], // Store lines with positions
        subQuestions: q.subQuestions, // Pass sub-questions to block for MarkingInstructionService
        hasStudentDrawing: q.hasStudentDrawing // Pass drawing flag
      };
      group.classificationBlocks.push(block as any);

      // LINE-LEVEL SEGMENTATION: Push individual lines instead of block


      // Gather ALL lines (Main + SubQuestions)
      let allWorkLines = [...(q.studentWorkLines || [])];

      // FIX: Also collect lines from sub-questions (where the data actually lives for Q20)
      if (q.subQuestions && Array.isArray(q.subQuestions)) {
        q.subQuestions.forEach((sq: any) => {
          if (sq.studentWorkLines && Array.isArray(sq.studentWorkLines)) {
            allWorkLines.push(...sq.studentWorkLines);
          }
        });
      }

      if (allWorkLines.length > 0) {
        allWorkLines.forEach((line: any) => {
          (group.aiSegmentationResults as any[]).push({
            content: line.text,
            source: 'classification',
            blockId: `classification_${groupingKey}_main`,
            lineData: line // Store original line data for coordinates
          });
        });
      } else if (studentWorkText.trim()) {
        (group.aiSegmentationResults as any[]).push({
          content: studentWorkText,
          source: 'classification',
          blockId: `classification_${groupingKey}_main`
        });
      }

      // [DEBUG EVIDENCE] Log the raw classification lines to prove/disprove 0-0 coordinates
      if (baseQNum === '20' || groupingKey.includes('20')) {
        console.log(`\n🔍 [EVIDENCE LOG] Q${baseQNum} Classification Lines:`);
        group.aiSegmentationResults.forEach((seg: any, i: number) => {
          const ld = seg.lineData;
          if (ld) {
            console.log(`   [Line ${i}] Text: "${seg.content.substring(0, 20)}..."`);
            console.log(`   [Line ${i}] POS: ${JSON.stringify(ld.position)} | COORDS: ${JSON.stringify(ld.coordinates)}`);
          } else {
            console.log(`   [Line ${i}] Text: "${seg.content.substring(0, 20)}..." (NO lineData)`);
          }
        });
      }
    }

    // Collect sub-questions
    if (q.subQuestions && Array.isArray(q.subQuestions)) {
      for (const subQ of q.subQuestions) {
        if ((subQ.studentWorkLines && subQ.studentWorkLines.length > 0) || (subQ.studentWork && subQ.studentWork.trim().length > 0)) {
          const studentWorkText = (subQ.studentWorkLines && subQ.studentWorkLines.length > 0)
            ? subQ.studentWorkLines.map(line => line.text).join('\n')
            : (subQ.studentWork || '');

          const subPart = subQ.part || '';
          group.subQuestions.push({
            part: subPart,
            studentWork: studentWorkText,
            text: subQ.text,
            studentWorkLines: subQ.studentWorkLines || [] // Store lines with positions
          } as any);

          // NEW: Update subQuestionPageMap with current pageIndex(es)
          if (subPart && subQ.pageIndex !== undefined) {
            if (!group.subQuestionPageMap[subPart]) group.subQuestionPageMap[subPart] = [];
            if (!group.subQuestionPageMap[subPart].includes(subQ.pageIndex)) {
              group.subQuestionPageMap[subPart].push(subQ.pageIndex);
            }
          }

          // LINE-LEVEL SEGMENTATION: Push individual lines for sub-question
          if (subQ.studentWorkLines && subQ.studentWorkLines.length > 0) {
            subQ.studentWorkLines.forEach((line: any) => {
              (group.aiSegmentationResults as any[]).push({
                content: line.text,
                source: 'classification',
                blockId: `classification_${groupingKey}_${subQ.part}`,
                lineData: line
              });
            });
          } else if (studentWorkText.trim()) {
            (group.aiSegmentationResults as any[]).push({
              content: studentWorkText,
              source: 'classification',
              blockId: `classification_${groupingKey}_${subQ.part}`
            });
          }
        }
      }
    }
  }

  // PASS 1.5: Sync subQuestions with marking scheme to include recovered siblings
  // This ensures that siblings missed by classification (like 11b) are included in the page union calculation
  for (const [baseQNum, group] of questionGroups.entries()) {
    let hasRecoveredSibling = false;
    if (group.markingScheme?.questionMarks?.subQuestionMarks) {
      const msParts = Object.keys(group.markingScheme.questionMarks.subQuestionMarks);
      msParts.forEach(msPart => {
        // msPart is e.g. "11b" or "11 (b)"
        const partLabelMatch = msPart.match(/([a-z]+|[ivx]+)$/i);
        const partLabel = partLabelMatch ? partLabelMatch[1].toLowerCase() : msPart.toLowerCase();

        if (!group.subQuestions.find(sq => sq.part.toLowerCase() === partLabel)) {
          hasRecoveredSibling = true;
          group.subQuestions.push({
            part: partLabel,
            studentWork: "[Sibling recovered from marking scheme - check image]",
            studentWorkLines: []
          } as any);
        }
      });
    }

    // BROADEN PAGE SCOPE: If we recovered a sibling, it means the Mapper missed it.
    // We should broaden the physical page range to ensure the AI sees the "gap" where it might be.
    if (hasRecoveredSibling && group.sourceImageIndices.length > 0) {
      const minPage = Math.min(...group.sourceImageIndices);
      const maxPage = Math.max(...group.sourceImageIndices);

      // Expand to include any pages in the contiguous range [min, max]
      // PLUS: Include any page categorized as 'questionAnswer' that is NOT mapped to ANY other question
      // (This handles cases where a page was identified but classification found nothing)
      const expandedIndices = new Set(group.sourceImageIndices);

      // 1. Contiguous range expansion (e.g. Q11a on P23, Q11c on P0 -> include all P0-P23)
      for (let i = minPage; i <= maxPage; i++) {
        expandedIndices.add(i);
      }

      // 2. Unmapped 'questionAnswer' pages (high probability candidates for missing sub-questions)
      standardizedPages.forEach((p, idx) => {
        const isQuestionPage = p.category === 'questionAnswer';
        const isUnmapped = !Object.values(globalMapperPageMap).some(indices => indices.includes(idx));

        if (isQuestionPage && isUnmapped) {
          expandedIndices.add(idx);
        }
      });

      const finalIndices = Array.from(expandedIndices).sort((a, b) => a - b);
      if (finalIndices.length > group.sourceImageIndices.length) {
        // Log removed
        group.sourceImageIndices = finalIndices;
      }
    }
  }

  // Second pass: Create one task per main question (with all sub-questions grouped)
  for (const [baseQNum, group] of questionGroups.entries()) {
    // 1. Get all OCR blocks from ALL pages this question spans (COLLECT EARLY for filtering)
    const allMathBlocks: MathBlock[] = [];
    group.sourceImageIndices.forEach((pageIndex) => {
      // FIX: Use find instead of array index to handle split/re-indexed pages correctly
      const pageOcrData = allPagesOcrData.find(d => d.pageIndex === pageIndex);
      if (pageOcrData?.ocrData?.mathBlocks) {
        pageOcrData.ocrData.mathBlocks.forEach((block: MathBlock, idx: number) => {
          // FORCE pageIndex to be the absolute global index
          (block as any).pageIndex = pageIndex;
          // Assign global block ID if not present
          if (!(block as any).globalBlockId) {
            (block as any).globalBlockId = `block_${pageIndex}_${idx}`;
          }
          allMathBlocks.push(block);
        });
      }
    });

    // 2. Geometric Overlap Filter: Discard student work that physically overlays printed landmarks
    // This creates a physical barrier that prevents AI from match-annotating question text
    const allLandmarks = allMathBlocks.filter(b => (b as any).isHandwritten === false);
    // Log removed

    group.aiSegmentationResults = group.aiSegmentationResults.filter(seg => {
      const segPos = (seg as any).lineData?.position;
      if (!segPos) return true;

      const segPage = (seg as any).lineData?.position?.pageIndex ?? (seg as any).lineData?.pageIndex;
      const landmarksOnPage = allLandmarks.filter(l => (l as any).pageIndex === segPage);

      for (const landmark of landmarksOnPage) {
        const lPosRaw = (landmark as any).position || (landmark as any).bbox;
        if (!lPosRaw) continue;

        // Get page dimensions to normalize from pixels to 0-100
        const page = standardizedPages.find(p => p.pageIndex === segPage);
        const pW = page?.width || 1;
        const pH = page?.height || 1;

        // Normalize lPos to 0-100 scale
        const l = Array.isArray(lPosRaw)
          ? { x: (lPosRaw[0] / pW) * 100, y: (lPosRaw[1] / pH) * 100, w: (lPosRaw[2] / pW) * 100, h: (lPosRaw[3] / pH) * 100 }
          : {
            x: ((lPosRaw.x || 0) / pW) * 100,
            y: ((lPosRaw.y || 0) / pH) * 100,
            w: ((lPosRaw.width || lPosRaw.w || 0) / pW) * 100,
            h: ((lPosRaw.height || lPosRaw.h || 0) / pH) * 100
          };

        const s = { x: segPos.x, y: segPos.y, w: segPos.width, h: segPos.height };

        const x_overlap = Math.max(0, Math.min(l.x + l.w, s.x + s.w) - Math.max(l.x, s.x));
        const y_overlap = Math.max(0, Math.min(l.y + l.h, s.y + s.h) - Math.max(l.y, s.y));
        const overlap_area = x_overlap * y_overlap;
        const seg_area = s.w * s.h;

        // If >= 95% of the student work line is inside a printed landmark, discard it
        // This is a "Safety-First" design to prevent AI from latching onto printed question text
        if (seg_area > 0 && (overlap_area / seg_area) > 0.95) {
          console.log(`[🛡️ SPATIAL SHIELD] 🚫 Stripping student work line overlapping question text: "${seg.content.substring(0, 30)}..." (Overlap: ${(overlap_area / seg_area * 100).toFixed(0)}%)`);
          return false;
        }
      }
      return true;
    });

    // 3. Deduplicate aiSegmentationResults based on content to prevent repeated student work in prompt
    const uniqueContent = new Set<string>();
    group.aiSegmentationResults = group.aiSegmentationResults.filter(result => {
      const normalizedContent = result.content.trim();
      if (uniqueContent.has(normalizedContent)) {
        return false;
      }
      uniqueContent.add(normalizedContent);
      return true;
    });

    // RE-INDEXING: Assign sequential line IDs AFTER filtering to ensure alignment with prompt labels
    group.aiSegmentationResults.forEach((seg: any, idx: number) => {
      seg.sequentialId = `line_${idx + 1}`;
    });

    // Build prompt components from FILTERED segmentation results
    let promptMainWork = '';
    const subQContentMap = new Map<string, string[]>();

    group.aiSegmentationResults.forEach((seg: any) => {
      if (seg.blockId.endsWith('_main')) {
        promptMainWork += (promptMainWork ? '\n' : '') + seg.content;
      } else {
        const part = seg.blockId.split('_').pop();
        if (part) {
          if (!subQContentMap.has(part)) subQContentMap.set(part, []);
          subQContentMap.get(part)!.push(seg.content);
        }
      }
    });

    const promptSubQuestions = group.subQuestions.map(sq => {
      const detectedWork = (subQContentMap.get(sq.part) || []).join('\n');
      return {
        ...sq,
        studentWork: detectedWork.trim().length > 0 ? detectedWork : (sq.studentWork || "[No student work text detected]")
      };
    }).filter(sq => {
      // Include if it has work OR if it was recovered from marking scheme
      return sq.studentWork.trim().length > 0;
    });

    // Format combined student work with sequential labels that EXACTLY match sequentialId
    const combinedStudentWork = formatGroupedStudentWork(
      promptMainWork,
      promptSubQuestions,
      group.aiSegmentationResults.map((seg: any) => seg.sequentialId)
    );

    // Skip if no student work at all (neither main nor sub-questions)
    const hasMainWork = promptMainWork && promptMainWork !== 'null' && promptMainWork.trim() !== '';
    const hasSubWork = promptSubQuestions.length > 0;
    const hasMarkingScheme = !!group.markingScheme;

    if (!hasMainWork && !hasSubWork && !hasMarkingScheme) {
      continue;
    }

    // If we have a scheme but no work, we proceed (AI will see the image)
    if (!hasMainWork && !hasSubWork && hasMarkingScheme) {
      promptMainWork = "[No student work text detected by classification - please check image]";
    }

    // Extract sub-question numbers for metadata
    const subQuestionNumbers = group.subQuestions.map(sq => `${baseQNum}${sq.part}`);

    // Check if this question requires image for marking (edge case: Drawing Classification returned 0)
    const requiresImage = (group.mainQuestion as any)?.requiresImageForMarking === true;

    // FIX: Attach image data for marking (CRITICAL for vision-based marking)
    const questionImages: string[] = [];
    if (group.sourceImageIndices.length > 0) {
      group.sourceImageIndices.forEach(pageIdx => {
        // Use find to resolve the correct page from standardizedPages
        const page = standardizedPages.find(p => p.pageIndex === pageIdx);
        if (page && page.imageData) {
          questionImages.push(page.imageData);
        }
      });
    }

    // Fallback to single image if array is empty (shouldn't happen if logic is correct)
    const primaryImageIndex = group.sourceImageIndices[0];
    const imageDataForMarking = requiresImage ? (
      (standardizedPages[primaryImageIndex] && standardizedPages[primaryImageIndex].imageData)
        ? standardizedPages[primaryImageIndex].imageData
        : undefined
    ) : undefined;

    if (requiresImage && imageDataForMarking) {
      console.log(`[MARKING EXECUTOR] Q${baseQNum}: Will pass image to Marking AI (Drawing Classification returned 0 for this drawing question)`);
    }

    // Create task with grouped sub-questions
    tasks.push({
      questionNumber: baseQNum, // Use base question number (e.g., "22")
      mathBlocks: allMathBlocks,
      markingScheme: group.markingScheme,
      sourcePages: group.sourceImageIndices,
      classificationStudentWork: combinedStudentWork,
      classificationBlocks: group.classificationBlocks, // Pass original blocks for fallback positioning
      pageDimensions: pageDimensionsMap,
      imageData: imageDataForMarking, // Pass image data for edge cases where Drawing Classification failed
      images: questionImages, // Pass the array of images
      // NEW: Pass the page map to the task
      subQuestionPageMap: (() => {
        const map: Record<string, number[]> = {};

        // existing map from classification
        Object.entries(group.subQuestionPageMap).forEach(([part, pages]) => {
          map[part] = [...pages];
        });

        // MERGE with Global Mapper Map
        if (Object.keys(globalMapperPageMap).length > 0) {
          // Pre-calculate Question Union for all pages this main question appears on
          // This helps solve split questions like 11b where work is on a separate page from the label.
          const questionPageUnionSet = new Set<number>();
          group.subQuestions.forEach(sqInner => {
            const keyInner = `${baseQNum}${sqInner.part}`.toLowerCase();
            if (globalMapperPageMap[keyInner]) {
              globalMapperPageMap[keyInner].forEach(p => questionPageUnionSet.add(p));
            }
          });
          const questionPageUnion = Array.from(questionPageUnionSet);

          group.subQuestions.forEach(sq => {
            const partKey = sq.part.toLowerCase();
            if (!map[partKey]) map[partKey] = [];

            // Check if this sub-question specifically requires drawing/graphing
            // Heuristic: check text for keywords or if it was flagged as drawing
            // FIX: Tighten regex to exclude "Use your graph" instructions (like 11c/11d)
            // We want 'draw', 'plot', 'sketch', 'shade'.
            // Explicitly exclude "Use your graph" or "Use the graph".
            const drawingRegex = /\b(draw|plot|sketch|shade)\b/i;
            const useGraphRegex = /use\s+(your|the)\s+graph/i;

            const subQText = (sq.text || '').toLowerCase();
            const studentWorkText = (sq.studentWork || '').toLowerCase();

            const isDrawingSubQ = (drawingRegex.test(subQText) && !useGraphRegex.test(subQText)) ||
              (drawingRegex.test(studentWorkText) && !useGraphRegex.test(studentWorkText));

            // Check if we have a SPECIFIC mapper result for this part
            const specificMapperKey = `${baseQNum}${sq.part}`.toLowerCase();
            const hasSpecificMapperResult = globalMapperPageMap[specificMapperKey] && globalMapperPageMap[specificMapperKey].length > 0;

            if (isDrawingSubQ || !hasSpecificMapperResult) {
              // BROADEN: If it involves drawing (which often spans pages) OR if we have no specific location,
              // allow it to be anywhere the main question is.
              questionPageUnion.forEach(p => {
                if (!map[partKey].includes(p)) map[partKey].push(p);
              });
            } else {
              // RESTRICT: If it's a normal text question and we found it specifically, trust the mapper!
              // This fixes Q11a being pulled to Page 13 when it is clearly on Page 12.
              if (globalMapperPageMap[specificMapperKey]) {
                globalMapperPageMap[specificMapperKey].forEach(p => {
                  if (!map[partKey].includes(p)) map[partKey].push(p);
                });
              }
            }
          });
        }
        // Log removed
        return map;
      })(),
      // NEW: Pass the pre-calculated union of pages for Visual Annotation fallback
      allowedPageUnion: (() => {
        // Re-calculate the union (duplicated logic for clarity/scope, or could be hoisted)
        const questionPageUnionSet = new Set<number>();
        if (globalMapperPageMap && Object.keys(globalMapperPageMap).length > 0) {
          group.subQuestions.forEach(sq => {
            const key = `${baseQNum}${sq.part}`.toLowerCase(); // e.g. "3b"
            if (globalMapperPageMap[key]) {
              globalMapperPageMap[key].forEach(p => questionPageUnionSet.add(p));
            }
          });
        }
        // Also include existing map pages just in case
        Object.values(group.subQuestionPageMap).forEach(pages => pages.forEach(p => questionPageUnionSet.add(p)));
        return Array.from(questionPageUnionSet);
      })(),
      subQuestionMetadata: {
        hasSubQuestions: group.subQuestions.length > 0,
        subQuestions: group.subQuestions.map(sq => ({
          part: sq.part,
          text: sq.text
        })),
        subQuestionNumbers: subQuestionNumbers.length > 0 ? subQuestionNumbers : undefined
      },
      questionsOnPage: questionsOnPageMap, // Pass metadata for slicing
      aiSegmentationResults: group.aiSegmentationResults
    });


  }




  // Sort tasks by question number (ascending) to ensure consistent ordering
  // This ensures Q1, Q2, ..., Q18, ..., are processed in numerical order
  // regardless of the order they appear in classification results
  tasks.sort((a, b) => {
    const numA = parseInt(String(a.questionNumber).replace(/\D/g, '')) || 0;
    const numB = parseInt(String(b.questionNumber).replace(/\D/g, '')) || 0;

    if (numA !== numB) {
      return numA - numB;
    }
    // If base numbers are equal, compare full strings (e.g., "3a" vs "3b")
    return String(a.questionNumber || '').localeCompare(String(b.questionNumber || ''), undefined, { numeric: true });
  });

  return tasks;
}


// Helper to parse score string "2/2" into object
function parseScore(scoreInput: any): { awardedMarks: number; totalMarks: number } {
  if (!scoreInput) {
    return { awardedMarks: 0, totalMarks: 0 };
  }

  // Handle if it's already an object with awardedMarks/totalMarks
  if (typeof scoreInput === 'object') {
    if ('awardedMarks' in scoreInput) {
      return {
        awardedMarks: Number(scoreInput.awardedMarks) || 0,
        totalMarks: Number(scoreInput.totalMarks) || 0
      };
    }
    // Handle if it has scoreText
    if (scoreInput.scoreText) {
      return parseScore(scoreInput.scoreText);
    }
  }

  const scoreStr = String(scoreInput);

  // Handle number input
  if (!isNaN(Number(scoreStr)) && !scoreStr.includes('/')) {
    return { awardedMarks: Number(scoreStr), totalMarks: 0 };
  }

  const parts = scoreStr.split('/');
  if (parts.length === 2) {
    const awarded = parseFloat(parts[0]);
    const total = parseFloat(parts[1]);
    return {
      awardedMarks: isNaN(awarded) ? 0 : awarded,
      totalMarks: isNaN(total) ? 0 : total
    };
  }
  const awarded = parseFloat(scoreStr);
  return { awardedMarks: isNaN(awarded) ? 0 : awarded, totalMarks: 0 };
}

