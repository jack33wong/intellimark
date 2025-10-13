/**
 * MarkHomeworkWithAnswerAuto.ts
 *
 * The main orchestrator updated to use the MODERN, OPTIMIZED pipeline flow
 * (ImageUtils -> OcrService -> OptimizedOCRService -> AIMarkingService)
 * while preserving original class methods for backward compatibility.
 */

// --- Core Service Imports for the New Pipeline ---
import { ImageUtils } from '../ai/ImageUtils.js';
import { OcrService } from '../ai/OcrService.js';
import { OptimizedOCRService } from '../ai/OptimizedOCRService.js';
import { AIMarkingService } from '../aiMarkingService.js';

// --- Original Service Imports & Config ---
import { questionDetectionService } from '../../services/questionDetectionService.js';
import { ImageAnnotationService } from '../../services/ImageAnnotationService.js';
import { getDebugMode, getDefaultModel, getModelConfig } from '../../config/aiModels.js';
import { AutoProgressTracker, createAutoProgressTracker } from '../../utils/autoProgressTracker.js';
import { getStepsForMode } from '../../utils/progressTracker.js';

import type {
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ModelType
} from '../../types/index.js';
import type { QuestionDetectionResult } from '../../services/questionDetectionService.js';

// --- Helper Functions (Preserved and Normalized) ---

async function simulateApiDelay(operation: string, debug: boolean = false): Promise<void> {
  if (debug) {
    const debugMode = getDebugMode();
    await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
  }
}

function getShortSubjectName(qualification: string): string {
  const subjectMap: { [key: string]: string } = {
    'MATHEMATICS': 'MATHS', 'PHYSICS': 'PHYSICS', 'CHEMISTRY': 'CHEMISTRY', 'BIOLOGY': 'BIOLOGY',
    'ENGLISH': 'ENGLISH', 'ENGLISH LITERATURE': 'ENG LIT', 'HISTORY': 'HISTORY', 'GEOGRAPHY': 'GEOGRAPHY',
    'FRENCH': 'FRENCH', 'SPANISH': 'SPANISH', 'GERMAN': 'GERMAN', 'COMPUTER SCIENCE': 'COMP SCI',
    'ECONOMICS': 'ECONOMICS', 'PSYCHOLOGY': 'PSYCHOLOGY', 'SOCIOLOGY': 'SOCIOLOGY',
    'BUSINESS STUDIES': 'BUSINESS', 'ART': 'ART', 'DESIGN AND TECHNOLOGY': 'D&T',
    'MUSIC': 'MUSIC', 'PHYSICAL EDUCATION': 'PE', 'CHEM': 'CHEMISTRY', 'PHYS': 'PHYSICS'
  };
  const upperQualification = qualification.toUpperCase();
  return subjectMap[upperQualification] || qualification;
}

function generateNonPastPaperTitle(extractedQuestionText: string | undefined, mode: 'Question' | 'Marking'): string {
  if (extractedQuestionText && extractedQuestionText.trim()) {
    const questionText = extractedQuestionText.trim();
    if (questionText.toLowerCase().includes('unable to extract') || questionText.toLowerCase().includes('no text detected') || questionText.toLowerCase().includes('extraction failed')) {
      return `${mode} - ${new Date().toLocaleDateString()}`;
    }
    const truncatedText = questionText.length > 30 ? questionText.substring(0, 30) + '...' : questionText;
    return `${mode} - ${truncatedText}`;
  } else {
    return `${mode} - ${new Date().toLocaleDateString()}`;
  }
}

/**
 * Helper function to ensure bounding boxes/math blocks are always in array format.
 */
function normalizeBoundingBoxes(boundingBoxes: any): any[] {
    if (Array.isArray(boundingBoxes)) {
        return boundingBoxes;
    }
    if (typeof boundingBoxes === 'object' && boundingBoxes !== null) {
        console.log("🔧 [DATA NORMALIZATION] Converting boundingBoxes object map to array for compatibility.");
        return Object.values(boundingBoxes);
    }
    return [];
}


/**
 * The final, corrected implementation of the main orchestrator class using the modern pipeline.
 */
export class MarkHomeworkWithAnswerAuto {

  // --- NEW, REFACTORED `run` METHOD (Modern Pipeline) ---

