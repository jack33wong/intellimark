/**
 * Marking Executor Service
 * Executes AI marking and feedback generation for a single question task
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { MarkingInstructions, Annotation } from '../../types/index.js';
import type { MathBlock } from '../ocr/MathDetectionService.js';
import type { ModelType } from '../../config/aiModels.js';
import type { PageOcrResult } from '../../types/markingRouter.js';
import { formatGroupedStudentWork } from './MarkingHelpers.js';
import { getBaseQuestionNumber } from '../../utils/TextNormalizationUtils.js';

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
  // Legacy fields (kept for backward compatibility, but not used in enhanced marking)
  aiSegmentationResults?: Array<{ content: string; source: string; blockId: string }>;
  blockToClassificationMap?: Map<string, { classificationLine: string; similarity: number; questionNumber?: string; subQuestionPart?: string }>;
}

export interface QuestionResult {
  questionNumber: number | string;
  score: any;
  annotations: EnrichedAnnotation[];
  feedback?: string;
  usageTokens?: number; // Add usage tokens from AI responses
  confidence?: number; // Add confidence score
  mathpixCalls?: number; // Add mathpix calls count
  markingScheme?: any; // Include marking scheme for reference
  studentWork?: string; // Raw student work text (OCR/Classification)
  promptMarkingScheme?: string; // The exact text-based marking scheme used in the prompt
  classificationBlocks?: any[]; // Classification blocks with line data
  questionText?: string; // Detected question text
  databaseQuestionText?: string; // Text from database match
  pageIndex?: number; // Primary page index for this question
  overallPerformanceSummary?: string; // AI-generated overall performance summary
}

export interface EnrichedAnnotation extends Annotation {
  bbox: [number, number, number, number];
  pageIndex: number;
  unified_step_id?: string; // Optional, for tracking which step this annotation maps to
  aiPosition?: { x: number; y: number; width: number; height: number }; // AI-estimated position for verification
  hasLineData?: boolean; // Flag indicating if annotation uses actual line data (OCR) or fallback
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
  tracker?: any // UsageTracker (optional)
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



    // 1. Prepare STEP DATA (still need this array for enriching annotations later)
    // Use AI segmentation results if available, otherwise fall back to OCR blocks
    let stepsDataForMapping: Array<{
      unified_step_id: string;
      pageIndex: number;
      globalBlockId?: string;
      text: string;
      cleanedText: string;
      bbox: [number, number, number, number];
      ocrSource?: string; // Add ocrSource to type definition
    }>;



    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      // Use AI segmentation results - map back to original blocks for coordinates
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        // Find the corresponding block by blockId
        const matchingBlock = task.mathBlocks.find(block => {
          const blockId = (block as any).globalBlockId || `${(block as any).pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
          return blockId === result.blockId;
        });

        // Use coordinates from matching block if found
        let bbox: [number, number, number, number] = [0, 0, 0, 0];
        if (matchingBlock?.coordinates &&
          matchingBlock.coordinates.x != null && matchingBlock.coordinates.y != null &&
          matchingBlock.coordinates.width != null && matchingBlock.coordinates.height != null) {
          bbox = [matchingBlock.coordinates.x, matchingBlock.coordinates.y, matchingBlock.coordinates.width, matchingBlock.coordinates.height];
        } else if (result.content?.includes('[DRAWING]')) {
          // For drawings without OCR coordinates, estimate bbox from position information
          // First try to get position from result.content, then fall back to classificationStudentWork
          let pageIndex = -1;
          const annotationText = result.content.toLowerCase();
          let positionMatch = result.content.match(/\[POSITION:\s*([^\]]+)\]/i);
          let position: string | null = null;

          if (positionMatch) {
            position = positionMatch[1];
          } else if (task.classificationStudentWork) {
            // If position not in merged content, try to find it in original classification
            // The AI might have split the drawing into multiple entries, so search for any [DRAWING] with position
            // Try to match by content similarity first, then fall back to first position found
            const drawingEntries = task.classificationStudentWork.split(/\n|\\n/).filter(e => e.includes('[DRAWING]'));
            let bestMatch: string | null = null;

            for (const entry of drawingEntries) {
              const entryPositionMatch = entry.match(/\[POSITION:\s*([^\]]+)\]/i);
              if (entryPositionMatch) {
                // Try to match by content keywords (e.g., "Graph", "Y-axis label")
                const entryKeywords = entry.toLowerCase();
                const contentKeywords = result.content.toLowerCase();
                const hasMatchingKeywords =
                  (entryKeywords.includes('graph') && contentKeywords.includes('graph')) ||
                  (entryKeywords.includes('y-axis') && contentKeywords.includes('y-axis')) ||
                  (entryKeywords.includes('label') && contentKeywords.includes('label'));

                if (hasMatchingKeywords || !bestMatch) {
                  bestMatch = entryPositionMatch[1];
                  if (hasMatchingKeywords) break; // Found a good match, use it
                }
              }
            }

            if (bestMatch) {
              position = bestMatch;
            }
          }


          // Prioritize blocks that look like drawings if the annotation is a drawing
          const isDrawing = annotationText.includes('drawing') || annotationText.includes('graph');

          let bestBlockIndex = -1;

          for (let i = 0; i < task.classificationBlocks.length; i++) {
            const block = task.classificationBlocks[i];
            const blockText = block.text.toLowerCase();

            // Exact(ish) match
            if (blockText.includes(annotationText) || annotationText.includes(blockText)) {
              bestBlockIndex = i;
              break;
            }

            // If it's a drawing annotation, look for drawing blocks
            if (isDrawing && (blockText.includes('[drawing]') || blockText.includes('graph'))) {
              // Keep this as a candidate, but prefer text match
              if (bestBlockIndex === -1) bestBlockIndex = i;
            }
          }

          if (bestBlockIndex !== -1) {
            pageIndex = task.classificationBlocks[bestBlockIndex].pageIndex;
            console.log(`[MARKING EXECUTOR] Found page ${pageIndex} for drawing annotation from classification block`);
          } else {
            console.log(`[MARKING EXECUTOR] ⚠️ Could not find matching classification block for drawing annotation: "${annotationText}"`);
            console.log(`[MARKING EXECUTOR] Available classification blocks:`, task.classificationBlocks.map(b => b.text.substring(0, 20)));
          }

          // Fallback to first source page if still not found
          if (pageIndex === -1) {
            console.log(`[MARKING EXECUTOR] ⚠️ Fallback to first source page for drawing annotation`);
            pageIndex = (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);
          }
          const percentMatch = position.match(/x\s*=\s*(\d+(?:\.\d+)?)%\s*,\s*y\s*=\s*(\d+(?:\.\d+)?)%/i);
          if (percentMatch) {
            const pageDims = task.pageDimensions?.get(pageIndex);
            const pageWidth = pageDims?.width || 2000;
            const pageHeight = pageDims?.height || 3000;
            const xPercent = parseFloat(percentMatch[1]);
            const yPercent = parseFloat(percentMatch[2]);

            // Determine drawing dimensions based on type
            let drawingWidth = 300;
            let drawingHeight = 300;
            if (result.content.includes('marked at') || result.content.includes('Center of rotation') ||
              result.content.includes('Mark') || (result.content.includes('at (') && !result.content.includes('vertices'))) {
              drawingWidth = 80;
              drawingHeight = 80;
            } else if (result.content.includes('Coordinate grid') || (result.content.includes('triangle') && result.content.includes('vertices'))) {
              drawingWidth = 200;
              drawingHeight = 200;
            } else if (result.content.includes('Histogram')) {
              drawingWidth = 400;
              drawingHeight = 300;
            } else if (result.content.includes('Graph')) {
              drawingWidth = 400;
              drawingHeight = 300;
            }

            // Position represents center, so calculate top-left corner
            const centerX = (xPercent / 100) * pageWidth;
            const centerY = (yPercent / 100) * pageHeight;
            const x = centerX - (drawingWidth / 2);
            const y = centerY - (drawingHeight / 2);

            bbox = [Math.max(0, x), Math.max(0, y), drawingWidth, drawingHeight];
          }
        }


        // NEW: Fallback for non-drawing text when OCR mapping failed
        // Use classification block metadata to estimate position
        // Use classification block metadata to estimate position
        let matchingBlockIndex = -1;
        // CRITICAL: Do NOT use this fallback for [DRAWING] entries. If a drawing has no position from the drawing logic above,
        // it means it's likely a false positive (phantom drawing) and should be filtered out, not assigned a default position.
        const isDrawingEntry = result.content.includes('[DRAWING]');

        if (!isDrawingEntry && bbox[0] === 0 && bbox[1] === 0 && bbox[2] === 0 && bbox[3] === 0 && task.classificationBlocks && task.classificationBlocks.length > 0) {
          // Try to find which classification block this annotation text came from
          const annotationText = result.content.substring(0, 30).toLowerCase(); // First 30 chars for matching

          for (let i = 0; i < task.classificationBlocks.length; i++) {
            const blockText = task.classificationBlocks[i].text.substring(0, 30).toLowerCase();
            if (blockText.includes(annotationText) || annotationText.includes(blockText)) {
              matchingBlockIndex = i;
              break;
            }
          }

          if (matchingBlockIndex >= 0) {
            const block = task.classificationBlocks[matchingBlockIndex];
            const pageIndex = block.pageIndex;
            const pageDims = task.pageDimensions?.get(pageIndex);
            const pageWidth = pageDims?.width || 2000;
            const pageHeight = pageDims?.height || 3000;

            // Estimate Y position based on block index in sequence
            // Spread blocks evenly across the page
            const totalBlocks = task.classificationBlocks.length;
            const blockFraction = (matchingBlockIndex + 0.5) / totalBlocks; // 0.5 to center within block's area
            const estimatedY = pageHeight * 0.15 + (pageHeight * 0.7 * blockFraction); // Use middle 70% of page

            // Place annotation on the right side
            const estimatedX = pageWidth - 180;

            bbox = [Math.max(0, estimatedX), Math.max(0, estimatedY), 150, 60];
            console.log(`[MARKING EXECUTOR] Used classification block #${matchingBlockIndex} for annotation position: [${bbox[0].toFixed(0)}, ${bbox[1].toFixed(0)}]`);
          }
        }

        return {
          unified_step_id: `step_${stepIndex + 1}`, // Simplified format (matches AI prompt)
          pageIndex: matchingBlock ? ((matchingBlock as any).pageIndex ?? -1) : (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : -1),
          globalBlockId: result.blockId,
          text: result.content, // Use AI segmentation merged content
          cleanedText: result.content, // Use AI segmentation merged content
          bbox,
          ocrSource: matchingBlockIndex >= 0 ? 'estimated' : undefined // Flag as estimated if using classification block fallback
        };
      }).filter(step => {
        // Filter out [DRAWING] entries that have no valid position (bbox is [0,0,0,0])
        // This hides "phantom" drawings where the AI hallucinated a [DRAWING] tag but no position was found
        if (step.text.includes('[DRAWING]') && step.bbox[0] === 0 && step.bbox[1] === 0 && step.bbox[2] === 0 && step.bbox[3] === 0) {
          console.log(`[MARKING EXECUTOR] 👻 Filtering out phantom drawing (no position): "${step.text.substring(0, 50)}..."`);
          return false;
        }
        return true;
      });
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
          unified_step_id: `step_${stepIndex + 1}`,
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
        } else if (drawingText.includes('Coordinate grid') || (drawingText.includes('triangle') && drawingText.includes('vertices'))) {
          // For triangles on coordinate grids: use medium dimensions
          // The position represents the center of the triangle, not the entire grid
          // Triangles are typically 100-200px in size on the grid
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
          let drawingPageIndex = task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0;

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
          // Use simplified step ID format to match AI prompt (step_1, step_2, etc.)
          const drawingStepIndex = stepsDataForMapping.length + 1;
          const drawingBlock = {
            unified_step_id: `step_${drawingStepIndex}`, // Simplified format (matches AI prompt)
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
        const simplifiedStepId = `step_${index + 1}`;
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
        // Use simplified step ID format for AI prompt (e.g., [step_1], [step_2])
        const simplifiedStepId = `step_${index + 1}`;
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

      // Normalize page index to be 0-based relative to the question's pages
      // This ensures the AI prompt sees "Page 0", "Page 1" matching the image sequence
      let normalizedPageIndex = 0;
      const rawPageIndex = (block as any).pageIndex ?? task.sourcePages[0] ?? 0;

      if (task.sourcePages && task.sourcePages.length > 0) {
        const foundIndex = task.sourcePages.indexOf(rawPageIndex);
        if (foundIndex !== -1) {
          normalizedPageIndex = foundIndex;
        }
      }

      return {
        id: blockId,
        text: block.mathpixLatex || block.googleVisionText || '',
        pageIndex: normalizedPageIndex,
        coordinates: block.coordinates ? {
          x: block.coordinates.x,
          y: block.coordinates.y
        } : undefined
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



    const markingResult = await MarkingInstructionService.executeMarking({
      imageData: task.imageData || '', // Pass image for edge cases where Drawing Classification failed
      images: task.images, // Pass all page images for multi-page context
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
        // Enhanced marking: pass raw OCR blocks and classification
        rawOcrBlocks: rawOcrBlocks,
        classificationStudentWork: task.classificationStudentWork,
        classificationBlocks: task.classificationBlocks, // For position lookup via studentWorkLines
        // Pass sub-question metadata for grouped sub-questions
        subQuestionMetadata: task.subQuestionMetadata
      } as any, // Type assertion for mock object
      questionDetection: task.markingScheme, // Pass the marking scheme directly (don't use questionDetection if it exists, as it may be wrong for merged schemes)
      questionText: questionText, // Pass question text from fullExamPapers to AI prompt
      questionNumber: String(questionId), // Pass question number (may include sub-question part like "17a", "17b")
      allPagesOcrData: allPagesOcrData, // Pass all pages OCR data for multi-page context
      sourceImageIndices: task.sourcePages, // Pass page indices for relative-to-global pageIndex mapping
      tracker: tracker // Pass tracker for auto-recording
    });

    console.log(`🔍 [EXECUTOR DEBUG Q${questionId}] Just received markingResult from MarkingInstructionService:`);
    console.log(`   - markingResult keys: ${Object.keys(markingResult).join(', ')}`);
    console.log(`   - Has .overallPerformanceSummary: ${!!markingResult.overallPerformanceSummary}`);
    console.log(`   - Has (as any).overallPerformanceSummary: ${!!(markingResult as any).overallPerformanceSummary}`);

    sendSseUpdate(res, createProgressData(6, `Annotations generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));


    // Basic validation of marking result
    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
      throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // 4. Skip feedback generation - removed as requested

    // 6. Enrich annotations with positions
    const defaultPageIndex = (task.sourcePages && task.sourcePages.length > 0) ? task.sourcePages[0] : 0;
    const enrichedAnnotations = enrichAnnotationsWithPositions(
      markingResult.annotations || [],
      stepsDataForMapping, // Keep stepsDataForMapping as it contains synthetic drawing blocks and unified_step_ids
      String(questionId),
      defaultPageIndex,
      task.pageDimensions, // New argument
      task.classificationBlocks, // Pass classification blocks for sub-question page lookup
      task // New argument
    );





    // 7. Generate Final Output
    console.log(`🔍 [EXECUTOR DEBUG Q${questionId}] Checking markingResult for overallPerformanceSummary...`);
    console.log(`   - Has overallPerformanceSummary in markingResult: ${!!(markingResult as any).overallPerformanceSummary}`);

    const questionResult: QuestionResult = {
      questionNumber: questionId,
      score: parseScore(markingResult.studentScore),
      annotations: enrichedAnnotations,
      pageIndex: (task.sourcePages && task.sourcePages.length > 0) ? task.sourcePages[0] : 0,
      usageTokens: (markingResult as any).usage?.llmTokens || (markingResult as any).usageTokens || 0, // Map usageTokens correctly from nested object
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

    console.log(`   - Added to questionResult: ${!!questionResult.overallPerformanceSummary}`);
    if (questionResult.overallPerformanceSummary) {
      console.log(`   - Summary in questionResult: "${questionResult.overallPerformanceSummary.substring(0, 80)}..."`);
    }

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
  defaultPageIndex: number = 0, // NEW: Accept default page index (from task.sourcePages)
  pageDimensions: Map<number, { width: number; height: number }> | undefined,
  classificationBlocks: MarkingTask['classificationBlocks'],
  task: MarkingTask // Add task parameter to access sourcePages
): EnrichedAnnotation[] => {
  let lastValidAnnotation: EnrichedAnnotation | null = null;




  // Code -> SubQuestion Map building removed as per user request (relying on Classification/Page Inference)


  const results = annotations.map((anno, idx) => {


    // Check if we have AI-provided position (New Design)
    // Immutable annotations map 'visual_position' to 'aiPosition'
    // Check if we have AI-provided position (New Design)
    // Immutable annotations map 'visual_position' to 'aiPosition'
    const visualPos = (anno as any).aiPosition || (anno as any).visual_position; // Visual position for DRAWING annotations only (from marking AI)

    // FIX START: Extract sub-question target early so it's available for ALL paths (Visual, Unmatched, etc.)
    // FIX START: Infer sub-question from Page Content (Classification Blocks)
    let targetSubQ: string | undefined;

    // Simple page-based inference - only for debugging, NOT for production use
    // This was causing pageIndex mismatches and breaking Q3b/Q11
    // Removed complex spatial matching logic
    // FIX END

    // FIX END

    // Trim both IDs to protect against hidden whitespace
    const aiStepId = (anno as any).step_id?.trim();
    if (!aiStepId && !visualPos) {
      return null;
    }

    // Try exact match first (check both unified_step_id and globalBlockId)
    let originalStep = stepsDataForMapping.find(step =>
      step.unified_step_id?.trim() === aiStepId || step.globalBlockId?.trim() === aiStepId
    );



    // If not found, try flexible matching (handle step_1 vs q8_step_1, etc.)
    if (!originalStep && aiStepId) {
      // Extract step number from AI step_id (e.g., "step_2" -> "2", "q8_step_2" -> "2")
      const stepNumMatch = aiStepId.match(/step[_\s]*(\d+)/i);
      if (stepNumMatch && stepNumMatch[1]) {
        const stepNum = parseInt(stepNumMatch[1], 10);
        // Match by step index (1-based)
        if (stepNum > 0 && stepNum <= stepsDataForMapping.length) {
          originalStep = stepsDataForMapping[stepNum - 1];
        }
      }
    }

    // If still not found, check if AI is using OCR block ID format (block_X_Y)
    if (!originalStep && aiStepId && aiStepId.startsWith('block_')) {
      originalStep = stepsDataForMapping.find(step =>
        step.globalBlockId?.trim() === aiStepId
      );


    }

    // Special handling for [DRAWING] annotations
    // Since we now create separate synthetic blocks for each drawing, match by text content
    // AI might return step_id like "DRAWING_Triangle B..." instead of unified_step_id
    if (!originalStep) {
      const annotationText = ((anno as any).textMatch || (anno as any).text || '').toLowerCase();
      const isDrawingAnnotation = annotationText.includes('[drawing]') || (aiStepId && aiStepId.toLowerCase().includes('drawing'));

      if (isDrawingAnnotation) {
        // First, try to match by step_id if it contains a step number
        const stepNumMatch = aiStepId ? aiStepId.match(/step[_\s]*(\d+)/i) : null;
        if (stepNumMatch && stepNumMatch[1]) {
          const stepNum = parseInt(stepNumMatch[1], 10);
          if (stepNum > 0 && stepNum <= stepsDataForMapping.length) {
            const candidateStep = stepsDataForMapping[stepNum - 1];
            if (candidateStep && (candidateStep.text || candidateStep.cleanedText || '').toLowerCase().includes('[drawing]')) {
              originalStep = candidateStep;
            }
          }
        }

        // If step number matching failed, try text-based matching
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
          }
        }
      }

      // If we found a classification position, use it
      if (classificationPosition) {
        return {
          ...anno,
          bbox: [
            classificationPosition.x,
            classificationPosition.y,
            classificationPosition.width || 100,
            classificationPosition.height || 20
          ] as [number, number, number, number],
          pageIndex: classificationPosition.pageIndex,
          unified_step_id: (anno as any).step_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED', // Preserve status for red border
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
        };
      }

      // FIX: Check if we have visible position data even if Unmatched (e.g. Q11 C1/C1)
      const visualPosForUnmatched = (anno as any).aiPosition || (anno as any).visual_position;

      // Get dimensions for the relevant page
      const targetPageIndex = (visualPosForUnmatched?.pageIndex !== undefined)
        ? visualPosForUnmatched.pageIndex
        : defaultPageIndex;

      const pageDims = pageDimensions?.get(targetPageIndex);

      if (visualPosForUnmatched && pageDims) {
        // Convert percentages to pixels
        const pWidth = pageDims.width;
        const pHeight = pageDims.height;
        const x = (parseFloat(visualPosForUnmatched.x) / 100) * pWidth;
        const y = (parseFloat(visualPosForUnmatched.y) / 100) * pHeight;
        const w = (parseFloat(visualPosForUnmatched.width) / 100) * pWidth;
        const h = (parseFloat(visualPosForUnmatched.height) / 100) * pHeight;

        return {
          ...anno,
          bbox: [x, y, w, h] as [number, number, number, number],
          pageIndex: targetPageIndex,
          unified_step_id: (anno as any).step_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED', // Keep as unmatched but with visual pos
          hasLineData: false,
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
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
          if (firstLine && firstLine.position) { // Use position instead of bbox for consistency with classificationPosition
            return {
              ...anno,
              bbox: [
                firstLine.position.x,
                firstLine.position.y,
                firstLine.position.width || 100,
                firstLine.position.height || 20
              ] as [number, number, number, number],
              pageIndex: firstLine.pageIndex ?? defaultPageIndex,
              unified_step_id: (anno as any).step_id || `unmatched_${idx}`, // Use anno.step_id if available
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
          unified_step_id: questionHeaderBlock.unified_step_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED',
          hasLineData: false,
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
        };
      }

      // Legacy "Largest Block" fallback removed as per user request.
      // It was causing marks to snap to Question Text blocks inappropriately.

      // Final fallback (staggered) if absolutely no blocks found
      const yOffset = 10 + (idx % 3) * 5;
      return {
        ...anno,
        aiPosition: { x: 50, y: yOffset, width: 40, height: 5 },
        bbox: [1, 1, 1, 1] as [number, number, number, number],
        pageIndex: defaultPageIndex,
        unified_step_id: `unmatched_${idx}`,
        ocr_match_status: 'UNMATCHED',
        hasLineData: false
      };
    }

    // Fallback logic for missing step ID (e.g., Q3b "No effect")
    // If we can't find the step, use the previous valid annotation's location
    // This keeps sub-questions together instead of dropping them or defaulting to Page 1
    if (!originalStep) {
      // NEW: Check if we have AI position to construct a synthetic bbox
      if (visualPos) {
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

        // Try to map synthetic ID (e.g. step_5c_drawing) to a real step ID (e.g. step_5c)
        // This helps frontend group annotations correctly by sub-question
        let finalStepId = (anno as any).step_id || `synthetic_${idx}`;

        if (finalStepId.includes('_drawing')) {
          // Extract potential sub-question part (e.g. "5c" from "step_5c_drawing")
          const subQMatch = finalStepId.match(/step_(\d+[a-z])/i);
          if (subQMatch && subQMatch[1]) {
            const subQ = subQMatch[1]; // e.g. "5c"
            // Find a real step that matches this sub-question
            const realStep = stepsDataForMapping.find(s =>
              s.unified_step_id && s.unified_step_id.includes(subQ)
            );
            if (realStep) {
              finalStepId = realStep.unified_step_id;

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
                  unified_step_id: finalStepId,
                  aiPosition: undefined // Clear aiPosition to force text-based rendering
                };
              }
            }
          }
        }

        const enriched = {
          ...anno,
          bbox: [1, 1, 1, 1] as [number, number, number, number], // Dummy bbox, visualPosition handles drawing positioning
          pageIndex: (pageIndex !== undefined && pageIndex !== null) ? pageIndex : defaultPageIndex,
          unified_step_id: finalStepId,
          visualPosition: visualPos, // For DRAWING annotations only
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
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
          unified_step_id: lastValidAnnotation.unified_step_id
        };
        return enriched;
      }

      // FALLBACK: If unmatched and no previous annotation.
      // STRATEGY: Find the "Question X" header block and place the annotation BELOW it.
      // This is safer than guessing "student work" blocks which might be confused with question text.
      // If we place it below the header, it appears in the whitespace where the student should have written.

      const questionHeaderBlock = stepsDataForMapping.find(s =>
        s.text.includes('Question ' + questionId)
      );

      if (questionHeaderBlock && questionHeaderBlock.bbox) {
        // console.log(`[MARKING EXECUTOR] Using Question Header offset for unmatched annotation`);
        const headerBbox = questionHeaderBlock.bbox;
        // Place it 30px below the header, with a standard height
        const newY = headerBbox[1] + headerBbox[3] + 30;
        const newBbox = [headerBbox[0], newY, 200, 50]; // Reasonable size for a text annotation

        return {
          ...anno,
          bbox: newBbox as [number, number, number, number],
          pageIndex: questionHeaderBlock.pageIndex ?? defaultPageIndex,
          unified_step_id: questionHeaderBlock.unified_step_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED', // Ensure status is preserved
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
        };
      }

      // Secondary Fallback: If no header found, use the "largest block" strategy as a last resort
      // (This likely returns the question text if header wasn't found, but it's better than 0,0)
      const candidateBlocks = stepsDataForMapping.filter(s =>
        s.bbox && (s.bbox[2] > 0 && s.bbox[3] > 0)
      );
      // Sort by area
      candidateBlocks.sort((a, b) => (b.bbox[2] * b.bbox[3]) - (a.bbox[2] * a.bbox[3]));

      if (candidateBlocks.length > 0) {
        return {
          ...anno,
          bbox: candidateBlocks[0].bbox as [number, number, number, number],
          pageIndex: candidateBlocks[0].pageIndex ?? defaultPageIndex,
          unified_step_id: candidateBlocks[0].unified_step_id || `unmatched_${idx}`,
          ocr_match_status: 'UNMATCHED',
          subQuestion: targetSubQ || anno.subQuestion // FIX: Ensure subQuestion is propagated
        };
      }

      // Final fallback if absolutely no blocks found (rare)
      return null;
    }

    // Check if bbox is valid (not all zeros)
    const hasValidBbox = originalStep.bbox && (originalStep.bbox[0] > 0 || originalStep.bbox[1] > 0);

    // Determine initial page index
    // PRIORITY: 1. AI-provided pageIndex (from visual analysis), 2. Original Step's pageIndex, 3. Default
    let pageIndex = originalStep.pageIndex ?? defaultPageIndex;
    let pageSource = 'DEFAULT';

    if (originalStep.pageIndex !== undefined) pageSource = 'ORIGINAL_STEP';

    // If AI provided a pageIndex (relative to the images array), map it to absolute page index
    // BUT only use it if we don't have a trusted pageIndex from the original step (OCR).
    // OCR/Classification is the ground truth for where the text physically is.
    // FIX: If annotation comes from immutable pipeline, use its GLOBAL pageIndex
    // This overrides any OCR-based page index because the pipeline handles multi-page logic
    // CRITICAL: Use page.global (which has already been mapped) not raw pageIndex (which is relative)
    if ((anno as any)._immutable) {
      pageIndex = ((anno as any)._page?.global ?? (anno as any).pageIndex) as number;
    }

    if (String(questionId) === '11') {

    }

    // Fallback logic removed - relying purely on AI page index as per new design.

    // For VISUAL annotations (drawings), ALWAYS use aiPosition, NOT OCR bbox
    // OCR bbox would point to question text, but visual_position points to drawing location
    const isVisualAnnotation = (anno as any).ocr_match_status === 'VISUAL';

    const enriched = {
      action: anno.action, // Explicit mapping to prevent data leakage (e.g. questionText from AI hallucination)
      text: anno.text,
      reasoning: anno.reasoning,
      ocr_match_status: anno.ocr_match_status,
      classification_text: (anno as any).classification_text,
      studentText: (anno as any).studentText, // CRITICAL: Preserve AI-selected student work text
      classificationText: (anno as any).classificationText, // CRITICAL: Preserve alternative text source
      subQuestion: targetSubQ || anno.subQuestion, // FIX: Use targetSubQ if available (scheme override)
      step_id: (anno as any).step_id, // Keep original step_id for debug/re-mapping


      // VISUAL: Use dummy bbox, let aiPosition handle positioning (design: visual_position is source of truth)
      // Non-VISUAL: Use OCR bbox if available, otherwise dummy if we have aiPos
      visualPosition: isVisualAnnotation ? visualPos : undefined,
      pageIndex: (pageIndex !== undefined && pageIndex !== null) ? pageIndex : defaultPageIndex,
      bbox: (() => {
        if (isVisualAnnotation && visualPos) {
          // Convert percentage visualPos to pixel bbox if page dimensions are available
          // visualPos is { x: %, y: %, width: %, height: % } (CENTER coordinates from AI)
          // But standard bbox is [x, y, w, h] (TOP-LEFT in pixels)

          // Get dimensions for the page where the drawing is
          const dim = pageDimensions?.get(pageIndex);
          if (dim) {
            // Percentage to Pixel conversion
            const cx = (parseFloat(visualPos.x) / 100) * dim.width;
            const cy = (parseFloat(visualPos.y) / 100) * dim.height;
            const w = (parseFloat(visualPos.width) / 100) * dim.width;
            const h = (parseFloat(visualPos.height) / 100) * dim.height;

            // Center -> Top-Left
            const x = Math.max(0, cx - (w / 2));
            const y = Math.max(0, cy - (h / 2));

            return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)] as [number, number, number, number];
          }
          // Fallback if dimensions missing: try to pass generic normalized if allowed, else dummy
          return [100, 100, 100, 100] as [number, number, number, number]; // Larger dummy
        }
        return hasValidBbox ? originalStep.bbox : [1, 1, 1, 1] as [number, number, number, number];
      })(),
      // Flag if we are using actual line data (OCR) or falling back to AI position
      // VISUAL annotations always use AI position (hasLineData = false)
      hasLineData: isVisualAnnotation ? false : hasValidBbox
    };
    lastValidAnnotation = enriched as any;
    return enriched;
  }).filter(a => a !== null) as EnrichedAnnotation[];

  // SORTING DESIGN:
  // 1. Meta Info Page First (Page Index ASC)
  // 2. Sub-Question Grouping
  // 3. Step ID (Reading Order) - Critical for maintaining sequence even if one item is unmatched (dummy Y)
  // 4. Fallback: Y-Position (Top to Bottom)
  const sortedResults = results.sort((a, b) => {
    // 1. Meta Info Page First (Page Index)
    if (a.pageIndex !== b.pageIndex) {
      return a.pageIndex - b.pageIndex;
    }

    // 2. Sub-Question Number
    const subQA = (a as any).subQuestion || '';
    const subQB = (b as any).subQuestion || '';
    if (subQA !== subQB) {
      return subQA.localeCompare(subQB);
    }

    // 3. Step ID (Robust Numeric Sort)
    const idA = (a as any).step_id || '';
    const idB = (b as any).step_id || '';

    const matchA = idA.match(/block_(\d+)_(\d+)/);
    const matchB = idB.match(/block_(\d+)_(\d+)/);

    if (matchA && matchB) {
      const pageA = parseInt(matchA[1], 10);
      const pageB = parseInt(matchB[1], 10);
      if (pageA !== pageB) return pageA - pageB;
      const blockA = parseInt(matchA[2], 10);
      const blockB = parseInt(matchB[2], 10);
      if (blockA !== blockB) return blockA - blockB;
    }

    // 4. Fallback: Y-Position (Top to Bottom)
    const yA = a.bbox ? a.bbox[1] : (a.aiPosition?.y || 0);
    const yB = b.bbox ? b.bbox[1] : (b.aiPosition?.y || 0);
    return yA - yB;
  });

  // Debug Log: Final Sorted Order for this Question




  // FIX FOR Q10: Unify "Split Block" status for grouped annotations
  // If a group of annotations (likely same line) has mixed hasLineData status,
  // force them all to hasLineData: false (TRUST_AI) to prevent visual jumping.

  // 1. Group by page and proximity (simple y-distance clustering)
  const UNIFY_THRESHOLD_Y = 50; // pixels (approx)

  // We can't easily know exact Y without image height, but we can group by sub-question or just sequence
  // For Q10, they are usually sequential.

  for (let i = 0; i < results.length; i++) {
    const current = results[i];
    if (!current) continue;

    // Look ahead for a "group" (sequential annotations for same sub-question or close proximity)
    let group = [current];
    let j = i + 1;

    while (j < results.length) {
      const next = results[j];
      // Break if different page or different sub-question (if present)
      if (next.pageIndex !== current.pageIndex) break;
      if (current.subQuestion && next.subQuestion && current.subQuestion !== next.subQuestion) break;

      // If no sub-question, check proximity (if we have bboxes)
      // But for split blocks, bboxes might be dummy [1,1,1,1].
      // Let's rely on the fact that Q10 split blocks are sequential.

      group.push(next);
      j++;
    }

    // Process the group
    if (group.length > 1) {
      // Check if ANY in group is "Split" (hasLineData === false)
      const hasSplit = group.some(a => a.hasLineData === false);

      if (hasSplit) {
        // Force ALL to be split (TRUST_AI)
        group.forEach(a => {
          if (a.hasLineData !== false) {
            // console.log(`[MARKING DEBUG] Unifying annotation to Split/AI-Position: ${a.text}`);
            a.hasLineData = false;
            // We keep the OCR bbox as fallback, but svgOverlayService will prefer aiPosition if available
            // If aiPosition is missing on this specific part (unlikely for split), it might fallback to OCR bbox
            // But setting hasLineData=false tells svgOverlay to TRY aiPosition or relative layout
          }
        });
      }
    }

    // Advance i
    i = j - 1;
  }

  return results;
};

export function createMarkingTasksFromClassification(
  classificationResult: any,
  allPagesOcrData: PageOcrResult[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>,
  standardizedPages: any[] // Assuming standardizedPages is passed here
): MarkingTask[] {
  const tasks: MarkingTask[] = [];

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
  }>();

  // First pass: Collect all questions, use FULL question number as grouping key (e.g., "3a", "3b" separately)
  // This ensures Q3a and Q3b are separate tasks with their own page indices
  for (const q of classificationResult.questions) {
    const mainQuestionNumber = q.questionNumber || null;
    const baseQNum = getBaseQuestionNumber(mainQuestionNumber);

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
        aiSegmentationResults: [] // Initialize array
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
      const block = {
        text: studentWorkText.trim(),
        pageIndex: sourceImageIndices[0] || 0,
        studentWorkLines: q.studentWorkLines || [], // Store lines with positions
        subQuestions: q.subQuestions, // Pass sub-questions to block for MarkingInstructionService
        hasStudentDrawing: q.hasStudentDrawing // Pass drawing flag
      };
      group.classificationBlocks.push(block as any);


      (group.aiSegmentationResults as any[]).push({
        content: block.text,
        studentWorkLines: q.studentWorkLines || []
      });
    }

    // Collect sub-questions
    if (q.subQuestions && Array.isArray(q.subQuestions)) {
      for (const subQ of q.subQuestions) {
        if ((subQ.studentWorkLines && subQ.studentWorkLines.length > 0) || (subQ.studentWork && subQ.studentWork.trim().length > 0)) {
          const studentWorkText = (subQ.studentWorkLines && subQ.studentWorkLines.length > 0)
            ? subQ.studentWorkLines.map(line => line.text).join('\n')
            : (subQ.studentWork || '');

          group.subQuestions.push({
            part: subQ.part || '',
            studentWork: studentWorkText,
            text: subQ.text,
            studentWorkLines: subQ.studentWorkLines || [] // Store lines with positions
          } as any);

          (group.aiSegmentationResults as any[]).push({
            content: studentWorkText,
            studentWorkLines: subQ.studentWorkLines || []
          });
        }
      }
    }
  }

  // Second pass: Create one task per main question (with all sub-questions grouped)
  for (const [baseQNum, group] of questionGroups.entries()) {
    // Deduplicate aiSegmentationResults based on content to prevent repeated student work in prompt
    // This fixes issues where the same text is attributed to multiple pages or question parts
    const uniqueContent = new Set<string>();
    group.aiSegmentationResults = group.aiSegmentationResults.filter(result => {
      const normalizedContent = result.content.trim();
      if (uniqueContent.has(normalizedContent)) {
        return false;
      }
      uniqueContent.add(normalizedContent);
      return true;
    });

    // Combine all main student work parts
    let combinedMainWork = group.mainStudentWorkParts.join('\n\n');

    // Skip if no student work at all (neither main nor sub-questions)
    // UNLESS we have a marking scheme - in that case, we should still create a task
    // so the AI can mark it (e.g., as 0 if blank, or maybe classification missed the work but image has it)
    const hasMainWork = combinedMainWork && combinedMainWork !== 'null' && combinedMainWork.trim() !== '';
    const hasSubWork = group.subQuestions.length > 0;
    const hasMarkingScheme = !!group.markingScheme;

    if (!hasMainWork && !hasSubWork && !hasMarkingScheme) {
      continue;
    }

    // If we have a scheme but no work, we proceed (AI will see the image)
    if (!hasMainWork && !hasSubWork && hasMarkingScheme) {
      // Add a placeholder so formatGroupedStudentWork doesn't return empty string
      combinedMainWork = "[No student work text detected by classification - please check image]";
    }

    // Get all OCR blocks from ALL pages this question spans (for multi-page questions like Q3a/Q3b)
    const allMathBlocks: MathBlock[] = [];
    group.sourceImageIndices.forEach((pageIndex) => {
      const pageOcrData = allPagesOcrData[pageIndex];
      if (pageOcrData?.ocrData?.mathBlocks) {
        pageOcrData.ocrData.mathBlocks.forEach((block: MathBlock, idx: number) => {
          // Ensure pageIndex is set on the block
          if (!(block as any).pageIndex) {
            (block as any).pageIndex = pageIndex;
          }
          // Assign global block ID if not present
          if (!(block as any).globalBlockId) {
            (block as any).globalBlockId = `block_${pageIndex}_${idx}`;
          }
          allMathBlocks.push(block);
        });
      }
    });

    // Format combined student work with sub-question labels
    const combinedStudentWork = formatGroupedStudentWork(
      combinedMainWork,
      group.subQuestions
    );

    // Extract sub-question numbers for metadata
    const subQuestionNumbers = group.subQuestions.map(sq => `${baseQNum}${sq.part}`);

    // Check if this question requires image for marking (edge case: Drawing Classification returned 0)
    const requiresImage = (group.mainQuestion as any)?.requiresImageForMarking === true;

    // Attach image data for marking (CRITICAL for vision-based marking)
    // For multi-page questions, we need to collect ALL images
    const questionImages: string[] = [];
    if (group.sourceImageIndices.length > 0) {
      group.sourceImageIndices.forEach(pageIdx => {
        if (standardizedPages[pageIdx] && standardizedPages[pageIdx].imageData) {
          questionImages.push(standardizedPages[pageIdx].imageData);
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
      subQuestionMetadata: {
        hasSubQuestions: group.subQuestions.length > 0,
        subQuestions: group.subQuestions.map(sq => ({
          part: sq.part,
          text: sq.text
        })),
        subQuestionNumbers: subQuestionNumbers.length > 0 ? subQuestionNumbers : undefined
      }
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

