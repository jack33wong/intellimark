/**
 * Marking Executor Service
 * Executes AI marking and feedback generation for a single question task
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { MarkingInstructions, Annotation } from '../../types/index.js';
import type { MathBlock } from '../ocr/MathDetectionService.js';

// Types for the marking executor
export interface MarkingTask {
  questionNumber: number | string;
  mathBlocks: MathBlock[];
  markingScheme: any;
  sourcePages: number[];
  classificationStudentWork?: string | null; // Student work extracted by classification (may include [DRAWING])
  pageDimensions?: Map<number, { width: number; height: number }>; // Map of pageIndex -> dimensions for accurate bbox estimation
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
  submissionId: string // Pass submissionId for context in SSE
): Promise<QuestionResult> {

  const questionId = task.questionNumber;
  
  // Import createProgressData function
  const { createProgressData } = await import('../../utils/sseUtils.js');
  const MULTI_IMAGE_STEPS = ["Input Validation", "Standardization", "Preprocessing", "OCR & Classification", "Question Detection", "Segmentation", "Marking", "Output Generation"];
  
  sendSseUpdate(res, createProgressData(6, `Marking Question ${questionId}...`, MULTI_IMAGE_STEPS));

  try {
    // Debug: Check if block "F" is in task.mathBlocks for Q12
    const isQ12ForDebug = questionId === '12_Pearson Edexcel_1MA1/1H' || questionId === '12';
    if (isQ12ForDebug) {
      console.log(`[Q12 "F" TRACE] MarkingExecutor received ${task.mathBlocks.length} blocks for Q12`);
      const blockF = task.mathBlocks.find(b => {
        const text = (b.mathpixLatex || b.googleVisionText || '').trim();
        const normalized = text.replace(/^\\?\(?\s*\$?\s*F\s*\$?\s*\\?\)?$/, 'F').trim();
        return normalized === 'F' || (text.includes('F') && text.length <= 10);
      });
      if (blockF) {
        const text = (blockF.mathpixLatex || blockF.googleVisionText || '').trim();
        console.log(`[Q12 "F" TRACE] ✅ Block "F" IS in task.mathBlocks (text: "${text}")`);
      } else {
        console.warn(`[Q12 "F" TRACE] ❌ Block "F" NOT in task.mathBlocks (total: ${task.mathBlocks.length} blocks)`);
        const blockTexts = task.mathBlocks.map(b => `"${(b.mathpixLatex || b.googleVisionText || '').trim()}"`).join(', ');
        console.warn(`[Q12 "F" TRACE] Block texts: [${blockTexts}]`);
      }
    }
    
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
    let stepsDataForMapping = task.mathBlocks.map((block, stepIndex) => {
      const rawText = block.mathpixLatex || block.googleVisionText || '';
      const normalizedText = normalizeLaTeXSingleLetter(rawText);
      
      return {
      unified_step_id: `q${questionId}_step_${stepIndex + 1}`, // Q-specific ID (or use globalBlockId if available)
      pageIndex: (block as any).pageIndex,         // Ensure pageIndex is passed
      globalBlockId: (block as any).globalBlockId, // Ensure globalBlockId is passed
        text: normalizedText, // Use normalized text (LaTeX-wrapped single letters normalized)
        cleanedText: normalizedText, // Use normalized text
      bbox: [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height]
      };
    });
    
    // Debug: Check if block "F" is in stepsDataForMapping for Q12
    if (isQ12ForDebug) {
      const stepF = stepsDataForMapping.find(s => {
        const text = (s.text || s.cleanedText || '').trim();
        const normalized = text.replace(/^\\?\(?\s*\$?\s*F\s*\$?\s*\\?\)?$/, 'F').trim();
        return normalized === 'F' || (text.includes('F') && text.length <= 10);
      });
      if (stepF) {
        console.log(`[Q12 "F" TRACE] ✅ Block "F" IS in stepsDataForMapping (step_id: ${stepF.unified_step_id}, text: "${stepF.text}")`);
      } else {
        console.warn(`[Q12 "F" TRACE] ❌ Block "F" NOT in stepsDataForMapping (total: ${stepsDataForMapping.length} steps)`);
        const stepTexts = stepsDataForMapping.map(s => `"${(s.text || s.cleanedText || '').trim()}"`).join(', ');
        console.warn(`[Q12 "F" TRACE] Step texts: [${stepTexts}]`);
      }
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
          
          // Drawing dimensions (generic default - works for triangles, histograms, diagrams, etc.)
          // For coordinate grids: typically 300x300 for triangles
          // For histograms: might be wider (400-500px), but 300x300 is a reasonable default
          // For geometric diagrams: similar to coordinate grids
          const drawingWidth = 300;
          const drawingHeight = 300;
          
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
                    // xPercent and yPercent represent the CENTER position of the drawing (per updated prompt specification)
                    // Subtract half width/height to get the left/top edge position for bbox
                    const pixelXFromPercent = (pageWidth * xPercent / 100) - drawingWidth / 2;
                    const pixelYFromPercent = (pageHeight * yPercent / 100) - drawingHeight / 2;
                    const finalX = Math.max(0, Math.min(pageWidth - drawingWidth, pixelXFromPercent));
                    const finalY = Math.max(0, Math.min(pageHeight - drawingHeight, pixelYFromPercent));
                    
                    console.log(`[MARKING EXECUTOR] Order-based interpolation + percentage: beforeY=${beforeY}, afterY=${afterY}, interpolatedY=${interpolatedY}, finalY=${finalY}, xPercent=${xPercent}%, yPercent=${yPercent}% (using percentage directly, no blending)`);
                    return [finalX, finalY, drawingWidth, drawingHeight];
                  }
                }
                
                // Use pure interpolation if no percentage coordinates
                const finalX = Math.max(0, Math.min(pageWidth - drawingWidth, interpolatedX));
                const finalY = Math.max(0, Math.min(pageHeight - drawingHeight, interpolatedY));
                
                console.log(`[MARKING EXECUTOR] Order-based interpolation: beforeY=${beforeY}, afterY=${afterY}, interpolatedY=${interpolatedY}, finalY=${finalY}`);
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
              // x and y percentages represent the CENTER position of the drawing (per updated prompt specification)
              // Subtract half width/height to get the left/top edge position for bbox
              const pixelX = Math.max(0, Math.min(pageWidth - drawingWidth, (pageWidth * xPercent / 100) - drawingWidth / 2));
              const pixelY = Math.max(0, Math.min(pageHeight - drawingHeight, (pageHeight * yPercent / 100) - drawingHeight / 2));
              
              console.log(`[MARKING EXECUTOR] Parsed percentage position: "${position}" → x=${xPercent}%, y=${yPercent}% → pixels: [${pixelX}, ${pixelY}]`);
              
              return [pixelX, pixelY, drawingWidth, drawingHeight];
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
                console.log(`[MARKING EXECUTOR] [DRAWING] Using stacking for fallback position: adjusted Y from ${estimatedBbox[1] - prevHeight - 50} to ${estimatedBbox[1]}`);
              }
            } else if (hasPercentagePosition) {
              console.log(`[MARKING EXECUTOR] [DRAWING] Using percentage-based position (no stacking): "${position}"`);
            }
            
            // Create synthetic block for this individual drawing
            const drawingBlock = {
              unified_step_id: `q${questionId}_step_${stepsDataForMapping.length + 1}`,
              pageIndex: pageIndex,
              globalBlockId: `drawing_${questionId}_${stepsDataForMapping.length + 1}`,
              text: entry, // Only this drawing entry, not the full combined text
              cleanedText: entry,
              bbox: estimatedBbox as [number, number, number, number]
            };
            
            stepsDataForMapping.push(drawingBlock);
            blocksOnSamePage.push(drawingBlock); // Update for next drawing's position calculation
            
            console.log(`[MARKING EXECUTOR] Added synthetic block for [DRAWING]: ${entry.substring(0, 50)}...`);
            console.log(`[MARKING EXECUTOR] [DRAWING] Position hint: "${position}", Estimated bbox: [${estimatedBbox.join(', ')}], Page: ${pageIndex}`);
            
            drawingIndex++;
          }
        }
      }
    }

    // 2. Prepare OCR Text as PLAIN TEXT for the AI Prompt
    let ocrTextForPrompt = "Student's Work:\n";
    stepsDataForMapping.forEach((step, index) => {
      // Use full unified_step_id format for robustness
      ocrTextForPrompt += `${index + 1}. [${step.unified_step_id}] ${step.cleanedText}\n`;
    });
    
    // Debug: Log full AI prompt for Q12
    if (isQ12ForDebug) {
      console.log(`[Q12 "F" TRACE] Full AI prompt (${stepsDataForMapping.length} steps):`);
      console.log(ocrTextForPrompt);
    }
    // ========================== END OF FIX ==========================

    // *** Log for Verification ***

    // Extract question text from marking scheme (from fullExamPapers - source for question detection)
    const questionText = task.markingScheme?.questionText || task.markingScheme?.databaseQuestionText || null;
    
    // Q13: Track if question text (with frequency data) is passed to AI
    const isQ13 = questionId === '13_Pearson Edexcel_1MA1/1H' || questionId === '13';
    const hasDrawing = task.classificationStudentWork?.includes('[DRAWING]');
    if (isQ13) {
      const drawingBlocks = stepsDataForMapping.filter(step => step.text.includes('[DRAWING]'));
      console.log(`[Q13 PROBLEM TRACKING] Classification has [DRAWING]: ${hasDrawing ? 'YES' : 'NO'}`);
      console.log(`[Q13 PROBLEM TRACKING] Classification student work: "${task.classificationStudentWork?.substring(0, 150) || 'null'}"`);
      console.log(`[Q13 PROBLEM TRACKING] Synthetic drawing blocks created: ${drawingBlocks.length}`);
      if (hasDrawing && drawingBlocks.length === 0) {
        console.log(`[Q13 PROBLEM TRACKING] ❌ Classification has [DRAWING] but no synthetic blocks created`);
      }
      console.log(`[Q13 PROBLEM TRACKING] Histogram detected, Question text available: ${questionText ? 'YES' : 'NO'}`);
      if (questionText) {
        console.log(`[Q13 PROBLEM TRACKING] ✅ Question text will be passed to AI (length: ${questionText.length} chars)`);
      } else {
        console.log(`[Q13 PROBLEM TRACKING] ⚠️ Question text not available - AI may complain about missing frequency data`);
      }
    }
    
    // Call Marking Instruction Service (Pass Plain Text + Question Text)
    sendSseUpdate(res, createProgressData(6, `Generating annotations for Question ${questionId}...`, MULTI_IMAGE_STEPS));
    
    const markingResult = await MarkingInstructionService.executeMarking({
      imageData: '', // Not needed for text-based marking
      model: 'auto',
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
        unifiedLookupTable: {}
      } as any, // Type assertion for mock object
      questionDetection: task.markingScheme, // Pass the marking scheme directly (don't use questionDetection if it exists, as it may be wrong for merged schemes)
      questionText: questionText // Pass question text from fullExamPapers to AI prompt
    });
    
    
    sendSseUpdate(res, createProgressData(6, `Annotations generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    // Basic validation of marking result
    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
       throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // 4. Skip feedback generation - removed as requested

    // 5. Enrich Annotations
    
    // Log available step IDs for debugging
    if (questionId === '10_Pearson Edexcel_1MA1/1H' || questionId === '10') {
      console.log(`[Q10 DEBUG] Available unified_step_ids: ${stepsDataForMapping.map(s => s.unified_step_id).join(', ')}`);
      console.log(`[Q10 DEBUG] AI returned ${markingResult.annotations?.length || 0} annotations`);
      markingResult.annotations?.forEach((anno: any, idx: number) => {
        console.log(`[Q10 DEBUG] Annotation ${idx + 1}: step_id="${(anno as any).step_id}", textMatch="${(anno as any).textMatch?.substring(0, 30)}"`);
      });
    }
    
    const enrichedAnnotations = (markingResult.annotations || []).map((anno, annoIndex) => {
        
        // ================== START OF FIX ==================
        // Trim both IDs to protect against hidden whitespace
        const aiStepId = (anno as any).step_id?.trim(); 
        if (!aiStepId) {
             console.warn(`[ENRICHMENT] AI annotation has missing or empty step_id:`, anno);
             return null;
        }

        // Try exact match first
        let originalStep = stepsDataForMapping.find(step => 
            step.unified_step_id?.trim() === aiStepId
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
              console.log(`[ENRICHMENT] Matched step_id "${aiStepId}" to step ${stepNum} using flexible matching`);
            }
          }
        }
        
        // Special handling for [DRAWING] annotations
        // Since we now create separate synthetic blocks for each drawing, match by text content
        // AI might return step_id like "DRAWING_Triangle B..." instead of unified_step_id
        if (!originalStep) {
          const annotationText = ((anno as any).textMatch || (anno as any).text || '').toLowerCase();
          const isDrawingAnnotation = annotationText.includes('[drawing]') || aiStepId.toLowerCase().includes('drawing');
          
          if (isDrawingAnnotation) {
            console.log(`[ENRICHMENT] [DRAWING] Attempting to match annotation: step_id="${aiStepId}", text="${annotationText.substring(0, 100)}"`);
            
            // First, try to match by step_id if it contains a step number
            const stepNumMatch = aiStepId.match(/step[_\s]*(\d+)/i);
            if (stepNumMatch && stepNumMatch[1]) {
              const stepNum = parseInt(stepNumMatch[1], 10);
              if (stepNum > 0 && stepNum <= stepsDataForMapping.length) {
                const candidateStep = stepsDataForMapping[stepNum - 1];
                if (candidateStep && (candidateStep.text || candidateStep.cleanedText || '').toLowerCase().includes('[drawing]')) {
                  originalStep = candidateStep;
                  console.log(`[ENRICHMENT] [DRAWING] Matched by step number: step_id="${aiStepId}" → step ${stepNum} (${originalStep.unified_step_id})`);
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
              
              if (originalStep) {
                console.log(`[ENRICHMENT] [DRAWING] Matched by text content: step_id="${aiStepId}" → ${originalStep.unified_step_id}`);
              } else {
                console.warn(`[ENRICHMENT] [DRAWING] Could not match annotation: step_id="${aiStepId}", text="${annotationText.substring(0, 100)}"`);
                console.warn(`[ENRICHMENT] [DRAWING] Available drawing blocks: ${stepsDataForMapping.filter(s => (s.text || s.cleanedText || '').toLowerCase().includes('[drawing]')).map(s => `${s.unified_step_id}: "${(s.text || s.cleanedText || '').substring(0, 50)}"`).join(', ')}`);
              }
            }
          }
        }
        
        if (!originalStep) {
             console.warn(`[ENRICHMENT] Could not find original step for step_id: ${aiStepId} (available: ${stepsDataForMapping.map(s => s.unified_step_id).join(', ')})`);
             return null; // Mark for filtering
        }

        const enriched = {
            ...anno,
            bbox: (originalStep.bbox || [0, 0, 0, 0]) as [number, number, number, number],
            pageIndex: originalStep.pageIndex ?? -1,
            unified_step_id: originalStep.unified_step_id // Store unified_step_id for tracking
        };
        
        // Diagnostic logging for Q10 (all annotations)
        if (questionId === '10_Pearson Edexcel_1MA1/1H' || questionId === '10') {
          console.log(`[Q10 DEBUG] Annotation ${annoIndex + 1} enrichment: step_id="${aiStepId}", pageIndex=${enriched.pageIndex}, bbox=${JSON.stringify(enriched.bbox)}`);
        }
        
        return enriched;
    }).filter((anno, filterIndex) => {
        const isQ10 = questionId === '10_Pearson Edexcel_1MA1/1H' || questionId === '10';
        
        if (anno === null) {
          if (isQ10) {
            console.log(`[Q10 DEBUG] Filtered out annotation ${filterIndex + 1}: null`);
          }
          return false;
        }
        if (anno.pageIndex === -1) {
          if (isQ10) {
            console.log(`[Q10 DEBUG] Filtered out annotation ${filterIndex + 1}: pageIndex=-1`);
          }
          return false;
        }
        if (!anno.bbox || anno.bbox.length !== 4) {
          if (isQ10) {
            console.log(`[Q10 DEBUG] Filtered out annotation ${filterIndex + 1}: invalid bbox=${JSON.stringify(anno.bbox)}`);
          }
          return false;
        }
        if (isQ10) {
          console.log(`[Q10 DEBUG] Annotation ${filterIndex + 1} passed filter: pageIndex=${anno.pageIndex}, bbox=${JSON.stringify(anno.bbox)}`);
        }
        return true;
    }); // Filter out nulls, invalid pageIndex, and invalid bbox

    // 6. Check which blocks have annotations vs which don't (for debugging)
    // Track all reported problems: Q10, Q11, Q12, Q14
    const isQ10 = questionId === '10_Pearson Edexcel_1MA1/1H' || questionId === '10';
    const isQ11 = questionId === '11_Pearson Edexcel_1MA1/1H' || questionId === '11';
    const isQ12 = String(questionId).includes('12');
    const isQ14 = questionId === '14_Pearson Edexcel_1MA1/1H' || questionId === '14';
    
    // Q10: Track missing annotations (should be 7 blocks total, first 2 are missing)
    if (isQ10) {
      const classificationLines = task.classificationStudentWork?.split(/\n|\\newline|\\\\/).filter(l => l.trim()).length || 0;
      console.log(`[Q10 PROBLEM TRACKING] Classification student work: ${classificationLines} line(s), Blocks passed to AI: ${stepsDataForMapping.length}`);
      if (classificationLines > stepsDataForMapping.length) {
        console.log(`[Q10 PROBLEM TRACKING] ❌ Missing ${classificationLines - stepsDataForMapping.length} block(s) (expected ${classificationLines}, got ${stepsDataForMapping.length})`);
      }
      // Use unified_step_id from enriched annotations (if available) or fall back to step_id with flexible matching
      const annotatedStepIds = new Set(enrichedAnnotations.map(a => {
        const unifiedId = (a as any).unified_step_id?.trim();
        if (unifiedId) return unifiedId;
        const stepId = (a as any).step_id?.trim();
        if (stepId) {
          const stepNumMatch = stepId.match(/step[_\s]*(\d+)/i);
          if (stepNumMatch && stepNumMatch[1]) {
            const stepNum = parseInt(stepNumMatch[1], 10);
            if (stepNum > 0 && stepNum <= stepsDataForMapping.length) {
              return stepsDataForMapping[stepNum - 1].unified_step_id?.trim();
            }
          }
        }
        return null;
      }).filter(Boolean));
      const blocksWithoutAnnotations = stepsDataForMapping.filter(step => 
        !annotatedStepIds.has(step.unified_step_id?.trim())
      );
      if (blocksWithoutAnnotations.length > 0) {
        console.log(`[Q10 PROBLEM TRACKING] ❌ ${blocksWithoutAnnotations.length} block(s) without annotations: ${blocksWithoutAnnotations.map(s => s.unified_step_id).join(', ')}`);
        blocksWithoutAnnotations.forEach(step => {
          console.log(`[Q10 PROBLEM TRACKING] Missing annotation for block ${step.unified_step_id}: text="${step.text.substring(0, 50)}..."`);
        });
      } else {
        console.log(`[Q10 PROBLEM TRACKING] ✅ All ${stepsDataForMapping.length} blocks have annotations`);
      }
    }
    
    // Q11: Track drawing annotation
    if (isQ11) {
      const hasDrawing = task.classificationStudentWork?.includes('[DRAWING]');
      const drawingAnnotations = enrichedAnnotations.filter(a => 
        (a as any).textMatch?.includes('[DRAWING]') || (a as any).text?.includes('[DRAWING]')
      );
      console.log(`[Q11 PROBLEM TRACKING] Classification has [DRAWING]: ${hasDrawing ? 'YES' : 'NO'}`);
      console.log(`[Q11 PROBLEM TRACKING] Classification student work: "${task.classificationStudentWork?.substring(0, 100) || 'null'}"`);
      console.log(`[Q11 PROBLEM TRACKING] Total blocks: ${stepsDataForMapping.length}, Annotations: ${enrichedAnnotations.length}, Drawing annotations: ${drawingAnnotations.length}`);
      if (hasDrawing && drawingAnnotations.length === 0) {
        console.log(`[Q11 PROBLEM TRACKING] ❌ Drawing detected but no annotation created`);
      } else if (hasDrawing && drawingAnnotations.length > 0) {
        console.log(`[Q11 PROBLEM TRACKING] ✅ Drawing annotation created`);
      } else if (!hasDrawing) {
        console.log(`[Q11 PROBLEM TRACKING] ⚠️ Classification did not extract [DRAWING] - may need prompt enhancement for coordinate grid transformations`);
      }
      console.log(`[Q11 PROBLEM TRACKING] Blocks: ${stepsDataForMapping.map(s => `${s.unified_step_id}="${s.text.substring(0, 30)}"`).join(', ')}`);
    }
    
    // Q12: Track marking scheme and annotations
    if (isQ12) {
      // Use unified_step_id from enriched annotations (if available) or fall back to step_id with flexible matching
      const annotatedStepIds = new Set(enrichedAnnotations.map(a => {
        const unifiedId = (a as any).unified_step_id?.trim();
        if (unifiedId) return unifiedId;
        // Fallback: try to match step_id to unified_step_id using flexible matching
        const stepId = (a as any).step_id?.trim();
        if (stepId) {
          const stepNumMatch = stepId.match(/step[_\s]*(\d+)/i);
          if (stepNumMatch && stepNumMatch[1]) {
            const stepNum = parseInt(stepNumMatch[1], 10);
            if (stepNum > 0 && stepNum <= stepsDataForMapping.length) {
              return stepsDataForMapping[stepNum - 1].unified_step_id?.trim();
            }
          }
        }
        return null;
      }).filter(Boolean));
      const blocksWithoutAnnotations = stepsDataForMapping.filter(step => 
        !annotatedStepIds.has(step.unified_step_id?.trim())
      );
      const singleLetterBlocks = stepsDataForMapping.filter(step => {
        const text = step.text.trim();
        return text.length === 1 && /^[A-J]$/i.test(text);
      });
      // Check for block "F" - handle both plain "F" and LaTeX "\( F \)" or "$F$"
      const q12iiBlock = stepsDataForMapping.find(step => {
        const text = (step.text || step.cleanedText || '').trim();
        const normalized = text.replace(/^\\?\(?\s*\$?\s*F\s*\$?\s*\\?\)?$/, 'F').trim();
        return normalized === 'F' || text === 'F';
      });
      console.log(`[Q12 PROBLEM TRACKING] Question: ${questionId}, Marking scheme: ${task.markingScheme ? '✅ present' : '❌ missing'}`);
      console.log(`[Q12 PROBLEM TRACKING] Total blocks: ${stepsDataForMapping.length}, Annotations: ${enrichedAnnotations.length}, Single-letter blocks: ${singleLetterBlocks.length}`);
      if (singleLetterBlocks.length > 0) {
        console.log(`[Q12 PROBLEM TRACKING] ⚠️ ${singleLetterBlocks.length} single-letter block(s) passed to AI (may be question text): ${singleLetterBlocks.map(s => s.text).join(', ')}`);
      }
      if (q12iiBlock) {
        const q12iiAnnotated = annotatedStepIds.has(q12iiBlock.unified_step_id?.trim());
        console.log(`[Q12ii PROBLEM TRACKING] Q12ii block (F): step_id="${q12iiBlock.unified_step_id}", annotated: ${q12iiAnnotated ? '✅ YES' : '❌ NO'}, annotatedStepIds: ${Array.from(annotatedStepIds).join(', ')}`);
      } else {
        console.log(`[Q12ii PROBLEM TRACKING] ❌ Q12ii block (F) not found in blocks passed to AI`);
      }
      if (blocksWithoutAnnotations.length > 0) {
        console.log(`[Q12 PROBLEM TRACKING] ❌ ${blocksWithoutAnnotations.length} block(s) without annotations: ${blocksWithoutAnnotations.map(s => s.unified_step_id).join(', ')}`);
      } else {
        console.log(`[Q12 PROBLEM TRACKING] ✅ All blocks have annotations`);
      }
      console.log(`[Q12 PROBLEM TRACKING] Classification student work: ${task.classificationStudentWork || 'null'}`);
    }
    
    // Q13a: Track drawing annotation
    if (isQ13) {
      const drawingBlocks = stepsDataForMapping.filter(step => step.text.includes('[DRAWING]'));
      const q13aDrawingBlock = drawingBlocks.find(step => step.text.includes('histogram') || step.text.includes('Bar chart'));
      if (q13aDrawingBlock) {
        const q13aAnnotated = enrichedAnnotations.some(a => (a as any).step_id?.trim() === q13aDrawingBlock.unified_step_id?.trim());
        console.log(`[Q13a PROBLEM TRACKING] Q13a drawing block: step_id="${q13aDrawingBlock.unified_step_id}", annotated: ${q13aAnnotated ? '✅ YES' : '❌ NO'}`);
        if (!q13aAnnotated) {
          console.log(`[Q13a PROBLEM TRACKING] ❌ Q13a drawing block not annotated - available annotations: ${enrichedAnnotations.map(a => (a as any).step_id).join(', ')}`);
        }
      } else {
        console.log(`[Q13a PROBLEM TRACKING] ❌ Q13a drawing block not found in synthetic blocks`);
      }
    }
    
    // Q14: Track missing annotation (first block missing)
    if (isQ14) {
      const firstBlock = stepsDataForMapping[0];
      // Use unified_step_id from enriched annotations (if available) or fall back to step_id with flexible matching
      const annotatedStepIds = new Set(enrichedAnnotations.map(a => {
        const unifiedId = (a as any).unified_step_id?.trim();
        if (unifiedId) return unifiedId;
        const stepId = (a as any).step_id?.trim();
        if (stepId) {
          const stepNumMatch = stepId.match(/step[_\s]*(\d+)/i);
          if (stepNumMatch && stepNumMatch[1]) {
            const stepNum = parseInt(stepNumMatch[1], 10);
            if (stepNum > 0 && stepNum <= stepsDataForMapping.length) {
              return stepsDataForMapping[stepNum - 1].unified_step_id?.trim();
            }
          }
        }
        return null;
      }).filter(Boolean));
      const firstBlockAnnotated = firstBlock && annotatedStepIds.has(firstBlock.unified_step_id?.trim());
      if (firstBlock && !firstBlockAnnotated) {
        console.log(`[Q14 PROBLEM TRACKING] ❌ First block missing annotation: ${firstBlock.unified_step_id}="${firstBlock.text.substring(0, 50)}..."`);
      } else if (firstBlock) {
        console.log(`[Q14 PROBLEM TRACKING] ✅ First block has annotation: ${firstBlock.unified_step_id}`);
      }
      const blocksWithoutAnnotations = stepsDataForMapping.filter(step => 
        !annotatedStepIds.has(step.unified_step_id?.trim())
      );
      if (blocksWithoutAnnotations.length > 0) {
        console.log(`[Q14 PROBLEM TRACKING] ❌ ${blocksWithoutAnnotations.length} block(s) without annotations: ${blocksWithoutAnnotations.map(s => s.unified_step_id).join(', ')}`);
      } else {
        console.log(`[Q14 PROBLEM TRACKING] ✅ All ${stepsDataForMapping.length} blocks have annotations`);
      }
    }

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