  /**
   * The main entry point for the homework marking process.
   * This orchestrates the entire pipeline from raw image to final marked result.
   */
  public static async run({
    imageData,
    model = 'gemini-2.5-pro',
    onProgress,
    debug = false
  }: {
    imageData: string;
    model?: ModelType;
    onProgress?: (data: any) => void;
    debug?: boolean;
  }): Promise<MarkHomeworkResponse> {
    const startTime = Date.now();
    console.log("🚀 [PIPELINE START] Beginning homework marking process (Modern Pipeline)...");

    const actualModel = model === 'auto' ? getDefaultModel() : model;
    const modelConfig = getModelConfig(actualModel);
    const apiUsed = modelConfig.apiEndpoint;

    // Initialize the Progress Tracker (Simplified structure for the modern flow)
    const progressTracker = createAutoProgressTracker(getStepsForMode('marking'), (data) => {
      if (onProgress) onProgress(data);
    });
    
    // Register the steps that align with the modern pipeline stages
    progressTracker.registerStep('analyzing_image', { stepName: 'Image Preparation', stepDescription: 'Correcting orientation and analyzing...' });
    progressTracker.registerStep('extracting_text', { stepName: 'Text Extraction', stepDescription: 'Extracting raw text...' });
    progressTracker.registerStep('processing_ocr', { stepName: 'Student Work Analysis', stepDescription: 'Filtering, grouping, and enhancing work...' });
    progressTracker.registerStep('detecting_question', { stepName: 'Question Detection', stepDescription: 'Identifying question and marking scheme...' });
    progressTracker.registerStep('generating_feedback', { stepName: 'AI Marking & Annotation', stepDescription: 'Generating feedback and creating annotated image...' });


    let totalLLMTokens = 0;
    let totalMathpixCalls = 0;

    try {
      // STAGE 1: Prepare Visually Correct Image (Fixes Orientation Issues)
      const stage1 = async () => {
        const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        const rawImageBuffer = Buffer.from(base64Data, 'base64');
        return ImageUtils.prepareImage(rawImageBuffer);
      };
      const { correctedBuffer, dimensions } = await progressTracker.withProgress('analyzing_image', stage1)();
      
      // Convert corrected buffer back to base64 for the final annotation base layer
      const correctedImageData = `data:image/jpeg;base64,${correctedBuffer.toString('base64')}`;

      // STAGE 2: Perform Raw OCR
      const stage2 = async () => OcrService.extractRawBlocks(correctedBuffer);
      const rawOcrBlocks = await progressTracker.withProgress('extracting_text', stage2)();

      // STAGE 3: Process Student Work (Fixes Extraction, Grouping, and Mathpix Optimization)
      const stage3 = async () => OptimizedOCRService.process(rawOcrBlocks, correctedBuffer, dimensions);
      const processedResult = await progressTracker.withProgress('processing_ocr', stage3)();

      totalMathpixCalls += processedResult.usage?.mathpixCalls || 0;

      // Normalize the output (ensures array format)
      const studentWorkSteps = normalizeBoundingBoxes(processedResult.boundingBoxes);

      // Determine Mode based on results
      const isQuestionMode = studentWorkSteps.length < 2; // Heuristic threshold

      // STAGE 4: Question Detection
      const stage4 = async () => {
        // Use the question text extracted during the OptimizedOCRService processing
        const textToDetect = processedResult.questionText || OcrService.getFullTextFromBlocks(rawOcrBlocks);
        return questionDetectionService.detectQuestion(textToDetect);
      };
      const questionDetection = await progressTracker.withProgress('detecting_question', stage4)();

      
      // --- MODE HANDLING ---

      if (isQuestionMode) {
        // Question Mode Flow
        console.log("❓ [PIPELINE] Question mode detected. Generating AI response...");
        
        // Generate a helpful response (e.g., solution or guidance)
        const generateResponse = async () => {
            // We use the text-based approach even in question mode for security bypass compatibility.
            const questionContext = processedResult.questionText || OcrService.getFullTextFromBlocks(rawOcrBlocks);

            return AIMarkingService.generateChatResponse(
                questionContext, // Pass the extracted text
                '', // No specific user message initially
                actualModel, 
                true, // isQuestionOnly = true
                debug,
                undefined,
                true // useOcrText = true (Security Bypass)
            );
        };
        
        const aiResponse = await progressTracker.withProgress('generating_feedback', generateResponse)();
        totalLLMTokens += aiResponse.usageTokens || 0;

        // Finalize Question Mode Response
        progressTracker.finish();
        const totalProcessingTime = Date.now() - startTime;
        console.log(`✅ [PIPELINE END] Question mode completed in ${(totalProcessingTime / 1000).toFixed(1)}s.`);

        const sessionTitle = questionDetection?.found && questionDetection.match
            ? `${questionDetection.match.board} ${getShortSubjectName(questionDetection.match.qualification)}...`
            : generateNonPastPaperTitle(processedResult.questionText, 'Question');

        return { 
            success: true, 
            isQuestionOnly: true,
            isPastPaper: questionDetection?.found || false,
            mode: 'Question', 
            message: aiResponse.response,
            aiResponse: aiResponse.response,
            processingTime: totalProcessingTime,
            sessionTitle: sessionTitle,
            questionDetection: questionDetection,
            mathBlocks: studentWorkSteps,
            confidence: processedResult.confidence,
            processingStats: {
                processingTimeMs: totalProcessingTime,
                confidence: processedResult.confidence,
                imageSize: imageData.length,
                llmTokens: totalLLMTokens,
                mathpixCalls: totalMathpixCalls,
                modelUsed: actualModel,
                apiUsed: apiUsed,
            },
        } as any;

      } else {
        // Marking Mode Flow
        console.log("📊 [PIPELINE] Marking mode detected. Proceeding with AI analysis...");

        // STAGE 5: AI Marking & Annotation (Fixes Security Bypass)
        const stage5 = async () => {
            // 1. Construct the prompt using the text-based approach
            const { systemPrompt, userPrompt } = AIMarkingService.constructMarkingPrompt(
                processedResult, 
                processedResult.questionText, 
                questionDetection
            );
            
            // 2. Generate instructions from the prompt
            const markingInstructions = await AIMarkingService.generateMarkingInstructionsFromPrompt(
                systemPrompt, 
                userPrompt, 
                actualModel
            );

            // 3. Generate the final annotated image
            const annotationResult = await ImageAnnotationService.generateAnnotationResult(
                correctedImageData, // CRITICAL: Use the correctly oriented image data
                markingInstructions.annotations,
                studentWorkSteps, // Pass the normalized array with coordinates
                dimensions, // Pass the corrected dimensions
                markingInstructions.studentScore
            );
            
            return { markingInstructions, annotationResult };
        };

        const { markingInstructions, annotationResult } = await progressTracker.withProgress('generating_feedback', stage5)();
        totalLLMTokens += markingInstructions.usageTokens || 0;

        // Finalize Marking Mode Response
        progressTracker.finish();
        const totalProcessingTime = Date.now() - startTime;
        console.log(`✅ [PIPELINE END] Homework marking completed in ${(totalProcessingTime / 1000).toFixed(1)}s.`);

        const sessionTitle = questionDetection?.found && questionDetection.match
            ? `${questionDetection.match.board} ${getShortSubjectName(questionDetection.match.qualification)}...`
            : generateNonPastPaperTitle(processedResult.questionText, 'Marking');

        return {
            success: true,
            isQuestionOnly: false,
            isPastPaper: questionDetection?.found || false,
            mode: 'Marking',
            extractedText: processedResult.text,
            mathBlocks: studentWorkSteps,
            markingInstructions: markingInstructions,
            annotatedImage: annotationResult.annotatedImage,
            message: 'Marking completed.',
            suggestedFollowUps: [], // Placeholder
            ocrCleanedText: processedResult.text,
            confidence: processedResult.confidence,
            processingTime: totalProcessingTime,
            sessionTitle: sessionTitle,
            questionDetection: questionDetection,
            studentScore: markingInstructions.studentScore,
            apiUsed: apiUsed,
            processingStats: {
                processingTimeMs: totalProcessingTime,
                confidence: processedResult.confidence,
                imageSize: imageData.length,
                llmTokens: totalLLMTokens,
                mathpixCalls: totalMathpixCalls,
                annotations: annotationResult.annotations?.length || 0,
                modelUsed: actualModel,
                apiUsed: apiUsed,
            },
        } as any;
      }

    } catch (error) {
      console.error('❌ [PIPELINE FAILED] A critical error occurred:', error);
      if (progressTracker && typeof progressTracker.fail === 'function') {
          progressTracker.fail(error instanceof Error ? error.message : "An unknown error occurred.");
      }
      throw error;
    }
  }

