/**
 * Marking Executor Service
 * Executes AI marking and feedback generation for a single question task
 */

import { MarkingInstructionService } from './MarkingInstructionService.js';
import { MarkingServiceLocator } from './MarkingServiceLocator.js';
import { sendSseUpdate } from '../../utils/sseUtils.js';
import type { MarkingInstructions, Annotation } from '../../types/index.js';
import type { MathBlock } from '../ocr/MathDetectionService.js';

// Types for the marking executor
export interface MarkingTask {
  questionNumber: number | string;
  mathBlocks: MathBlock[];
  markingScheme: any;
  sourcePages: number[];
}

export interface QuestionResult {
  questionNumber: number | string;
  score: any;
  annotations: EnrichedAnnotation[];
  feedback?: string;
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
  console.log(`⚙️ [MARKING EXECUTION] Starting marking for Question ${questionId}...`);
  
  // Import createProgressData function
  const { createProgressData } = await import('../../utils/sseUtils.js');
  const MULTI_IMAGE_STEPS = ["Input Validation", "Standardization", "Preprocessing", "OCR & Classification", "Question Detection", "Segmentation", "Marking", "Output Generation"];
  
  sendSseUpdate(res, createProgressData(6, `Marking Question ${questionId}...`, MULTI_IMAGE_STEPS));

  try {
    // 1. Prepare STEP DATA (still need this array for enriching annotations later)
    const stepsDataForMapping = task.mathBlocks.map((block, stepIndex) => ({
      unified_step_id: `q${questionId}_step_${stepIndex + 1}`, // Q-specific ID (or use globalBlockId if available)
      pageIndex: (block as any).pageIndex,         // Ensure pageIndex is passed
      globalBlockId: (block as any).globalBlockId, // Ensure globalBlockId is passed
      text: block.mathpixLatex || block.googleVisionText || '',
      cleanedText: block.mathpixLatex || block.googleVisionText || '',
      bbox: [block.coordinates.x, block.coordinates.y, block.coordinates.width, block.coordinates.height]
    }));

    // ========================= START OF FIX =========================
    // 2. Prepare OCR Text as PLAIN TEXT for the AI Prompt
    let ocrTextForPrompt = "Student's Work:\n";
    stepsDataForMapping.forEach((step, index) => {
      // Format similar to the original prompt structure
      ocrTextForPrompt += `${index + 1}. [${step.unified_step_id}] ${step.cleanedText}\n`;
    });
    // ========================== END OF FIX ==========================

    // *** Log for Verification ***
    console.log("------------------------------------------");
    console.log(`[DEBUG - MARKING INPUT] For Question ${questionId}:`);
    console.log(">>> OCR Text being sent (Plain Text Check):");
    console.log(ocrTextForPrompt.substring(0, 500) + (ocrTextForPrompt.length > 500 ? "..." : ""));
    console.log(">>> Marking Scheme being sent:");
    console.dir(task.markingScheme, { depth: 2 }); // Verify scheme is received
    console.log("------------------------------------------");
    // **************************

    // Call Marking Instruction Service (Pass Plain Text)
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
      questionDetection: task.markingScheme
    });
    
    sendSseUpdate(res, createProgressData(6, `Annotations generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    // Basic validation of marking result
    if (!markingResult || !markingResult.annotations || !markingResult.studentScore) {
       throw new Error(`MarkingInstructionService returned invalid data for Q${questionId}`);
    }

    // 4. Call AI Response Generation Service (Pass Plain Text if needed)
    sendSseUpdate(res, createProgressData(6, `Generating feedback for Question ${questionId}...`, MULTI_IMAGE_STEPS));
    
    // Use MarkingServiceLocator for response generation
    const feedbackResult = await MarkingServiceLocator.generateChatResponse(
      ocrTextForPrompt, // Pass plain text here too if needed by this service
      'Generate feedback for this student work', // Message
      'auto', // Model type
      false, // isQuestionOnly
      false, // debug
      undefined, // onProgress
      true // useOcrText
    );
    
    sendSseUpdate(res, createProgressData(6, `Feedback generated for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    // 5. Enrich Annotations (Use the stepsDataForMapping array)
    const enrichedAnnotations: EnrichedAnnotation[] = (markingResult.annotations || []).map(anno => {
      // Find the original step data using the step_id
      const originalStep = stepsDataForMapping.find(step => step.unified_step_id === (anno as any).step_id);
      return {
        ...anno,
        bbox: (originalStep?.bbox || [0, 0, 0, 0]) as [number, number, number, number], // Get coords back
        pageIndex: originalStep?.pageIndex ?? -1 // Get page index back
      };
    }).filter(anno => anno.pageIndex !== -1 && anno.bbox.length === 4);

    // 6. Consolidate results for this question
    const score = markingResult.studentScore;
    const feedback = feedbackResult?.response; // Get response from MarkingServiceLocator

    console.log(`✅ [MARKING EXECUTION] Marking complete for Question ${questionId}. Score: ${score?.scoreText}`);
    sendSseUpdate(res, createProgressData(6, `Marking complete for Question ${questionId}.`, MULTI_IMAGE_STEPS));

    return {
      questionNumber: questionId,
      score,
      annotations: enrichedAnnotations,
      feedback
    };

  } catch (error) {
    console.error(`❌ [MARKING EXECUTION] Error during marking for Question ${questionId}:`, error);
    sendSseUpdate(res, createProgressData(6, `Error marking Question ${questionId}: ${error instanceof Error ? error.message : 'Unknown error'}`, MULTI_IMAGE_STEPS));
    // Re-throw the error so Promise.all catches it
    throw error;
  }
}
