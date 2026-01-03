/**
 * Marking Executor Service
 * Executes AI marking and feedback generation for a single question task
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { MarkingInstructions, Annotation, ModelType } from '../../types/index.js';
import type { MathBlock } from '../ocr/MathDetectionService.js';
import type { PageOcrResult } from '../../types/markingRouter.js';
import { formatGroupedStudentWork, getQuestionSortValue } from './MarkingHelpers.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';
import UsageTracker from '../../utils/UsageTracker.js';

// Types for the marking executor
export interface MarkingTask {
  questionNumber: number | string;
  mathBlocks: MathBlock[]; // Raw OCR blocks for this question
  markingScheme: any;
  sourcePages: number[];
  classificationStudentWork?: string | null; // Raw classification student work (may include [DRAWING])
  formattedOcrText?: string; // Formatted OCR text for context
  questionText?: string; // Detected question text
  databaseQuestionText?: string; // Text from database match
  classificationBlocks?: Array<{  // Original classification blocks with position data (for Q18-style accumulated questions)
    text: string;
    pageIndex: number;
    studentWorkPosition?: { x: number; y: number; width: number; height: number }; // Percentage position
    subQuestions?: any[]; // Allow access to sub-questions for page lookup
    hasStudentDrawing?: boolean; // Propagate drawing flag
    studentWorkLines?: any[]; // Allow access to lines
  }>;
  pageDimensions?: Map<number, { width: number; height: number }>; // Map of pageIndex -> dimensions for accurate bbox estimation
  questionsOnPage?: Map<number, string[]>; // Map of pageIndex -> sorted unique question numbers on that page
  imageData?: string; // Base64 image data for edge cases where Drawing Classification failed (will trigger vision API)
  images?: string[]; // Array of base64 images for multi-page questions
  // Sub-question metadata for grouped sub-questions
  subQuestionMetadata?: {
    hasSubQuestions: boolean;
    subQuestions: Array<{
      part: string;        // "a", "b", "i", "ii", etc.
      text?: string;       // Sub-question text (optional)
    }>;
    subQuestionNumbers?: string[];  // ["22a", "22b"] for reference
  };
  subQuestionPageMap?: Record<string, number[]>; // NEW: Explicit mapping of sub-question part -> pageIndex(es)
  allowedPageUnion?: number[]; // NEW: Union of all pages for the main question (for fallback routing)
  // Legacy fields (kept for backward compatibility, but not used in enhanced marking)
  aiSegmentationResults?: Array<{ content: string; source?: string; blockId?: string; studentWorkLines?: any[] }>;
  blockToClassificationMap?: Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>;
}

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

export interface EnrichedAnnotation extends Annotation {
  bbox: [number, number, number, number];
  pageIndex: number;
  line_id?: string; // Optional, for tracking which step this annotation maps to
  aiPosition?: { x: number; y: number; width: number; height: number }; // AI-estimated position for verification
  hasLineData?: boolean; // Flag indicating if annotation uses actual line data (OCR) or fallback
  isDrawing?: boolean; // Flag indicating if the annotation is for a drawing
  ocr_match_status?: 'MATCHED' | 'UNMATCHED' | 'VISUAL' | 'FALLBACK';
  visualObservation?: string; // AI's description of the visual content
}

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

    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      // Use AI segmentation results - map back to original blocks for coordinates
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        // Resolve coordinates: check lineData first, then block
        let bbox: [number, number, number, number] = [0, 0, 0, 0];
        let pageIdx = -1;

        const lineData = (result as any).lineData;
        const coords = lineData?.coordinates || lineData?.position;

        if (coords?.x != null && coords?.y != null) {
          bbox = [coords.x, coords.y, coords.width, coords.height];
          pageIdx = lineData?.pageIndex != null ? lineData.pageIndex : (task.sourcePages[0] || 0);
        } else {
          // Find the corresponding block by blockId
          const matchingBlock = task.mathBlocks.find(block => {
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
      tracker: tracker
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
const enrichAnnotationsWithPositions = (
  annotations: Annotation[],
  stepsDataForMapping: any[],
  questionId: string,
  defaultPageIndex: number = 0,
  pageDimensions?: Map<number, { width: number; height: number }>,
  classificationBlocks?: any[],
  task?: MarkingTask,
  visualObservation?: string
): EnrichedAnnotation[] => {
  let lastValidAnnotation: EnrichedAnnotation | null = null;
  const allMarks = (task.markingScheme as any)?.marks || [];


  const results = annotations.map((anno, idx) => {
    // 🛡️ 1. ANNOTATION INTERCEPTOR: Prevent marks on printed question text (Fail-Safe Layer 3)
    // If the AI stubbornely matches a printed landmark despite our filters, we strip it here.
    let aiLineId = (anno as any).line_id || (anno as any).lineId || (anno as any).line || '';

    const targetOcrBlock = task?.mathBlocks?.find(b =>
      (b as any).globalBlockId === aiLineId || (b as any).id === aiLineId
    );

    if (targetOcrBlock && (targetOcrBlock as any).isHandwritten === false) {
      console.warn(`[🛡️ INTERCEPTOR] 🛑 Intercepted AI match to printed block ${aiLineId}. Stripping to force fallback.`);
      (anno as any).line_id = undefined;
      (anno as any).lineId = undefined;
      (anno as any).ocr_match_status = 'UNMATCHED';
      aiLineId = ''; // Clear local reference for subsequent matching
    }

    // Unified Identifier Standard: Use only lineId
    // aiLineId is already extracted above

    // Helper to normalize IDs
    function normalizeId(id: string) {
      return id.trim().toLowerCase().replace(/^line_/, '');
    }

    // Find the original step
    let originalStep = aiLineId ? stepsDataForMapping.find(s => {
      const stepId = s.line_id || s.lineId || s.unified_line_id || s.globalBlockId || s.id || '';
      // Direct match
      if (s.line_id === aiLineId || s.lineId === aiLineId || s.unified_line_id === aiLineId) return true;

      const isMatch = normalizeId(stepId) === normalizeId(aiLineId);

      // IDENTITY GUARD: If this is a drawing annotation, it should ONLY match a drawing placeholder
      if (isMatch && aiLineId.toLowerCase().includes('drawing')) {
        const isDrawingPlaceholder = (s.text || '').toLowerCase().includes('[drawing]');
        if (!isDrawingPlaceholder) return false;
      }
      return isMatch;
    }) : undefined;

    // determine pageIndex
    let pageIndex = originalStep?.pageIndex ?? defaultPageIndex;
    if ((anno as any)._immutable) {
      pageIndex = ((anno as any)._page?.global ?? (anno as any).pageIndex) as number;
    }

    // Check for AI Visual Position or missing/zeroed bbox
    const rawVisualPos = (anno as any).aiPosition || (anno as any).visual_position;
    let effectiveVisualPos = rawVisualPos;

    // Determine if we have a valid physical anchor
    const hasPhysicalAnchor = originalStep &&
      originalStep.bbox &&
      originalStep.bbox.length === 4 &&
      (originalStep.bbox[0] > 0 || originalStep.bbox[1] > 0 || originalStep.bbox[2] > 0 || originalStep.bbox[3] > 0);

    if (effectiveVisualPos || !hasPhysicalAnchor) {
      const isLazy = !effectiveVisualPos || (
        parseFloat(effectiveVisualPos.x) === 0 &&
        parseFloat(effectiveVisualPos.y) === 0 &&
        parseFloat(effectiveVisualPos.width) === 100 &&
        parseFloat(effectiveVisualPos.height) === 100
      );

      if (isLazy) {
        // Simple Slicing Fallback
        const questions = task?.questionsOnPage?.get(pageIndex) || [];
        const myQNum = getBaseQuestionNumber(String(questionId));
        const myIdx = questions.indexOf(myQNum);
        const count = questions.length || 1;
        const safeIdx = myIdx === -1 ? 0 : myIdx;

        const sliceSize = 100 / count;
        const centerY = (safeIdx * sliceSize) + (sliceSize / 2);

        effectiveVisualPos = {
          x: "10",
          y: String(centerY - (sliceSize * 0.4)),
          width: "80",
          height: String(sliceSize * 0.8)
        };
      }
    }

    if (!aiLineId && !effectiveVisualPos) {
      return null;
    }

    // FIX START: Extract sub-question target early so it's available for ALL paths (Visual, Unmatched, etc.)
    // FIX START: Infer sub-question from Page Content (Classification Blocks)
    // AI response includes 'subQuestion' (e.g., 'a', '6a', etc.)
    let targetSubQ: string | undefined = (anno as any).subQuestion;
    if (targetSubQ === 'null' || !targetSubQ) {
      targetSubQ = undefined;
    } else {
      // Normalize targetSubQ: strip question number if present (e.g. "6a" -> "a")
      const qNumStr = String(questionId);
      if (targetSubQ.startsWith(qNumStr)) {
        targetSubQ = targetSubQ.substring(qNumStr.length).toLowerCase();
      } else {
        targetSubQ = targetSubQ.toLowerCase();
      }
    }




    // --- SIMPLIFIED DRAWING DETECTION ---
    const drawingKeywordsRegex = /\b(draw|plot|sketch|shade|label|cumulative|frequency|graph|grid)\b/i;
    const isDrawingContext = drawingKeywordsRegex.test(task.questionText || '') ||
      drawingKeywordsRegex.test(originalStep?.text || '') ||
      drawingKeywordsRegex.test(String(targetSubQ || ''));

    const aiMatchStatus = (anno as any).ocr_match_status;
    const isDrawingAnno = (anno as any).text?.includes('[DRAWING]') ||
      (anno as any).reasoning?.includes('[DRAWING]') ||
      aiLineId.toLowerCase().includes('drawing') ||
      (isDrawingContext && (aiMatchStatus === 'MATCHED' || !effectiveVisualPos));

    if (isDrawingAnno) {
      const calculatedBaseQNum = getBaseQuestionNumber(String(questionId));
      const partKey = targetSubQ ? targetSubQ.toLowerCase() : '';

      // Determine target page(s)
      let targetPages = [defaultPageIndex];
      if (partKey && task.subQuestionPageMap && task.subQuestionPageMap[partKey] && task.subQuestionPageMap[partKey].length > 0) {
        targetPages = task.subQuestionPageMap[partKey];
      } else if (task.allowedPageUnion && task.allowedPageUnion.length > 0) {
        targetPages = task.allowedPageUnion;
      }

      // Pick the best page and find the vertical slice
      let bestPage = targetPages[targetPages.length - 1]; // Assume drawing is usually on the later page of a range
      let sliceIndex = 0;
      let sliceCount = 1;

      for (const p of targetPages) {
        const questionsOnThisPage = task.questionsOnPage?.get(p) || [];
        const fullSubQ = `${calculatedBaseQNum}${targetSubQ || ''}`;
        const idx = questionsOnThisPage.findIndex(q => q.toLowerCase().includes(fullSubQ.toLowerCase()));

        if (idx !== -1) {
          bestPage = p;
          sliceIndex = idx;
          sliceCount = questionsOnThisPage.length;
          break;
        }
      }

      const pDims = pageDimensions?.get(bestPage) || { width: 1000, height: 1400 };
      const sliceHeight = pDims.height / sliceCount;
      const sliceCenterY = (sliceIndex * sliceHeight) + (sliceHeight / 2);

      // Ensure it's not too high up if it's the first slice
      const visualY = sliceCenterY;
      const pixelBbox: [number, number, number, number] = [pDims.width * 0.1, visualY, pDims.width * 0.8, 100];


      return {
        ...anno,
        bbox: pixelBbox,
        pageIndex: bestPage,
        line_id: `drawing_slice_${bestPage}_${sliceIndex}`,
        ocr_match_status: 'VISUAL',
        subQuestion: targetSubQ || anno.subQuestion,
        isDrawing: true
      };
    }

    // [COORD SNAP] If we matched a classification line, try to snap to a nearby Mathpix block with similar text
    // This fixes the "Shifted Left" issue by using Mathpix pixels instead of Gemini percentages
    if (originalStep && originalStep.ocrSource === 'classification' && originalStep.text) {
      const pageIdx = originalStep.pageIndex ?? defaultPageIndex;
      const normalizedTarget = originalStep.text.trim().toLowerCase().replace(/\s+/g, '');

      // Find a Mathpix block on the same page with very similar text
      // SPATIAL AWARE: Only snap if the Mathpix block is relatively close to the AI's estimate
      // This prevents "teleporting" to the wrong instance of the same text (e.g. "0.4" on a tree diagram)
      const potentialTwins = stepsDataForMapping.filter(step =>
        step.pageIndex === pageIdx &&
        step.ocrSource !== 'classification' &&
        step.ocrSource !== 'estimated' &&
        step.text &&
        (
          step.text.trim().toLowerCase().replace(/\s+/g, '') === normalizedTarget ||
          normalizedTarget.includes(step.text.trim().toLowerCase().replace(/\s+/g, ''))
        )
      );

      if (potentialTwins.length > 0 && originalStep.bbox) {
        let bestTwin = null;
        let minDistance = Infinity;
        const [aX, aY] = originalStep.bbox;

        for (const twin of potentialTwins) {
          if (!twin.bbox) continue;
          const [tX, tY] = twin.bbox;
          const distance = Math.sqrt(Math.pow(aX - tX, 2) + Math.pow(aY - tY, 2));

          if (distance < minDistance) {
            minDistance = distance;
            bestTwin = twin;
          }
        }

        // Distance Threshold: 350px (fairly generous but enough to stop cross-page hopping)
        const DISTANCE_THRESHOLD = 350;

        if (bestTwin && minDistance < DISTANCE_THRESHOLD) {
          // Log removed
          // originalStep = bestTwin; // DISABLED: Trust original AI classification position per user request
          // (anno as any).ocr_match_status = 'MATCHED'; // Keep as UNMATCHED/VISUAL
        } else if (bestTwin) {
          // Log removed
        }
      }
    }

    // Log removed

    // FIX: Check if we have visible position data even if Unmatched (e.g. Q11 C1/C1)
    // DISCARD LAZY POSITIONS: If AI returned 0/0/100/100 for an UNMATCHED annotation, treat it as missing position.
    // This prevents "completely messed up" boxes covering the whole page when mapping fails.
    // This block was moved to the top of the loop.

    const hasStudentWorkPosition = (anno as any).lineIndex !== undefined || (anno as any).line_index !== undefined || effectiveVisualPos;
    if (originalStep && (anno as any).ocr_match_status === 'UNMATCHED' && !hasStudentWorkPosition) {
      (anno as any).ocr_match_status = 'MATCHED';
    }

    // FIX: If match found but has empty bbox [0,0,0,0], treat as UNMATCHED to trigger robust fallbacks (Fixes Q16)
    // EXCEPTION: If it is a [DRAWING] synthetic placeholder, DO NOT nullify it. 
    // We need the originalStep to preserve the pageIndex for drawing annotations.
    if (originalStep && originalStep.bbox && originalStep.bbox.length === 4 &&
      originalStep.bbox[0] === 0 && originalStep.bbox[1] === 0 && originalStep.bbox[2] === 0 && originalStep.bbox[3] === 0) {

      const isDrawingPlaceholder = (originalStep.text || '').toLowerCase().includes('[drawing]');
      if (!isDrawingPlaceholder) {
        originalStep = undefined;
        (anno as any).ocr_match_status = 'UNMATCHED';
      }
    }



    // If not found, try flexible matching (handle line_1 vs q8_line_1, etc.)
    if (!originalStep && aiLineId) {
      // Extract line number from AI line_id (e.g., "line_2" -> "2", "q8_line_2" -> "2")
      const lineNumMatch = aiLineId.match(/line[_\s]*(\d+)/i);
      if (lineNumMatch && lineNumMatch[1]) {
        const lineNum = parseInt(lineNumMatch[1], 10);
        // Match by line index (1-based)
        if (lineNum > 0 && lineNum <= stepsDataForMapping.length) {
          originalStep = stepsDataForMapping[lineNum - 1];
        }
      }

      // If still not found, check if AI is using OCR block ID format (block_X_Y)
      if (!originalStep) {
        // 1. Try to find the step in marking scheme marks using lineId (if persisted)
        const foundMark = (allMarks || []).find((m: any) =>
          m.mark?.trim() === aiLineId || m.lineId?.trim() === aiLineId
        );

        if (foundMark) {
          // If we found a mark with this ID, but no OCR block directly, 
          // we can't do much for positioning here, but we acknowledge it.
        } else if (aiLineId.startsWith('block_')) {
          originalStep = stepsDataForMapping.find(step =>
            step.globalBlockId?.trim() === aiLineId
          );
        }
      }
    }

    // FIX (Smart Validation): Prevent snapping to Header/Footer boilerplate
    // Even if AI explicitly matched this block, we reject it if it contains known header text.
    // This forces fallback to student work line (which is what we want).
    if (originalStep && originalStep.text) {
      const lowerText = originalStep.text.toLowerCase();
      const forbiddenPhrases = [
        'answer all questions',
        'total for question',
        'write your answers in the spaces provided',
        'lines in your working',
        'do not write in this area',
        'indicate which question you are answering'
      ];

      const isForbidden = forbiddenPhrases.some(phrase => lowerText.includes(phrase));

      if (isForbidden) {
        const RED = '\x1b[31m';
        const BOLD = '\x1b[1m';
        const RESET = '\x1b[0m';
        console.log(`${BOLD}${RED}[ERROR: BLOCKING PRINTED TEXT] Q${questionId}: Match refused for printed instruction: "${originalStep.text.substring(0, 50)}..."${RESET}`);
        originalStep = undefined;
        (anno as any).ocr_match_status = 'UNMATCHED';
      }
    }

    // Log removed


    // Special handling for [DRAWING] annotations
    // Since we now create separate synthetic blocks for each drawing, match by text content
    // AI might return line_id like "DRAWING_Triangle B..." instead of line_id
    if (!originalStep) {
      const annotationText = ((anno as any).textMatch || (anno as any).text || '').toLowerCase();
      const isDrawingAnnotation = annotationText.includes('[drawing]') || (aiLineId && aiLineId.toLowerCase().includes('drawing'));

      if (isDrawingAnnotation) {
        // First, try to match by line_id if it contains a line number
        const lineNumMatch = aiLineId ? aiLineId.match(/line[_\s]*(\d+)/i) : null;
        if (lineNumMatch && lineNumMatch[1]) {
          const lineNum = parseInt(lineNumMatch[1], 10);
          if (lineNum > 0 && lineNum <= stepsDataForMapping.length) {
            const candidateStep = stepsDataForMapping[lineNum - 1];
            if (candidateStep && (candidateStep.text || candidateStep.cleanedText || '').toLowerCase().includes('[drawing]')) {
              originalStep = candidateStep;
            }
          }
        }

        // If line number matching failed, try text-based matching
        if (!originalStep) {
          // Find synthetic block that matches this specific drawing
          // Each synthetic block now contains only one drawing entry, so matching is simpler
          originalStep = stepsDataForMapping.find(step => {
            const stepText = (step.text || step.cleanedText || '').toLowerCase();
            if (!stepText.includes('[drawing]')) return false;

            // Extract key identifiers from both texts for matching (reuse existing logic)
            const extractKeyWords = (text: string): string[] => {
              // Extract meaningful words (skip common words like "drawn", "at", "vertices", etc.)
              return text
                .replace(/\[drawing\]/gi, '')
                .replace(/\[position:.*?\]/gi, '')
                .split(/[^a-z0-9]+/i)
                .filter(word => word.length > 2 && !['the', 'and', 'at', 'drawn', 'vertices', 'position', 'point'].includes(word.toLowerCase()))
                .map(word => word.toLowerCase());
            };

            const annotationWords = extractKeyWords(annotationText);
            const stepWords = extractKeyWords(stepText);

            // Check if annotation words appear in step text (at least 2 words match for confidence)
            const matchingWords = annotationWords.filter(word => stepWords.includes(word));
            return matchingWords.length >= 2 || (matchingWords.length > 0 && matchingWords.length === annotationWords.length);
          });
        }
      }
    }
    // FIX: Extract lineIndex safely (ensure 0-based)
    let safeLineIndex = ((anno as any).lineIndex || (anno as any).line_index || 1) - 1;

    // RULE: For Standard Text Annotations (M1, A1, etc.), we IGNORE the AI's "visual_position" guess.
    // It is often hallucinated. We rely on the GROUND TRUTH Classification Position via line_index.
    const isTrulyVisualAnnotation = (anno as any).ocr_match_status === 'VISUAL' ||
      (anno as any).isDrawing === true ||
      (anno as any).line_id?.toString().toLowerCase().includes('drawing');

    if (!isTrulyVisualAnnotation) {
      // Force visual pos to undefined to trigger rigid Classification Fallback
      effectiveVisualPos = undefined;
    }
    // UNMATCHED: No OCR blocks available - extract position from classification
    if ((anno as any).ocr_match_status === 'UNMATCHED') {
      let lineIndex = ((anno as any).lineIndex || 1) - 1; // Use camelCase from toLegacyFormat


      let targetSubStartIndex = -1;
      let targetSubEndIndex = -1;


      // Find the position using line_index
      let classificationPosition: any = null;
      if (task.classificationBlocks) {
        // Flatten all studentWorkLines from all blocks and sub-questions into a single global array
        // This matches the AI prompt format which numbers lines globally: [1], [2], [3]...
        const allLines: Array<{ text: string; position: any; pageIndex: number }> = [];

        task.classificationBlocks.forEach(block => {
          // Add top-level studentWorkLines
          if (block.studentWorkLines && block.studentWorkLines.length > 0) {
            block.studentWorkLines.forEach(line => {
              allLines.push({
                text: line.text,
                position: line.position,
                pageIndex: block.pageIndex !== undefined ? block.pageIndex : defaultPageIndex
              });
            });
          }

          // Add studentWorkLines from all sub-questions
          if (block.subQuestions) {
            block.subQuestions.forEach(subQ => {
              // Capture start index for this sub-question
              if (targetSubQ && subQ.part === targetSubQ && targetSubStartIndex === -1) {
                targetSubStartIndex = allLines.length;
              }

              if (subQ.studentWorkLines && subQ.studentWorkLines.length > 0) {
                subQ.studentWorkLines.forEach(line => {
                  allLines.push({
                    text: line.text,
                    position: line.position,
                    pageIndex: block.pageIndex !== undefined ? block.pageIndex : defaultPageIndex
                  });
                });
              }

              // Capture end index
              if (targetSubQ && subQ.part === targetSubQ) {
                targetSubEndIndex = allLines.length - 1;
              }
            });
          }
        });

        // FIX: If we found a target sub-question range, force the lineIndex into it
        if (targetSubStartIndex !== -1) {
          // If defaulting to 0, move to the end of the sub-question (usually the answer line)
          if (lineIndex <= 0) {
            lineIndex = Math.max(targetSubStartIndex, targetSubEndIndex);
          } else {
            // If it's valid relative index, should we treat it as relative to sub-question?
            // AI often returns 0-based. Let's assume absolute first. 
            // If absolute is outside range, move it inside.
            if (lineIndex < targetSubStartIndex || lineIndex > targetSubEndIndex) {
              lineIndex = Math.max(targetSubStartIndex, targetSubEndIndex);
            }
          }
        }

        // Now use global lineIndex to find the correct line
        if (lineIndex >= 0 && lineIndex < allLines.length) {
          const line = allLines[lineIndex];

          if (line.position) {
            classificationPosition = {
              ...line.position,
              pageIndex: line.pageIndex
            };

            // Log removed
          }
        } else if (String(questionId).startsWith('6')) {
          console.log(`[DEBUG LOCK Q${questionId}]   ↳ UNMATCHED fallback: Line index ${lineIndex + 1} out of range (Total lines: ${allLines.length})`);
        }
      }

      // If we found a classification position, use it
      if (classificationPosition) {
        // COORDINATE CONVERSION: AI provides percentages (0-100), convert to pixels if dimensions available
        const pageDims = pageDimensions?.get(classificationPosition.pageIndex);
        let finalX = classificationPosition.x;
        let finalY = classificationPosition.y;
        let finalW = classificationPosition.width || 100;
        let finalH = classificationPosition.height || 20;

        if (pageDims) {
          finalX = (finalX / 100) * pageDims.width;
          finalY = (finalY / 100) * pageDims.height;
          finalW = (finalW / 100) * pageDims.width;
          finalH = (finalH / 100) * pageDims.height;
        }

        // FIX: Ensure minimum visibility for fallback boxes (Q6 fix)
        // If box is microscopic (e.g. < 10px), scale it up to at least 50x30
        if (finalW < 10 || finalH < 10) {
          if (finalW < 50) finalW = 50;
          if (finalH < 30) finalH = 30;
        }

        return {
          ...anno,
          bbox: [finalX, finalY, finalW, finalH] as [number, number, number, number],
          pageIndex: classificationPosition.pageIndex,
          line_id: (anno as any).line_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED', // Preserve status for red border
          subQuestion: targetSubQ || anno.subQuestion, // FIX: Ensure subQuestion is propagated
          // STRIP zeroed visual positions to prevent svgOverlayService from prioritizing them at 0,0
          aiPosition: undefined,
          visual_position: undefined,
          visualPosition: undefined
        };
      }

      // FIX: Check if we have visible position data even if Unmatched (e.g. Q11 C1/C1)
      const visualPosForUnmatched = effectiveVisualPos;

      // Get dimensions for the relevant page
      const targetPageIndex = (visualPosForUnmatched?.pageIndex !== undefined)
        ? visualPosForUnmatched.pageIndex
        : defaultPageIndex;

      const pageDims = pageDimensions?.get(targetPageIndex);

      if (effectiveVisualPos && pageDims) {
        // Convert percentages to pixels
        const pWidth = pageDims.width;
        const pHeight = pageDims.height;
        let x = (parseFloat(effectiveVisualPos.x) / 100) * pWidth;
        let y = (parseFloat(effectiveVisualPos.y) / 100) * pHeight;
        let w = (parseFloat(effectiveVisualPos.width) / 100) * pWidth;
        let h = (parseFloat(effectiveVisualPos.height) / 100) * pHeight;

        // FIX: Ensure minimum visibility for fallback boxes (Q6 fix)
        // If box is microscopic (e.g. < 10px), scale it up to at least 50x30
        if (w < 10 || h < 10) {
          if (w < 50) w = 50;
          if (h < 30) h = 30;
        }

        // Log removed

        const lineIndex = (anno as any).lineIndex !== undefined ? (anno as any).lineIndex : (anno as any).line_index;
        const classificationLine = (task.classificationBlocks || []).flatMap(b => b.subQuestions.flatMap(sq => sq.studentWorkLines || []))[lineIndex];

        // Log removed
        // Determine page index for UNMATCHED fallback
        // Priority: 1. Line's own pageIndex, 2. task.sourcePages[0], 3. defaultPageIndex
        const fallbackPageIndex = classificationLine?.pageIndex !== undefined ? classificationLine.pageIndex : (task.sourcePages?.[0] ?? defaultPageIndex);

        return {
          ...anno,
          bbox: [x, y, w, h] as [number, number, number, number],
          pageIndex: fallbackPageIndex,
          line_id: (anno as any).line_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED',
          hasLineData: false,
          subQuestion: targetSubQ || anno.subQuestion
        };
      }

      // Fallback: Classification Block Anchoring (Prioritize Student Work Area)
      // If we know the sub-question identity (targetSubQ), find the corresponding Classification Block.
      // This block represents the "Student Work" area identified by the AI.
      // Anchoring here ensures we place the mark in the student work zone, not on the Question Text.
      if (targetSubQ && task.classificationBlocks) {
        const matchingBlock = task.classificationBlocks.find(b =>
          b.subQuestions && b.subQuestions.some((sq: any) => sq.part === targetSubQ)
        );

        if (matchingBlock && matchingBlock.studentWorkLines && matchingBlock.studentWorkLines.length > 0) {
          // Use the first line of the student work block as the anchor
          const firstLine = matchingBlock.studentWorkLines[0];
          if (firstLine && firstLine.position) {
            const pageIdx = firstLine.pageIndex ?? defaultPageIndex;
            const dim = pageDimensions?.get(pageIdx);

            let finalBbox: [number, number, number, number] = [
              firstLine.position.x,
              firstLine.position.y,
              firstLine.position.width || 100,
              firstLine.position.height || 20
            ];

            if (dim) {
              // Convert percentages to pixels if position is small (percentage-based)
              if (finalBbox[0] < 100) {
                finalBbox = [
                  (finalBbox[0] / 100) * dim.width,
                  (finalBbox[1] / 100) * dim.height,
                  (finalBbox[2] / 100) * dim.width,
                  (finalBbox[3] / 100) * dim.height
                ];
              }
            }

            if (String(questionId).startsWith('6') || String(questionId).startsWith('2')) {
              console.log(`[MARKING EXECUTOR] 🎯 CLASSIFICATION FALLBACK for Q${questionId} "${aiLineId}" -> Anchored to Student Work Area (SubQ: ${targetSubQ})`);
            }

            return {
              ...anno,
              bbox: finalBbox,
              pageIndex: pageIdx,
              line_id: (anno as any).line_id || `unmatched_${idx}`,
              ocr_match_status: 'UNMATCHED',
              hasLineData: false,
              subQuestion: targetSubQ || anno.subQuestion
            };
          }
        }
      }

      // Fallback: staggered positioning if no classification position found
      // STRATEGY: Find the "Question X" header block and place the annotation BELOW it.
      // This is safer than guessing "student work" blocks which might be confused with question text.

      const questionHeaderBlock = stepsDataForMapping.find(s =>
        s.text.includes('Question ' + questionId)
      );

      if (questionHeaderBlock && questionHeaderBlock.bbox) {
        const headerBbox = questionHeaderBlock.bbox;
        // Place it 30px below the header, with a standard height
        const newY = headerBbox[1] + headerBbox[3] + 30;
        const newBbox = [headerBbox[0], newY, 200, 50];

        return {
          ...anno,
          bbox: newBbox as [number, number, number, number],
          pageIndex: questionHeaderBlock.pageIndex ?? defaultPageIndex,
          line_id: questionHeaderBlock.line_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED',
          hasLineData: false,
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
        };
      }

      // Legacy "Largest Block" fallback removed as per user request.
      // It was causing marks to snap to Question Text blocks inappropriately.

      // Final Fallback: Robust Slice Center (Q15 Fix)
      // This is triggered if AI-matching and student work estimation both fail.
      const questionsOnPage = task.questionsOnPage?.get(defaultPageIndex) || [];
      const baseQNum = getBaseQuestionNumber(String(questionId));
      const myIdx = questionsOnPage.indexOf(baseQNum);
      const count = questionsOnPage.length || 1;
      const safeIdxInSlice = myIdx === -1 ? 0 : myIdx;

      // Stagger within slice based on index
      const sliceSizePercent = 100 / count;
      const centerYPercent = (safeIdxInSlice * sliceSizePercent) + (sliceSizePercent / 2);
      const staggeredYPercent = centerYPercent + (idx % 3) * 2;

      const fallbackPageDims = pageDimensions?.get(defaultPageIndex) || { width: 1000, height: 1400 };
      const sliceCenterPixelY = (staggeredYPercent / 100) * fallbackPageDims.height;

      console.log(`[FALLBACK] Q${questionId} -> Unmatched, using slice ${safeIdxInSlice + 1}/${count} on Page ${defaultPageIndex}`);

      return {
        ...anno,
        bbox: [fallbackPageDims.width * 0.1, sliceCenterPixelY, fallbackPageDims.width * 0.2, 40] as [number, number, number, number],
        pageIndex: defaultPageIndex,
        line_id: `unmatched_${idx}`,
        ocr_match_status: 'UNMATCHED',
        hasLineData: false,
        subQuestion: targetSubQ || anno.subQuestion
      };


      // Log removed

      // Final fallback if absolutely no blocks found (rare)
      const RED = '\x1b[31m';
      const BOLD = '\x1b[1m';
      const RESET = '\x1b[0m';
      console.log(`${BOLD}${RED}[ERROR: COORDINATE FAILURE] Q${questionId}: No coordinates found for "${anno.text}". Annotation will not appear.${RESET}`);
      return null;
    }

    // Fallback logic for missing line ID (e.g., Q3b "No effect")
    // If we can't find the step, use the previous valid annotation's location
    // This keeps sub-questions together instead of dropping them or defaulting to Page 1
    if (!originalStep) {
      // NEW: Check if we have AI position to construct a synthetic bbox
      if (effectiveVisualPos) {
        // Construct bbox from aiPos (x, y, w, h are percentages)
        // We need to convert to whatever unit bbox uses (likely pixels or normalized 0-1?)
        // stepsDataForMapping.bbox seems to be [x, y, w, h] in pixels?
        // Actually, aiPos is already normalized to 0-100 or 0-1000 by MarkingInstructionService
        // But we don't know the image dimensions here easily unless we look at task.imageData
        // However, svgOverlayService handles aiPosition separately!
        // So we just need to pass a DUMMY valid bbox so it doesn't get filtered out.
        // And ensure pageIndex is valid.

        // FIX: Use defaultPageIndex if lastValidAnnotation is not available
        // This ensures we default to the question's known page (e.g. 13) instead of 0
        let pageIndex = lastValidAnnotation ? lastValidAnnotation.pageIndex : defaultPageIndex;

        // FIX: If AI provided a pageIndex (relative), use it!
        // CHECK: If annotation comes from immutable pipeline, pageIndex is ALREADY global
        if ((anno as any)._immutable) {
          pageIndex = (anno as any).pageIndex;
        }

        // Try to map synthetic ID (e.g. line_5c_drawing) to a real line ID (e.g. line_5c)
        // This helps frontend group annotations correctly by sub-question
        let finalLineId = (anno as any).line_id || `synthetic_${idx}`;

        if (finalLineId.includes('_drawing')) {
          // Extract potential sub-question part (e.g. "5c" from "line_5c_drawing")
          const subQMatch = finalLineId.match(/line_(\d+[a-z])/i);
          if (subQMatch && subQMatch[1]) {
            const subQ = subQMatch[1]; // e.g. "5c"
            // Find a real step that matches this sub-question
            const realStep = stepsDataForMapping.find(s =>
              s.line_id && s.line_id.includes(subQ)
            );
            if (realStep) {
              finalLineId = realStep.line_id;

              // FIX: If the real step is NOT a drawing question (e.g. "Use your graph to find..."),
              // we should place the annotation near the text, NOT on the graph.
              // This prevents Q5c marks from appearing on Q5b graph.
              const stepText = (realStep.text || '').toLowerCase();
              const isDrawingQuestion = stepText.includes('draw') || stepText.includes('sketch') || stepText.includes('plot') || stepText.includes('grid');

              if (!isDrawingQuestion) {
                // Use the real step's bbox and REMOVE aiPosition so it renders as a text annotation
                return {
                  ...anno,
                  bbox: realStep.bbox as [number, number, number, number],
                  pageIndex: (anno as any)._immutable ? pageIndex : (realStep.pageIndex ?? pageIndex),
                  line_id: finalLineId,
                  aiPosition: undefined // Clear aiPosition to force text-based rendering
                };
              }
            }
          }
        }

        // Calculate real pixel bbox from percentages if page dimensions are available
        let pixelBbox: [number, number, number, number] = [1, 1, 1, 1];
        const pageDims = pageDimensions?.get(pageIndex);
        if (pageDims) {
          let x = (parseFloat(effectiveVisualPos.x) / 100) * pageDims.width;
          let y = (parseFloat(effectiveVisualPos.y) / 100) * pageDims.height;
          const w = (parseFloat(effectiveVisualPos.width || "50") / 100) * pageDims.width;
          const h = (parseFloat(effectiveVisualPos.height || "30") / 100) * pageDims.height;

          // ZONE CLAMPING REMOVED AS REQUESTED (Fancy snapping disabled)

          pixelBbox = [x, y, w, h];
        }

        // NEW: Detect if this is a drawing annotation for color-coding in SVGOverlayService
        const isDrawing = (anno as any).line_id && (anno as any).line_id.toString().toLowerCase().includes('drawing');

        const enriched = {
          ...anno,
          bbox: pixelBbox,
          pageIndex: (pageIndex !== undefined && pageIndex !== null) ? pageIndex : defaultPageIndex,
          line_id: finalLineId,
          visualPosition: effectiveVisualPos, // For DRAWING annotations only
          subQuestion: targetSubQ || anno.subQuestion, // FIX: Ensure subQuestion is propagated
          isDrawing: isDrawing // Flag for yellow border
        };
        // Debug log removed
        lastValidAnnotation = enriched; // Update last valid annotation
        return enriched;
      }

      // Check if we have a previous valid annotation to inherit from
      if (lastValidAnnotation) {
        const enriched = {
          ...anno,
          bbox: lastValidAnnotation.bbox,
          pageIndex: lastValidAnnotation.pageIndex,
          line_id: lastValidAnnotation.line_id
        };
        return enriched;
      }

      // FALLBACK: If unmatched, use standard geometric slicing
      const calculatedBaseQNum = getBaseQuestionNumber(String(questionId));
      const partKey = targetSubQ ? targetSubQ.toLowerCase() : '';

      let targetPages = [defaultPageIndex];
      if (partKey && task.subQuestionPageMap && task.subQuestionPageMap[partKey] && task.subQuestionPageMap[partKey].length > 0) {
        targetPages = task.subQuestionPageMap[partKey];
      } else if (task.allowedPageUnion && task.allowedPageUnion.length > 0) {
        targetPages = task.allowedPageUnion;
      }

      let bestPage = targetPages[0];
      let sliceIndex = 0;
      let sliceCount = 1;

      for (const p of targetPages) {
        const questionsOnThisPage = task.questionsOnPage?.get(p) || [];
        const fullSubQ = `${calculatedBaseQNum}${targetSubQ || ''}`;
        const idx = questionsOnThisPage.findIndex(q => q.toLowerCase().includes(fullSubQ.toLowerCase()));

        if (idx !== -1) {
          bestPage = p;
          sliceIndex = idx;
          sliceCount = questionsOnThisPage.length;
          break;
        }
      }

      const pDims = pageDimensions?.get(bestPage) || { width: 1000, height: 1400 };
      const sliceH = pDims.height / sliceCount;
      const visualY = (sliceIndex * sliceH) + (sliceH / 2);

      console.log(`[FALLBACK] Q${questionId} -> Unmatched, using slice ${sliceIndex}/${sliceCount} on Page ${bestPage}`);

      return {
        ...anno,
        bbox: [pDims.width * 0.1, visualY, pDims.width * 0.8, 50] as [number, number, number, number],
        pageIndex: bestPage,
        line_id: `fallback_slice_${bestPage}_${sliceIndex}`,
        ocr_match_status: 'UNMATCHED',
        subQuestion: targetSubQ || anno.subQuestion
      };


      // Log removed

      // Final fallback if absolutely no blocks found (rare)
      const RED = '\x1b[31m';
      const BOLD = '\x1b[1m';
      const RESET = '\x1b[0m';
      console.log(`${BOLD}${RED}[ERROR: COORDINATE FAILURE] Q${questionId}: No coordinates found for "${anno.text}". Annotation will not appear.${RESET}`);
      return null;
    }

    // Check if bbox is valid (not all zeros)
    const hasBbox = originalStep && originalStep.bbox && (originalStep.bbox[0] > 0 || originalStep.bbox[1] > 0);

    // Determine initial page index
    // PRIORITY: 1. Mapper Truth (Mandatory Constraint), 2. AI-provided pageIndex, 3. Original Step's pageIndex, 4. Default
    let pageSource = originalStep ? 'ORIGINAL_STEP' : 'DEFAULT';

    // START: Mapper Truth Enforcement (Highest Priority)
    if (task?.subQuestionPageMap) {
      // Use targetSubQ which is already normalized (e.g. "b")
      const subKey = targetSubQ;
      const allowedPages = subKey ? task.subQuestionPageMap[subKey] : undefined;

      if (allowedPages && allowedPages.length > 0) {
        // Relaxed Constraint: If current page is in the allowed list, let it stay!
        // This allows drawings on secondary pages to be correctly attributed.
        if (!allowedPages.includes(pageIndex)) {
          const constraintPage = allowedPages[0];
          // Log removed
          pageIndex = constraintPage;
        }
        // ALWAYS lock the source to prevent downstream reversion (e.g. by OCR step)
        pageSource = 'MAPPER_TRUTH';
      }
    }
    // END: Mapper Truth Enforcement

    // If AI provided a pageIndex (relative to the images array), map it to absolute page index
    // BUT only use it if we don't have a trusted pageIndex from the original step (OCR).
    // OCR/Classification is the ground truth for where the text physically is.

    // FIX for Q6: The immutable pipeline might default to Page 0 if not mapped correctly.
    // If we have a valid originalStep (OCR match), strictly Prefer OCR Page Index!
    // BUT ONLY if Mapper Truth didn't already override it.
    if (pageSource !== 'MAPPER_TRUTH') {
      if (originalStep && originalStep.pageIndex !== undefined) {
        pageIndex = originalStep.pageIndex;
        pageSource = 'ORIGINAL_STEP (Priority)';
      } else if ((anno as any)._immutable) {
        // Only fallback to immutable page if OCR step is missing
        const immutableGlobalPage = ((anno as any)._page?.global);
        // Ensure we don't default to 0 if it looks like a default value and we have other hints
        if (immutableGlobalPage !== undefined) {
          pageIndex = immutableGlobalPage as number;
          pageSource = 'IMMUTABLE_PIPELINE';
        }
      }
    }



    // Fallback logic removed - relying purely on AI page index as per new design.

    // For VISUAL annotations (drawings), ALWAYS use aiPosition, NOT OCR bbox
    // OCR bbox would point to question text, but visual_position points to drawing location
    const isVisualAnnotation = (anno as any).ocr_match_status === 'VISUAL';

    // Default processing for Matched or Visual items
    const isDrawing = (anno as any).line_id && (anno as any).line_id.toString().toLowerCase().includes('drawing');
    let pixelBbox: [number, number, number, number] = originalStep?.bbox ? [...originalStep.bbox] as [number, number, number, number] : [0, 0, 0, 0];

    // Prefer visual pos for drawings or if OCR missing (Matched but no Bbox)
    // CRITICAL FIX: If we have an AI Position but no OCR Bbox (e.g. Q6 "0.4" text), USE IT!
    if (effectiveVisualPos && (isDrawing || !hasBbox)) {
      const pIdx = (effectiveVisualPos.pageIndex !== undefined) ? effectiveVisualPos.pageIndex : pageIndex;
      const pageDims = pageDimensions?.get(pIdx);
      const effectiveWidth = pageDims?.width || 2000;
      const effectiveHeight = pageDims?.height || 3000;

      // DEFENSIVE: Treat as percentage if values are small, pixels if large
      const xVal = parseFloat(effectiveVisualPos.x);
      const isPercentage = xVal < 150;

      if (isPercentage) {
        pixelBbox = [
          (xVal / 100) * effectiveWidth,
          (parseFloat(effectiveVisualPos.y) / 100) * effectiveHeight,
          (parseFloat(effectiveVisualPos.width || "50") / 100) * effectiveWidth,
          (parseFloat(effectiveVisualPos.height || "30") / 100) * effectiveHeight
        ];
      } else {
        // Already looks like pixels
        pixelBbox = [
          xVal,
          parseFloat(effectiveVisualPos.y),
          parseFloat(effectiveVisualPos.width || "100"),
          parseFloat(effectiveVisualPos.height || "60")
        ];
      }
    } else if (originalStep?.bbox) {
      pixelBbox = originalStep.bbox;
    }

    const enriched: EnrichedAnnotation = {
      action: anno.action,
      text: anno.text,
      reasoning: anno.reasoning,
      ocr_match_status: ((anno as any).ocr_match_status === 'UNMATCHED') ? 'UNMATCHED' as any : (anno.ocr_match_status || 'MATCHED'),
      studentText: (anno as any).studentText || originalStep?.text || anno.text,
      subQuestion: targetSubQ || anno.subQuestion,
      line_id: (anno as any).line_id,
      bbox: pixelBbox,
      pageIndex: pageIndex,
      isDrawing: isDrawing,
      visualObservation: visualObservation
    };

    lastValidAnnotation = enriched;
    return enriched;
  }).filter((x): x is EnrichedAnnotation => x !== null);

  // DEDUPLICATION: Remove "Ghost" Unmatched annotations if a Matched version exists
  // This typically happens if the pipeline generates both a fallback and a match for the same step
  const uniqueResults = results.filter((current, index) => {
    // If current is MATCHED, always keep it
    if (current.ocr_match_status !== 'UNMATCHED') return true;

    // If current is UNMATCHED, check if a Better (MATCHED) version exists
    const betterVersionExists = results.some((other, otherIndex) => {
      if (index === otherIndex) return false; // Don't compare to self
      if (other.ocr_match_status === 'UNMATCHED') return false; // Only compare to MATCHED

      // Check for Identity Match
      const samePage = other.pageIndex === current.pageIndex;
      const sameText = other.text === current.text; // e.g. "P1"
      const sameAction = other.action === current.action; // e.g. "tick"

      // Check for SubQuestion Match (loosely) - treat null/undefined as wildcard if the other has value?
      // No, better to be strict but handle empty strings.
      const subQ1 = other.subQuestion ? String(other.subQuestion).trim() : '';
      const subQ2 = current.subQuestion ? String(current.subQuestion).trim() : '';

      // Fix for Q4: "a" vs "" should be considered a match if text/page/action match.
      // Also handle loose matching for explicit 'a' vs implicit main question.
      const sameSubQ = (subQ1 === subQ2)
        || ((subQ1 === '' || subQ1 === 'a') && (subQ2 === '' || subQ2 === 'a'));

      return samePage && sameText && sameAction && sameSubQ;
    });

    // If a better version exists, discard this unmatched ghost
    if (betterVersionExists) {
      // console.log(`[MARKING DEBUG] Removing Duplicate Ghost Annotation: ${current.text} (Found MATCHED version)`);
      return false;
    }
    return true;
  });

  // [SNAP PASS] Final pass to snap "Floating" (Unmatched/Visual) annotations to "Anchor" (Matched) annotations
  // strictly within the SAME sub-question.
  // This ensures that marks for the same student work (e.g. M1 and A1 for "4") serve logic together.

  // Group by sub-question (normalized)
  const subQGroups = new Map<string, EnrichedAnnotation[]>();
  uniqueResults.forEach(anno => {
    if (anno.subQuestion) {
      if (!subQGroups.has(anno.subQuestion)) subQGroups.set(anno.subQuestion, []);
      subQGroups.get(anno.subQuestion)!.push(anno);
    }
  });

  subQGroups.forEach((group, subQKey) => {
    // Find Anchor (Matched with Line Data)
    // Prioritize annotations that clearly matched an OCR block
    const anchor = group.find(a =>
      a.ocr_match_status === 'MATCHED' &&
      a.hasLineData === true &&
      a.bbox && a.bbox[2] > 0 // Valid width
    );

    if (anchor) {
      group.forEach(floater => {
        // Snap Floaters (Unmatched or Fallback Visual) to Anchor
        // Do not snap if it's already matched or is the anchor itself
        if (floater !== anchor &&
          (floater.ocr_match_status === 'UNMATCHED' || floater.ocr_match_status === 'FALLBACK' ||
            (floater.ocr_match_status === 'VISUAL' && !floater.hasLineData))) {

          if (String(questionId).startsWith('6') || String(questionId).startsWith('16')) {
            console.log(`[SNAP PASS] Snapping "${floater.text}" (${floater.ocr_match_status}) to Anchor "${anchor.text}" in Q${questionId}${subQKey}`);
          }

          // Copy Anchor properties
          floater.bbox = [...anchor.bbox] as [number, number, number, number];
          floater.pageIndex = anchor.pageIndex;
          floater.ocr_match_status = 'MATCHED'; // Promote to Matched so it draws solidly
          floater.hasLineData = true; // Treat as having line data now

          // Note: SVGOverlayService handles stacking of identical bboxes automatically
        }
      });
    }
  });

  return uniqueResults;

};

// Helper for bbox check
function hasValidBbox(step: any) {
  return step && step.bbox && (step.bbox[0] > 0 || step.bbox[1] > 0);
}






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
      if (q.studentWorkLines && q.studentWorkLines.length > 0) {
        q.studentWorkLines.forEach((line: any) => {
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