  // --- PRESERVED ORIGINAL METHODS FOR BACKWARD COMPATIBILITY (DEPRECATED) ---
  
  /**
   * @deprecated Use the modern pipeline via the run method.
   */
  private static async classifyImageWithAI(imageData: string, model: ModelType, debug: boolean = false): Promise<ImageClassification> {
    console.warn("⚠️  [DEPRECATED] `classifyImageWithAI` was called. This functionality is now integrated into the modern pipeline flow.");
    // We must still implement it in case external code calls it directly.
    const { ClassificationService } = await import('../ai/ClassificationService.js');
    return ClassificationService.classifyImage(imageData, model, debug);
  }

  /**
   * @deprecated Use OptimizedOCRService instead.
   */
  public static async getHybridOCRResult(imageData: string, options?: any, debug: boolean = false): Promise<any> {
    console.error("❌ [DEPRECATED] `getHybridOCRResult` was called. This legacy method is known to cause issues with orientation and extraction. The pipeline should use OptimizedOCRService instead.");
    // If this must be supported, it requires significant refactoring of HybridOCRService itself.
    const { HybridOCRService } = await import('../hybridOCRService.js');
    const hybridResult = await HybridOCRService.processImage(imageData, { enablePreprocessing: true, mathThreshold: 0.10, ...options }, debug);

    // Basic normalization for compatibility if called directly
    const normalizedMathBlocks = normalizeBoundingBoxes(hybridResult.mathBlocks);
    // Basic sorting (simple top-to-bottom, left-to-right)
    const sortedMathBlocks = [...normalizedMathBlocks].sort((a, b) => {
        if (!a.coordinates || !b.coordinates) return 0;
        if (Math.abs(a.coordinates.y - b.coordinates.y) > 10) {
            return a.coordinates.y - b.coordinates.y;
        }
        return a.coordinates.x - b.coordinates.x;
    });

    return {
        ...hybridResult,
        mathBlocks: sortedMathBlocks
    };
  }

