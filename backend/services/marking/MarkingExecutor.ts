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
  pageDimensions?: Map<number, { width: number; height: number }>; // Map of pageIndex -> dimensions for accurate bbox estimation
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
}

export interface EnrichedAnnotation extends Annotation {
  bbox: [number, number, number, number];
  pageIndex: number;
}

/**
 * Executes the AI marking and feedback generation for a single question task.
 * Assumes OCR data is already prepared within the task.
 */
export async function executeMarkingForQuestion(
  task: MarkingTask,
  res: any, // Pass the Response object for SSE updates
  submissionId: string, // Pass submissionId for context in SSE
  model: ModelType = 'auto' // Pass the AI model to use for marking
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
    }>;
    
    if (task.aiSegmentationResults && task.aiSegmentationResults.length > 0) {
      // Use AI segmentation results - map back to original blocks for coordinates
      stepsDataForMapping = task.aiSegmentationResults.map((result, stepIndex) => {
        // Find the corresponding block by blockId
        const matchingBlock = task.mathBlocks.find(block => {
          const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
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
          
          if (position) {
            const pageIndex = matchingBlock ? ((matchingBlock as any).pageIndex ?? -1) : (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);
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
        }
        
        return {
          unified_step_id: `step_${stepIndex + 1}`, // Simplified format (matches AI prompt)
          pageIndex: matchingBlock ? ((matchingBlock as any).pageIndex ?? -1) : (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : -1),
          globalBlockId: result.blockId,
          text: result.content, // Use AI segmentation merged content
          cleanedText: result.content, // Use AI segmentation merged content
          bbox
        };
      });
    } else {
      // Enhanced marking mode: Use OCR blocks directly (no matching logic)
      // AI will handle mapping classification to OCR blocks
      // We just provide OCR block coordinates for annotation enrichment
      stepsDataForMapping = task.mathBlocks.map((block, stepIndex) => {
        const blockId = (block as any).globalBlockId || `${block.pageIndex}_${block.coordinates?.x}_${block.coordinates?.y}`;
        
        const rawText = block.mathpixLatex || block.googleVisionText || '';
        const normalizedText = normalizeLaTeXSingleLetter(rawText);
        
        const bbox: [number, number, number, number] = block.coordinates && 
          block.coordinates.x != null && block.coordinates.y != null &&
          block.coordinates.width != null && block.coordinates.height != null
          ? [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height]
          : [0, 0, 0, 0];
        
        // Get pageIndex from block, or fallback to task.sourcePages, or default to 0
        const blockPageIndex = (block as any).pageIndex;
        const validPageIndex = blockPageIndex != null && blockPageIndex >= 0 
          ? blockPageIndex 
          : (task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0);
        
        return {
          unified_step_id: `step_${stepIndex + 1}`, // Step ID based on OCR block order
          pageIndex: validPageIndex,
          globalBlockId: (block as any).globalBlockId || blockId,
          text: normalizedText, // OCR block text
          cleanedText: normalizedText, // OCR block text
          bbox // OCR block coordinates
        };
      });
    }
    
    // Log summary of blocks with/without coordinates
    const blocksWithCoords = stepsDataForMapping.filter(s => s.bbox[0] > 0 || s.bbox[1] > 0).length;
    const blocksWithoutCoords = stepsDataForMapping.length - blocksWithCoords;
    if (blocksWithoutCoords > 0) {
      console.warn(`[MARKING EXECUTOR] Q${questionId}: ${blocksWithoutCoords}/${stepsDataForMapping.length} blocks missing coordinates`);
    }

    // Handle [DRAWING] student work from classification (e.g., Q13a histogram, Q22a sine graph, Q11 coordinate grid)
    // If classification has [DRAWING] student work, create separate synthetic blocks for each drawing entry
    // This allows AI to return separate annotations for each drawing, which can be matched to individual blocks
    if (task.classificationStudentWork && task.classificationStudentWork.includes('[DRAWING]')) {
      // Check if drawing is already represented in existing blocks (unlikely but possible)
      const drawingAlreadyInBlocks = stepsDataForMapping.some(step => 
        step.text.includes('[DRAWING]') || step.cleanedText.includes('[DRAWING]')
      );
      
      if (!drawingAlreadyInBlocks) {
        // Use first page from sourcePages, or default to 0
        const pageIndex = task.sourcePages && task.sourcePages.length > 0 ? task.sourcePages[0] : 0;
        
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
                  if (!isNaN(xPercent) && !isNaN(yPercent) && xPercent >= 0 && xPercent <= 100 && yPercent >= 0 && yPercent <= 100) {
                    // Use percentage directly (no blending with interpolation)
                    // ALL positions from enhanced classification represent CENTER (consistent for all drawing types)
                    // Subtract half width/height to get the left/top edge position for bbox
                    const pixelXFromPercent = (pageWidth * xPercent / 100) - drawingWidth / 2;
                    const pixelYFromPercent = (pageHeight * yPercent / 100) - drawingHeight / 2;
                    
                    const finalX = Math.max(0, Math.min(pageWidth - drawingWidth, pixelXFromPercent));
                    const finalY = Math.max(0, Math.min(pageHeight - drawingHeight, pixelYFromPercent));
                    
                    return [finalX, finalY, drawingWidth, drawingHeight];
                  }
                }
                
                // Use pure interpolation if no percentage coordinates
                const finalX = Math.max(0, Math.min(pageWidth - drawingWidth, interpolatedX));
                const finalY = Math.max(0, Math.min(pageHeight - drawingHeight, interpolatedY));
                
                return [finalX, finalY, drawingWidth, drawingHeight];
              } else if (beforeBlock) {
                // Only before block available - place drawing slightly below it
                const beforeY = beforeBlock.bbox[1] || 0;
                const beforeX = beforeBlock.bbox[0] || 0;
                const estimatedY = beforeY + 50; // 50px below
                const estimatedX = beforeX;
                
                console.log(`[MARKING EXECUTOR] Order-based (before only): beforeY=${beforeY}, estimatedY=${estimatedY}`);
                return [Math.max(0, Math.min(pageWidth - drawingWidth, estimatedX)), Math.max(0, Math.min(pageHeight - drawingHeight, estimatedY)), drawingWidth, drawingHeight];
              } else if (afterBlock) {
                // Only after block available - place drawing slightly above it
                const afterY = afterBlock.bbox[1] || 0;
                const afterX = afterBlock.bbox[0] || 0;
                const estimatedY = afterY - 50; // 50px above
                const estimatedX = afterX;
                
                console.log(`[MARKING EXECUTOR] Order-based (after only): afterY=${afterY}, estimatedY=${estimatedY}`);
                return [Math.max(0, Math.min(pageWidth - drawingWidth, estimatedX)), Math.max(0, Math.min(pageHeight - drawingHeight, estimatedY)), drawingWidth, drawingHeight];
              }
            }
          }
          
          // STEP 2: Try to parse percentage-based position: [POSITION: x=XX%, y=YY%]
          // Support formats: "x=25%, y=30%" or "x=25%,y=30%" or "x = 25%, y = 30%"
          const percentMatch = position.match(/x\s*=\s*(\d+(?:\.\d+)?)%\s*,\s*y\s*=\s*(\d+(?:\.\d+)?)%/i);
          
          if (percentMatch) {
            // Parse percentages
            const xPercent = parseFloat(percentMatch[1]);
            const yPercent = parseFloat(percentMatch[2]);
            
            // Validate percentages (should be 0-100)
            if (isNaN(xPercent) || isNaN(yPercent) || xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) {
              console.warn(`[MARKING EXECUTOR] Invalid percentage values in position "${position}": x=${xPercent}%, y=${yPercent}%`);
            } else {
              // Convert percentages to pixel coordinates
              // ALL positions from enhanced classification represent CENTER (consistent for all drawing types)
              // Subtract half width/height to get the left/top edge position for bbox
              const centerX = pageWidth * xPercent / 100;
              const centerY = pageHeight * yPercent / 100;
              const pixelX = centerX - drawingWidth / 2;
              const pixelY = centerY - drawingHeight / 2;
              
              const finalX = Math.max(0, Math.min(pageWidth - drawingWidth, pixelX));
              const finalY = Math.max(0, Math.min(pageHeight - drawingHeight, pixelY));
              
              // Extract coordinates if available for validation
              const coordsMatch = drawingText.match(/\[COORDINATES:\s*([^\]]+)\]/);
              const coordsInfo = coordsMatch ? coordsMatch[1] : 'none';
              
              console.log(`[MARKING EXECUTOR] Drawing position calculation: "${drawingText.substring(0, 60)}..."`);
              console.log(`[MARKING EXECUTOR]   Page dimensions: ${pageWidth}x${pageHeight}, Drawing size: ${drawingWidth}x${drawingHeight}`);
              console.log(`[MARKING EXECUTOR]   AI Position: x=${xPercent}%, y=${yPercent}% → center: (${centerX.toFixed(1)}, ${centerY.toFixed(1)}) → bbox: [${finalX.toFixed(1)}, ${finalY.toFixed(1)}]`);
              console.log(`[MARKING EXECUTOR]   Coordinates: ${coordsInfo}`);
              
              return [finalX, finalY, drawingWidth, drawingHeight];
            }
          }
          
          // STEP 3: Fallback: backward compatibility with old format (center-left, center-right, etc.)
          // Generic fallback for any drawing type (coordinate grids, histograms, diagrams, etc.)
          // Find student work blocks to estimate where the drawing area is (Y position)
          const studentWorkBlocks = blocksOnSamePage.filter(block => {
            const text = (block.text || '').toLowerCase();
            // Exclude question text patterns (generic patterns that work for all question types)
            if (text.includes('triangle a is') || text.includes('triangle b is') || 
                text.includes('triangle c is') || text.includes('describe fully') ||
                text.includes('translated by the vector') || (text.includes('rotated') && text.includes('about the point')) ||
                text.includes('draw a') || text.includes('complete the') || text.includes('on the grid')) {
              return false; // This is question text, not student work
            }
            // Include student work patterns (generic patterns)
            return text.includes('rotated') || text.includes('clockwise') || text.includes('counterclockwise') ||
                   text.includes('translated') || text.includes('reflected') || 
                   text.length > 0;
          });
          
          // Calculate Y position: drawings are typically in the middle-upper portion of page
          // This works for coordinate grids, histograms, geometric diagrams, etc.
          let drawingAreaY: number;
          if (studentWorkBlocks.length > 0) {
            // Sort blocks by Y and pick one from upper-middle area
            const sortedBlocks = [...studentWorkBlocks].sort((a, b) => (a.bbox[1] || 0) - (b.bbox[1] || 0));
            const middleIndex = Math.floor(sortedBlocks.length * 0.3);
            const refBlock = sortedBlocks[Math.max(0, Math.min(middleIndex, sortedBlocks.length - 1))];
            const refY = refBlock.bbox[1] || 0;
            // Drawings are typically slightly above student work text
            drawingAreaY = Math.max(refY - 100, pageHeight * 0.20);
          } else {
            // Fallback: use page-based percentage (drawings are typically 25-35% from top)
            drawingAreaY = pageHeight * 0.30;
          }
          
          // Fallback: use old position hint format (center-left, center-right, etc.)
          // This works generically for all drawing types
          const positionLower = position.toLowerCase();
          
          let estimatedBbox: [number, number, number, number];
          
          if (positionLower.includes('center-left') || positionLower.includes('left')) {
            // Left side of page: use left portion (25-30% of page width)
            const leftX = Math.max(50, pageWidth * 0.25 - drawingWidth / 2);
            estimatedBbox = [leftX, drawingAreaY, drawingWidth, drawingHeight];
          } else if (positionLower.includes('center-right') || positionLower.includes('right')) {
            // Right side of page: use right portion (70-75% of page width)
            const rightX = Math.min(pageWidth - drawingWidth - 50, pageWidth * 0.75 - drawingWidth / 2);
            estimatedBbox = [rightX, drawingAreaY, drawingWidth, drawingHeight];
          } else if (positionLower.includes('center')) {
            // Center of page: use center (50% of page width)
            const centerX = Math.max(50, Math.min(pageWidth - drawingWidth - 50, pageWidth / 2 - drawingWidth / 2));
            estimatedBbox = [centerX, drawingAreaY, drawingWidth, drawingHeight];
          } else {
            // Default: center
            const centerX = Math.max(50, Math.min(pageWidth - drawingWidth - 50, pageWidth / 2 - drawingWidth / 2));
            estimatedBbox = [centerX, drawingAreaY, drawingWidth, drawingHeight];
          }
          
          return estimatedBbox;
        };
        
        const blocksOnSamePage = stepsDataForMapping.filter(s => s.pageIndex === pageIndex);
        let drawingIndex = 0;
        
        // Match classification entries to OCR blocks by order to find drawing position in sequence
        // This allows order-based interpolation for more accurate drawing positions
        // Classification entries: ["text1", "[DRAWING] ...", "text2"]
        // OCR blocks: [block1, block2] (in MathPix reading order, preserved for null Y coordinates)
        // Strategy: Count text entries before drawing to estimate position in OCR block sequence
        const findDrawingIndexInSequence = (drawingEntryIndex: number): number => {
          let textEntriesBefore = 0;
          for (let j = 0; j < drawingEntryIndex; j++) {
            if (!entries[j].includes('[DRAWING]')) {
              textEntriesBefore++;
            }
          }
          // Estimate: drawing appears after textEntriesBefore OCR blocks
          // Clamp to valid range
          return Math.min(textEntriesBefore, Math.max(0, blocksOnSamePage.length - 1));
        };
        
        // Create separate synthetic blocks for each [DRAWING] entry
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
          const entry = entries[entryIndex];
          if (entry.includes('[DRAWING]')) {
            // Extract position hint from this specific drawing entry
            const positionMatch = entry.match(/\[POSITION:\s*([^\]]+)\]/);
            const position = positionMatch ? positionMatch[1] : 'center';
            
            // Find drawing position in sequence for order-based interpolation
            const drawingIndexInSequence = findDrawingIndexInSequence(entryIndex);
            
            // Estimate bbox for drawing using order-based interpolation
            // Pass drawingIndexInSequence to enable order-based position estimation
            const estimatedBbox = estimateBboxForDrawing(position, blocksOnSamePage, pageIndex, entry, drawingIndexInSequence);
            
            // CRITICAL: Do NOT override percentage-based positions with stacking
            // If we have percentage-based positions (x=XX%, y=YY%), use them exactly as provided by AI
            // Only apply stacking for fallback positions (old format: center-left, center-right, etc.)
            const hasPercentagePosition = /x\s*=\s*\d+(?:\.\d+)?%\s*,\s*y\s*=\s*\d+(?:\.\d+)?%/i.test(position);
            
            if (!hasPercentagePosition && drawingIndex > 0) {
              // Only stack if using fallback positions (old format)
              // Stack subsequent drawings below previous ones
              const previousDrawingBlock = stepsDataForMapping.find(s => 
                s.text.includes('[DRAWING]') && s.pageIndex === pageIndex
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
              pageIndex: pageIndex,
              globalBlockId: `drawing_${questionId}_${drawingStepIndex}`,
              text: entry, // Only this drawing entry, not the full combined text
              cleanedText: entry,
              bbox: estimatedBbox as [number, number, number, number]
            };
            
            stepsDataForMapping.push(drawingBlock);
            blocksOnSamePage.push(drawingBlock); // Update for next drawing's position calculation
            
            drawingIndex++;
          }
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
      return {
        id: blockId,
        text: block.mathpixLatex || block.googleVisionText || '',
        pageIndex: block.pageIndex ?? task.sourcePages[0] ?? 0,
        coordinates: block.coordinates ? {
          x: block.coordinates.x,
          y: block.coordinates.y
        } : undefined
      };
    });
    
    // Add synthetic drawing blocks to rawOcrBlocks if classification has [DRAWING] entries
    // This ensures the AI can find drawing blocks in the prompt (they have IDs like "drawing_Q22a_1")
    if (task.classificationStudentWork && task.classificationStudentWork.includes('[DRAWING]')) {
      // Find drawing blocks that were added to stepsDataForMapping
      const drawingBlocks = stepsDataForMapping.filter(step => 
        step.text.includes('[DRAWING]') || step.cleanedText.includes('[DRAWING]')
      );
      
      // Add each drawing block to rawOcrBlocks
      drawingBlocks.forEach((drawingBlock) => {
        // Extract position from drawing text for coordinates
        const positionMatch = drawingBlock.text.match(/\[POSITION:\s*x\s*=\s*(\d+(?:\.\d+)?)%\s*,\s*y\s*=\s*(\d+(?:\.\d+)?)%/i);
        let coordinates: { x: number; y: number } | undefined = undefined;
        
        if (positionMatch && drawingBlock.bbox) {
          // Use bbox center as coordinates (bbox is [x, y, width, height])
          coordinates = {
            x: drawingBlock.bbox[0] + drawingBlock.bbox[2] / 2,
            y: drawingBlock.bbox[1] + drawingBlock.bbox[3] / 2
          };
        } else if (drawingBlock.bbox) {
          // Fallback: use bbox center
          coordinates = {
            x: drawingBlock.bbox[0] + drawingBlock.bbox[2] / 2,
            y: drawingBlock.bbox[1] + drawingBlock.bbox[3] / 2
          };
        }
        
        rawOcrBlocks.push({
          id: drawingBlock.globalBlockId || `drawing_${questionId}_${rawOcrBlocks.length}`,
          text: drawingBlock.text,
          pageIndex: drawingBlock.pageIndex,
          coordinates: coordinates
        });
      });
    }
    
    // Call Marking Instruction Service (Pass Raw OCR Blocks + Classification for Enhanced Marking)
    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));
    
    const markingResult = await MarkingInstructionService.executeMarking({
      imageData: '', // Not needed for text-based marking
      model: model, // Use the passed model instead of hardcoded 'auto'
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
        // Pass sub-question metadata for grouped sub-questions
        subQuestionMetadata: task.subQuestionMetadata
      } as any, // Type assertion for mock object
      questionDetection: task.markingScheme, // Pass the marking scheme directly (don't use questionDetection if it exists, as it may be wrong for merged schemes)
      questionText: questionText, // Pass question text from fullExamPapers to AI prompt
      questionNumber: String(questionId) // Pass question number (may include sub-question part like "17a", "17b")
    });
    
    sendSseUpdate(res, createProgressData(6, `Annotations generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    // Basic validation of marking result
    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
       throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // 4. Skip feedback generation - removed as requested

    // 5. Enrich Annotations
    const enrichedAnnotations = (markingResult.annotations || []).map((anno, annoIndex) => {
        
        // ================== START OF FIX ==================
        // Trim both IDs to protect against hidden whitespace
        const aiStepId = (anno as any).step_id?.trim(); 
        if (!aiStepId) {
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
          if (originalStep) {
            console.log(`[MARKING EXECUTOR] Q${questionId}: ✅ Matched OCR block ID "${aiStepId}" to step "${originalStep.unified_step_id}"`);
          }
        }
        
        // Special handling for [DRAWING] annotations
        // Since we now create separate synthetic blocks for each drawing, match by text content
        // AI might return step_id like "DRAWING_Triangle B..." instead of unified_step_id
        if (!originalStep) {
          const annotationText = ((anno as any).textMatch || (anno as any).text || '').toLowerCase();
          const isDrawingAnnotation = annotationText.includes('[drawing]') || aiStepId.toLowerCase().includes('drawing');
          
          if (isDrawingAnnotation) {
            // First, try to match by step_id if it contains a step number
            const stepNumMatch = aiStepId.match(/step[_\s]*(\d+)/i);
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
        
        if (!originalStep) {
             return null; // Mark for filtering
        }

        // Check if bbox is valid (not all zeros)
        const hasValidBbox = originalStep.bbox && (originalStep.bbox[0] > 0 || originalStep.bbox[1] > 0);

        const enriched = {
            ...anno,
            bbox: (originalStep.bbox || [0, 0, 0, 0]) as [number, number, number, number],
            pageIndex: originalStep.pageIndex ?? -1,
            unified_step_id: originalStep.unified_step_id // Store unified_step_id for tracking
        };
        
        return enriched;
    }).filter((anno) => {
        if (anno === null) {
          return false;
        }
        if (anno.pageIndex === -1) {
          return false;
        }
        if (!anno.bbox || anno.bbox.length !== 4) {
          return false;
        }
        // Also filter out bboxes that are all zeros (no coordinates)
        if (anno.bbox[0] === 0 && anno.bbox[1] === 0 && anno.bbox[2] === 0 && anno.bbox[3] === 0) {
          return false;
        }
        return true;
    }); // Filter out nulls, invalid pageIndex, and invalid bbox
    
    console.log(`[MARKING EXECUTOR] Q${questionId}: Enriched ${enrichedAnnotations.length} annotations (from ${markingResult.annotations?.length || 0} original)`);

    // 6. Consolidate results for this question
    const score = markingResult.studentScore;

    sendSseUpdate(res, createProgressData(6, `Marking complete for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    // Count mathpix calls (1 call per image, not per math block)
    // Mathpix processes the entire image once and returns multiple math blocks
    const mathpixCalls = task.mathBlocks.length > 0 ? 1 : 0;

    const result = {
      questionNumber: questionId,
      score,
      annotations: enrichedAnnotations,
      usageTokens: markingResult.usage?.llmTokens || 0,
      confidence: 0.9, // Use confidence from processedImage (0.9 as set in the mock object)
      mathpixCalls
    };
    
    return result;


  } catch (error) {
    console.error(`❌ [MARKING EXECUTION] Error during marking for Question ${questionId}:`, error);
    sendSseUpdate(res, createProgressData(6, `Error marking Question ${questionId}: ${error instanceof Error ? error.message : 'Unknown error'}`, MULTI_IMAGE_STEPS));
    // Re-throw the error so Promise.all catches it
    throw error;
  }
}

