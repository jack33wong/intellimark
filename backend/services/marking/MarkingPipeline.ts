/**
 * Marking Pipeline with Auto Progress Tracking
 * Handles the complete marking workflow from image analysis to annotated results
 */

import { questionDetectionService } from './questionDetectionService.js';
import { ImageAnnotationService } from './imageAnnotationService.js';
import { getDebugMode, getDefaultModel } from '../../config/aiModels.js';
import { AutoProgressTracker, createAutoProgressTracker } from '../../utils/autoProgressTracker.js';
import { getStepsForMode } from '../../utils/progressTracker.js';
import {
  getShortSubjectName,
  generateNonPastPaperTitle,
  setupQuestionModeProgressTracker,
  setupMarkingModeProgressTracker,
  performQuestionDetection,
  logPerformanceSummary,
  generateSessionTitle,
  simulateApiDelay,
  getSuggestedFollowUps,
  setupProgressTrackerWithCallback,
  logCommonSteps,
  buildMarkingResponse
} from './MarkingHelpers.js';

import type {
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ModelType
} from '../../types/index.js';
import type { QuestionDetectionResult } from './questionDetectionService.js';



/**
 * Marking Pipeline with Auto Progress Tracking
 * Uses automatic progress tracking instead of manual step management
 */
export class MarkingPipeline {
  /**
   * Process question mode pipeline
   */
  private static async processQuestionMode({
    imageData,
    model,
    classification,
    actualModel,
    debug,
    onProgress,
    stepTimings,
    totalLLMTokens,
    totalMathpixCalls,
    startTime,
    logStep
  }: {
    imageData: string;
    model: ModelType;
    classification: ImageClassification;
    actualModel: string;
    debug: boolean;
    onProgress?: (data: any) => void;
    stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } };
    totalLLMTokens: number;
    totalMathpixCalls: number;
    startTime: number;
    logStep: (stepName: string, modelInfo: string) => () => void;
  }): Promise<MarkHomeworkResponse> {
    let finalProgressData: any = null;

    // Setup progress tracking
    const progressTracker = setupProgressTrackerWithCallback('question', (data) => {
      finalProgressData = data;
      if (onProgress) onProgress(data);
    });

    // Steps 1 & 2 already logged in main run method with proper timing

    // Step 3: Question Detection
    const logStep3Complete = logStep('Question Detection', 'question-detection');
    stepTimings['question_detection'] = { start: Date.now() };
    const questionDetection = await performQuestionDetection(classification.extractedQuestionText);
    stepTimings['question_detection'].duration = Date.now() - stepTimings['question_detection'].start;
    logStep3Complete();
    
    // Step 4: AI Response Generation - REMOVED
    // AI Response Generation has been removed for performance optimization
    
    // Generate suggested follow-ups for question mode
    const suggestedFollowUps = await getSuggestedFollowUps();
    
    // Finish progress tracking
    progressTracker.finish();

    const totalProcessingTime = Date.now() - startTime;
    
    // Performance Summary
    logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'Question');
    
    // Build and return response using helper function
    return buildMarkingResponse({
      mode: 'Question',
      imageData,
      classification,
      questionDetection,
      actualModel,
      totalProcessingTime,
      totalLLMTokens,
      totalMathpixCalls,
      finalProgressData,
      suggestedFollowUps
    });
  }

  /**
   * Process marking mode pipeline
   */
  private static async processMarkingMode({
    originalImageData,
    imageData,
    model,
    classification,
    actualModel,
    debug,
    onProgress,
    stepTimings,
    totalLLMTokens,
    totalMathpixCalls,
    startTime,
    logStep
  }: {
    originalImageData: string;
    imageData: string;
    model: ModelType;
    classification: ImageClassification;
    actualModel: string;
    debug: boolean;
    onProgress?: (data: any) => void;
    stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } };
    totalLLMTokens: number;
    totalMathpixCalls: number;
    startTime: number;
    logStep: (stepName: string, modelInfo: string) => () => void;
  }): Promise<MarkHomeworkResponse> {
    let finalProgressData: any = null;

    // Setup progress tracking
    const markingProgressTracker = setupProgressTrackerWithCallback('marking', (data) => {
      finalProgressData = data;
      if (onProgress) onProgress(data);
    });

    // Steps 1 & 2 already logged in main run method with proper timing

    // Step 3: OCR Processing (extract text first)
    const logStep3Complete = logStep('OCR Processing', 'google-vision + mathpix');
    stepTimings['extracting_text'] = { start: Date.now() };
    const processedImage = await this.processImageWithOCRPipeline(imageData, debug, markingProgressTracker, classification);
    stepTimings['extracting_text'].duration = Date.now() - stepTimings['extracting_text'].start;
    logStep3Complete();
    
    // Collect Mathpix calls from OCR processing
    totalMathpixCalls += processedImage.mathpixCalls || 0;

    // Step 4: Question Detection (use extracted text)
    const logStep4Complete = logStep('Question Detection', 'question-detection');
    stepTimings['detecting_question'] = { start: Date.now() };
    const questionDetection = await markingProgressTracker.withProgress('detecting_question', async () => {
      return performQuestionDetection(classification.extractedQuestionText);
    })();
    stepTimings['detecting_question'].duration = Date.now() - stepTimings['detecting_question'].start;
    logStep4Complete();

    const logStep5Complete = logStep('Marking Instructions', actualModel);
    stepTimings['generating_feedback'] = { start: Date.now() };
    // Add extracted question text to questionDetection for OCR cleanup
    const questionDetectionWithText = {
      ...questionDetection,
      extractedQuestionText: classification.extractedQuestionText
    };
    
    const markingInstructions = await this.generateMarkingInstructions(
      imageData, model, processedImage, questionDetectionWithText, debug, markingProgressTracker
    );
    stepTimings['generating_feedback'].duration = Date.now() - stepTimings['generating_feedback'].start;
    logStep5Complete();
    
    // Collect LLM tokens from marking instructions
    totalLLMTokens += (markingInstructions as any).usage?.llmTokens || 0;

    // Create annotations and annotated image
    const logStep6Complete = logStep('Burn Overlay', 'image-processing');
    stepTimings['creating_annotations'] = { start: Date.now() };
    const createAnnotations = async () => {
      if (!markingInstructions.annotations || markingInstructions.annotations.length === 0) {
        return {
          originalImage: originalImageData,
          annotatedImage: originalImageData,
          annotations: [],
          svgOverlay: ''
        };
      }

      // Use the AI-generated annotations directly - they already have correct actions and text
      const annotations = markingInstructions.annotations;

      // CRUCIAL CHANGE: Generate the annotated image using the ORIGINAL image data.
      // Coordinates align because ImageUtils.preProcess normalized orientation without resizing/cropping.
      return ImageAnnotationService.generateAnnotationResult(
        originalImageData,
        annotations,
        processedImage.imageDimensions,
        markingInstructions.studentScore
      );
    };
    const annotationResult = await markingProgressTracker.withProgress('creating_annotations', createAnnotations)();
    stepTimings['creating_annotations'].duration = Date.now() - stepTimings['creating_annotations'].start;
    logStep6Complete();

    // Step 7: AI Response Generation - REMOVED
    // AI Response Generation has been removed for performance optimization

    // Generate suggested follow-ups for marking mode
    const suggestedFollowUps = await getSuggestedFollowUps();

    // Finish progress tracking
    markingProgressTracker.finish();

    const totalProcessingTime = Date.now() - startTime;
    
    // Performance Summary
    logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'Marking');

    // Build and return response using helper function
    return buildMarkingResponse({
      mode: 'Marking',
      imageData: originalImageData,
      classification,
      questionDetection,
      actualModel,
      totalProcessingTime,
      totalLLMTokens,
      totalMathpixCalls,
      finalProgressData,
      suggestedFollowUps,
      processedImage,
      markingInstructions,
      annotationResult
    });
  }

  /**
   * Classify image using AI
   */
  private static async classifyImageWithAI(imageData: string, model: ModelType, debug: boolean = false, fileName?: string): Promise<ImageClassification> {
    const { ClassificationService } = await import('./ClassificationService.js');
    return ClassificationService.classifyImage(imageData, model, debug, fileName);
  }



  /**
   * Process image with OCRPipeline (auto-progress version)
   * This method uses the new OCRPipeline for centralized OCR processing
   */
  private static async processImageWithOCRPipeline(
    imageData: string, 
    debug: boolean = false,
    progressTracker?: AutoProgressTracker,
    classification?: any
  ): Promise<ProcessedImageResult & { mathpixCalls?: number }> {
    const processImage = async (): Promise<ProcessedImageResult & { mathpixCalls?: number }> => {
      const { OCRService } = await import('../ocr/OCRService.js');
      // Pass questionDetection to OCRPipeline for OCR cleanup
      const questionDetectionForOCR = {
        extractedQuestionText: classification.extractedQuestionText
      };
      const ocrResult = await OCRService.processImage(imageData, {}, debug, 'auto', questionDetectionForOCR);
      
      return {
        ocrText: ocrResult.text,
        boundingBoxes: ocrResult.boundingBoxes,
        imageDimensions: ocrResult.dimensions,
        confidence: ocrResult.confidence,
        mathpixCalls: ocrResult.usage?.mathpixCalls || 0,
        // Pass through OCR cleanup results
        cleanedOcrText: ocrResult.cleanedOcrText,
        cleanDataForMarking: ocrResult.cleanDataForMarking,
        unifiedLookupTable: ocrResult.unifiedLookupTable
      } as any;
    };

    if (progressTracker) {
      return progressTracker.withProgress('extracting_text', processImage)();
    }
    return processImage();
  }

  /**
   * Generate marking instructions (auto-progress version)
   */
  private static async generateMarkingInstructions(
    imageData: string,
    model: ModelType,
    processedImage: ProcessedImageResult,
    questionDetection: QuestionDetectionResult,
    debug: boolean = false,
    progressTracker?: AutoProgressTracker
  ): Promise<MarkingInstructions> {
    const generateInstructions = async (): Promise<MarkingInstructions> => {
      const { MarkingInstructionService } = await import('./MarkingInstructionService.js');
      
      return MarkingInstructionService.executeMarking({
        imageData,
        model,
        processedImage,
        questionDetection
      });
    };

    if (progressTracker) {
      return progressTracker.withProgress('generating_feedback', generateInstructions)();
    }
    return generateInstructions();
  }

  /**
   * Main run method with auto-progress tracking
   */
  public static async run({
    imageData,
    model = 'auto',
    onProgress,
    debug = false,
    fileName
  }: {
    imageData: string;
    model?: ModelType;
    onProgress?: (data: any) => void;
    debug?: boolean;
    fileName?: string;
  }): Promise<MarkHomeworkResponse> {
    
    // Timing tracking for performance analysis
    const stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } } = {};
    let currentStep = 0;
    let totalSteps = 0;
    let modeSteps: string[] = []; // Track steps for current mode
    
    // Token and API call tracking
    let totalLLMTokens = 0;
    let totalMathpixCalls = 0;
    
    const startTime = Date.now();

    // Simple step logging will be created after mode detection

    try {
      // --- Step 0: Normalize Orientation (CRITICAL FIX) ---
      // Ensure the base image is correctly oriented before any other processing.
      const normalizationStart = Date.now();
      const { ImageUtils } = await import('../../utils/ImageUtils.js');
      const normalizedImageData = await ImageUtils.normalizeOrientation(imageData);
      stepTimings['normalization'] = { start: normalizationStart, duration: Date.now() - normalizationStart };

      // normalizedImageData is now the source of truth for the color image.

      // Create auto-progress tracker
      let finalProgressData: any = null;
      
      // Set up for complete flow (question mode + potential marking mode)
      // modeSteps will be set based on the detected mode
      totalSteps = 0; // Will be set based on mode
      currentStep = 0; // Reset step counter
      
      const progressTracker = setupQuestionModeProgressTracker((data) => {
        finalProgressData = data;
        if (onProgress) onProgress(data);
      });

      // Step 1: Preprocess image (Analyze Image)
      const preprocessImage = async () => {
        // Use the normalized image as input for pre-processing
        const preprocessedImageData = await ImageUtils.preProcess(normalizedImageData);
        return { preprocessedImageData };
      };
      stepTimings['analyzing_image'] = { start: Date.now() };
      const preprocessingResult = await progressTracker.withProgress('analyzing_image', preprocessImage)();
      stepTimings['analyzing_image'].duration = Date.now() - stepTimings['analyzing_image'].start;
      
      // Use preprocessed image for subsequent analysis steps
      const processedImageData = preprocessingResult.preprocessedImageData;

      // Step 2: Classify image (auto-progress) - use preprocessed image
      const actualModel = model === 'auto' ? getDefaultModel() : model;
      const classifyImage = async () => {
        return this.classifyImageWithAI(processedImageData, model, debug, fileName);
      };
      stepTimings['classifying_image'] = { start: Date.now() };
      const classification = await progressTracker.withProgress('classifying_image', classifyImage)();
      stepTimings['classifying_image'].duration = Date.now() - stepTimings['classifying_image'].start;
      
      // Collect LLM tokens from classification
      totalLLMTokens += classification.usageTokens || 0;

      // Determine if this is question mode or marking mode
      const isQuestionMode = classification.isQuestionOnly === true;
      
      // Log the first two steps immediately after they complete
      const totalStepsForMode = isQuestionMode ? 4 : 7;
      // Updated log source for Step 1 to reflect image processing
      console.log(`[1/${totalStepsForMode}] Image Analysis            [${(stepTimings['analyzing_image'].duration / 1000).toFixed(1)}s] [image-processing]`);
      console.log(`[2/${totalStepsForMode}] Image Classification      [${(stepTimings['classifying_image'].duration / 1000).toFixed(1)}s] [${actualModel}]`);
      
      // Print classification debug info after step completion
      console.log('🔍 [CLASSIFICATION DEBUG] Raw cleanContent:', classification.extractedQuestionText?.substring(0, 200) + '...');
      
      if (isQuestionMode) {
        // Question mode: simplified pipeline
        console.log('📝 [MODE] Question mode detected - using simplified pipeline');
        modeSteps = [
          'Image Analysis', 
          'Image Classification', 
          'Question Detection', 
          'AI Response Generation'
        ];
        totalSteps = modeSteps.length;
        
        // Create simple step logger with correct total steps
        const { createStepLogger } = await import('./MarkingHelpers.js');
        const stepLogger = createStepLogger(totalSteps);
        
        return this.processQuestionMode({
          imageData: processedImageData, // Use preprocessed image
          model,
          classification,
          actualModel,
          debug,
          onProgress,
          stepTimings,
          totalLLMTokens,
          totalMathpixCalls,
          startTime,
          logStep: stepLogger.logStep
        });
      } else {
        // Marking mode: full processing pipeline
        console.log('📝 [MODE] Marking mode detected - using full pipeline');
        modeSteps = [
          'Image Analysis', 
          'Image Classification', 
          'Question Detection', 
          'OCR Processing', 
          'Marking Instructions', 
          'Burn Overlay', 
          'AI Response Generation'
        ];
        totalSteps = modeSteps.length;
        
        // Create simple step logger with correct total steps
        const { createStepLogger } = await import('./MarkingHelpers.js');
        const stepLogger = createStepLogger(totalSteps);
        
        return this.processMarkingMode({
          originalImageData: normalizedImageData, // Pass the normalized color image
          imageData: processedImageData, // Pass the pre-processed (grayscale/enhanced) image
          model,
          classification,
          actualModel,
          debug,
          onProgress,
          stepTimings,
          totalLLMTokens,
          totalMathpixCalls,
          startTime,
          logStep: stepLogger.logStep
        });
      }
    } catch (error) {
      console.error('Error in MarkHomeworkWithAnswerAuto.run:', error);
      throw error;
    }
  }
}