  /**
   * @deprecated Use the modern pipeline via the run method.
   */
  private static async processImageWithRealOCR(
    imageData: string, 
    debug: boolean = false,
    progressTracker?: AutoProgressTracker
  ): Promise<ProcessedImageResult & { mathpixCalls?: number }> {
    console.error("❌ [DEPRECATED] `processImageWithRealOCR` was called. This method uses the legacy HybridOCRService.");

    const processImage = async (): Promise<ProcessedImageResult & { mathpixCalls?: number }> => {
      const hybridResult = await this.getHybridOCRResult(imageData, {}, debug);
      
      // Normalize the structure for downstream compatibility (as implemented previously)
      const normalizedBoundingBoxes = (hybridResult.mathBlocks || []).map((block: any, index: number) => {
        return {
            text: block.text || block.content || '', 
            step_id: block.step_id || block.id || `step_${index + 1}`,
            x: block.coordinates?.x,
            y: block.coordinates?.y,
            width: block.coordinates?.width,
            height: block.coordinates?.height,
            coordinates: block.coordinates, 
            confidence: block.confidence,
        };
      });

      return {
        ocrText: hybridResult.text,
        boundingBoxes: normalizedBoundingBoxes,
        imageDimensions: hybridResult.dimensions,
        confidence: hybridResult.confidence,
        mathpixCalls: hybridResult.usage?.mathpixCalls || 0
      };
    };

    if (progressTracker) {
      return progressTracker.withProgress('extracting_text', processImage)();
    }
    return processImage();
  }

  /**
   * @deprecated Use the modern pipeline via the run method.
   */
  private static async generateMarkingInstructions(
    imageData: string,
    model: ModelType,
    processedImage: ProcessedImageResult,
    questionDetection: QuestionDetectionResult,
    debug: boolean = false,
    progressTracker?: AutoProgressTracker
  ): Promise<MarkingInstructions> {
    console.warn("⚠️  [DEPRECATED] `generateMarkingInstructions` (static helper) was called. This is handled within the modern pipeline flow.");

    const generateInstructions = async (): Promise<MarkingInstructions> => {
        // This method now acts as a wrapper around the logic implemented in AIMarkingService
        const { AIMarkingService } = await import('../aiMarkingService.js');
        return AIMarkingService.generateMarkingInstructions(
            imageData,
            model,
            processedImage,
            questionDetection
        );
    };

    if (progressTracker) {
      return progressTracker.withProgress('generating_feedback', generateInstructions)();
    }
    return generateInstructions();
  }
}