/**
 * Create marking tasks directly from classification results (bypasses segmentation)
 * This function creates tasks with raw OCR blocks and classification student work
 * for the enhanced marking instruction approach.
 */
export function createMarkingTasksFromClassification(
  classificationResult: any,
  allPagesOcrData: PageOcrResult[],
  markingSchemesMap: Map<string, any>,
  pageDimensionsMap: Map<number, { width: number; height: number }>
): MarkingTask[] {
  const tasks: MarkingTask[] = [];
  
  if (!classificationResult?.questions || !Array.isArray(classificationResult.questions)) {
    return tasks;
  }
  
  // Group questions by base question number
  const questionGroups = new Map<string, {
    mainQuestion: any;
    subQuestions: Array<{ part: string; studentWork: string; text?: string }>;
    markingScheme: any;
    baseQNum: string;
    sourceImageIndices: number[]; // Array of page indices (for multi-page questions)
  }>();
  
  // First pass: Collect all questions and sub-questions, group by base question number
  for (const q of classificationResult.questions) {
    const mainQuestionNumber = q.questionNumber || null;
    const baseQNum = getBaseQuestionNumber(mainQuestionNumber);
    
    // Use sourceImageIndices if available (from merged questions), otherwise use sourceImageIndex as array
    const sourceImageIndices = q.sourceImageIndices && Array.isArray(q.sourceImageIndices) && q.sourceImageIndices.length > 0
      ? q.sourceImageIndices
      : [q.sourceImageIndex ?? 0];
    
    // For non-past papers, questionNumber might be null - use a placeholder or skip grouping
    // If no baseQNum, we can't group, but we can still create a task if there's student work
    if (!baseQNum) {
      // For non-past papers without question numbers, use a placeholder
      // Check if there's student work - if yes, create a task with null markingScheme
      const hasMainWork = q.studentWork && q.studentWork !== 'null' && q.studentWork.trim() !== '';
      const hasSubWork = q.subQuestions && q.subQuestions.some((sq: any) => sq.studentWork && sq.studentWork !== 'null' && sq.studentWork.trim() !== '');
      
      if (hasMainWork || hasSubWork) {
        // Create a task directly without grouping (for non-past papers)
        // We'll handle this after the grouping loop
      }
      continue; // Skip grouping for questions without baseQNum
    }
    
    // Find marking scheme (same for all sub-questions in a group)
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
    
    // Initialize group if not exists
    if (!questionGroups.has(baseQNum)) {
      questionGroups.set(baseQNum, {
        mainQuestion: q,
        subQuestions: [],
        markingScheme: markingScheme,
        baseQNum: baseQNum,
        sourceImageIndices: sourceImageIndices
      });
    } else {
      // If group exists, merge page indices (in case sub-questions are on different pages)
      const existingGroup = questionGroups.get(baseQNum)!;
      const mergedIndices = [...new Set([...existingGroup.sourceImageIndices, ...sourceImageIndices])].sort((a, b) => a - b);
      existingGroup.sourceImageIndices = mergedIndices;
    }
    
    const group = questionGroups.get(baseQNum)!;
    
    // Collect sub-questions
    if (q.subQuestions && Array.isArray(q.subQuestions)) {
      for (const subQ of q.subQuestions) {
        if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim() !== '') {
          group.subQuestions.push({
            part: subQ.part || '',
            studentWork: subQ.studentWork,
            text: subQ.text
          });
        }
      }
    }
  }
  
  // Second pass: Create one task per main question (with all sub-questions grouped)
  for (const [baseQNum, group] of questionGroups.entries()) {
    // Skip if no student work at all (neither main nor sub-questions)
    const hasMainWork = group.mainQuestion.studentWork && 
                        group.mainQuestion.studentWork !== 'null' && 
                        group.mainQuestion.studentWork.trim() !== '';
    const hasSubWork = group.subQuestions.length > 0;
    
    if (!hasMainWork && !hasSubWork) {
      continue;
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
      hasMainWork ? group.mainQuestion.studentWork : null,
      group.subQuestions
    );
    
    // Extract sub-question numbers for metadata
    const subQuestionNumbers = group.subQuestions.map(sq => `${baseQNum}${sq.part}`);
    
    // Create task with grouped sub-questions
    tasks.push({
      questionNumber: baseQNum, // Use base question number (e.g., "22")
      mathBlocks: allMathBlocks,
      markingScheme: group.markingScheme,
      sourcePages: group.sourceImageIndices,
      classificationStudentWork: combinedStudentWork,
      pageDimensions: pageDimensionsMap,
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
  // This ensures Q1, Q2, ..., Q18, ... are processed in numerical order
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
