/**
 * Marking Pipeline with Auto Progress Tracking
 * Handles the complete marking workflow from image analysis to annotated results
 */

import { questionDetectionService } from '../../services/questionDetectionService.js';
import { ImageAnnotationService } from '../../services/imageAnnotationService.js';
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
  generateSessionTitle
} from './MarkingHelpers.js';

import type {
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ModelType
} from '../../types/index.js';
import type { QuestionDetectionResult } from '../../services/questionDetectionService.js';

// Debug mode helper function
async function simulateApiDelay(operation: string, debug: boolean = false): Promise<void> {
  if (debug) {
    const debugMode = getDebugMode();
    await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
  }
}


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
    startTime
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
  }): Promise<MarkHomeworkResponse> {
    let finalProgressData: any = null;

    const logStep = (stepName: string, modelInfo: string) => {
      const start = Date.now();
      stepTimings[stepName] = { start };
      console.log(`🔄 [${stepName}] Starting ${modelInfo}...`);
      
      return () => {
        const duration = Date.now() - start;
        stepTimings[stepName].duration = duration;
        console.log(`✅ [${stepName}] Completed in ${(duration / 1000).toFixed(1)}s`);
      };
    };

    // Setup progress tracking
    const progressTracker = setupQuestionModeProgressTracker((data) => {
      finalProgressData = data;
      if (onProgress) onProgress(data);
    });

    // OCR Processing (to get confidence value)
    const logStep3Complete = logStep('OCR Processing', 'google-vision + mathpix');
    const processOCR = async () => {
      const { HybridOCRService } = await import('../hybridOCRService');
      return HybridOCRService.processImage(imageData, {}, debug);
    };
    
    const ocrResult = await progressTracker.withProgress('processing_ocr', processOCR)();
    logStep3Complete();
    
    // Collect Mathpix calls from OCR
    totalMathpixCalls += ocrResult.usage?.mathpixCalls || 0;
    
    // Question Detection (internal, not shown as a step)
    const questionDetection = await performQuestionDetection(classification.extractedQuestionText);
    
    // AI Response Generation (visible step)
    const logStep4Complete = logStep('AI Response Generation', actualModel);
    const generateResponse = async () => {
      const { AIMarkingService } = await import('../aiMarkingService');
      return AIMarkingService.generateChatResponse(imageData, '', model, true, debug);
    };
    
    const aiResponse = await progressTracker.withProgress('generating_response', generateResponse)();
    logStep4Complete();
    
    // Collect LLM tokens from AI response
    totalLLMTokens += aiResponse.usageTokens || 0;
    
    // Generate suggested follow-ups for question mode
    const { DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS } = await import('../../config/suggestedFollowUpConfig.js');
    const suggestedFollowUps = DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS;
    
    // Finish progress tracking
    progressTracker.finish();

    const totalProcessingTime = Date.now() - startTime;
    
    // Performance Summary
    logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'Question');
    
    // Generate session title based on question detection result
    const sessionTitle = generateSessionTitle(questionDetection, classification.extractedQuestionText || '', 'Question');
    
    const isPastPaper = questionDetection?.found || false;
    
    // Add marking scheme and question text to questionDetection (same as marking mode)
    if (questionDetection) {
      questionDetection.markingScheme = JSON.stringify(questionDetection.match?.markingScheme?.questionMarks || {});
      questionDetection.questionText = classification.extractedQuestionText || '';
    }

    return {
      success: true,
      isQuestionOnly: true,
      isPastPaper: isPastPaper, // Set isPastPaper based on question detection
      mode: 'Question',
      extractedText: 'Question detected - AI response generated',
      message: aiResponse.response,
      aiResponse: aiResponse.response,
      suggestedFollowUps: suggestedFollowUps,
      ocrCleanedText: ocrResult.text, // Add OCR cleaned text
      confidence: ocrResult.confidence || 0,
      processingTime: totalProcessingTime,
      progressData: finalProgressData,
      sessionTitle: sessionTitle,
      classification: classification,
      questionDetection: questionDetection,
      // Remove detectedQuestion from session metadata - will be stored in individual messages
      processingStats: {
        processingTimeMs: totalProcessingTime,
        confidence: ocrResult.confidence || 0,
        imageSize: imageData.length,
        llmTokens: totalLLMTokens,
        mathpixCalls: totalMathpixCalls,
        annotations: 0,
        modelUsed: actualModel,
        apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
      },
      apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
    } as any;
  }

  /**
   * Process marking mode pipeline
   */
  private static async processMarkingMode({
    imageData,
    model,
    classification,
    actualModel,
    debug,
    onProgress,
    stepTimings,
    totalLLMTokens,
    totalMathpixCalls,
    startTime
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
  }): Promise<MarkHomeworkResponse> {
    let finalProgressData: any = null;

    const logStep = (stepName: string, modelInfo: string) => {
      const start = Date.now();
      stepTimings[stepName] = { start };
      console.log(`🔄 [${stepName}] Starting ${modelInfo}...`);
      
      return () => {
        const duration = Date.now() - start;
        stepTimings[stepName].duration = duration;
        console.log(`✅ [${stepName}] Completed in ${(duration / 1000).toFixed(1)}s`);
      };
    };

    // Setup progress tracking
    const markingProgressTracker = setupMarkingModeProgressTracker((data) => {
      finalProgressData = data;
      if (onProgress) onProgress(data);
    });

    // Execute marking mode pipeline with auto-progress
    // Skip steps 1-2 (already completed in question mode)
    // Step 3: OCR Processing (extract text first)
    const logStep3Complete = logStep('OCR Processing', 'google-vision + mathpix');
    const processedImage = await this.processImageWithRealOCR(imageData, debug, markingProgressTracker);
    logStep3Complete();
    
    // Collect Mathpix calls from OCR processing
    totalMathpixCalls += processedImage.mathpixCalls || 0;

    // Step 4: Question Detection (use extracted text)
    const logStep4Complete = logStep('Question Detection', 'question-detection');
    const questionDetection = await markingProgressTracker.withProgress('detecting_question', async () => {
      return performQuestionDetection(classification.extractedQuestionText);
    })();
    logStep4Complete();

    const logStep5Complete = logStep('Marking Instructions', actualModel);
    // Add extracted question text to questionDetection for OCR cleanup
    const questionDetectionWithText = {
      ...questionDetection,
      extractedQuestionText: classification.extractedQuestionText
    };
    
    const markingInstructions = await this.generateMarkingInstructions(
      imageData, model, processedImage, questionDetectionWithText, debug, markingProgressTracker
    );
    logStep5Complete();
    
    // Collect LLM tokens from marking instructions
    totalLLMTokens += (markingInstructions as any).usage?.llmTokens || 0;

    // Create annotations and annotated image
    const logStep6Complete = logStep('Burn Overlay', 'image-processing');
    const createAnnotations = async () => {
      if (!markingInstructions.annotations || markingInstructions.annotations.length === 0) {
        return {
          originalImage: imageData,
          annotatedImage: imageData,
          annotations: [],
          svgOverlay: ''
        };
      }

      // Use the AI-generated annotations directly - they already have correct actions and text
      const annotations = markingInstructions.annotations;

      // Generate the actual annotated image
      return ImageAnnotationService.generateAnnotationResult(
        imageData,
        annotations,
        processedImage.imageDimensions,
        markingInstructions.studentScore
      );
    };
    const annotationResult = await markingProgressTracker.withProgress('creating_annotations', createAnnotations)();
    logStep6Complete();

    // Generate suggested follow-ups for marking mode
    const { DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS } = await import('../../config/suggestedFollowUpConfig.js');
    const suggestedFollowUps = DEFAULT_SUGGESTED_FOLLOW_UP_SUGGESTIONS;

    // Finish progress tracking
    markingProgressTracker.finish();

    const totalProcessingTime = Date.now() - startTime;
    
    // Performance Summary
    logPerformanceSummary(stepTimings, totalProcessingTime, actualModel, 'Marking');

    const isPastPaper = questionDetection?.found || false;
    
    return {
      success: true,
      isQuestionOnly: false,
      isPastPaper: isPastPaper, // Set isPastPaper based on question detection
      mode: 'Marking',
      extractedText: processedImage.ocrText,
      mathBlocks: processedImage.boundingBoxes,
      markingInstructions: markingInstructions,
      annotatedImage: annotationResult.annotatedImage,
      message: 'Marking completed - see suggested follow-ups below',
      suggestedFollowUps: suggestedFollowUps,
      ocrCleanedText: processedImage.ocrText, // Add OCR cleaned text
      confidence: processedImage.confidence || 0,
      processingTime: totalProcessingTime,
      progressData: finalProgressData,
      sessionTitle: generateSessionTitle(questionDetection, processedImage.ocrText, 'Marking'),
      classification: classification,
      questionDetection: questionDetection,
      studentScore: markingInstructions.studentScore, // Add student score to response
      // Remove detectedQuestion from session metadata - will be stored in individual messages
      processingStats: {
        processingTimeMs: totalProcessingTime,
        confidence: processedImage.confidence || 0,
        imageSize: imageData.length,
        llmTokens: totalLLMTokens,
        mathpixCalls: totalMathpixCalls,
        annotations: processedImage.boundingBoxes?.length || 0,
        modelUsed: actualModel,
        apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
      },
      apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
    } as any;
  }

  /**
   * Classify image using AI
   */
  private static async classifyImageWithAI(imageData: string, model: ModelType, debug: boolean = false): Promise<ImageClassification> {
    const { ClassificationService } = await import('../ai/ClassificationService.js');
    return ClassificationService.classifyImage(imageData, model, debug);
  }

  /**
   * Public method to get full hybrid OCR result with proper sorting for testing
   */
  public static async getHybridOCRResult(imageData: string, options?: any, debug: boolean = false): Promise<any> {
    const { HybridOCRService } = await import('../hybridOCRService.js');

    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10,
      ...options
    }, debug);

    // Sort math blocks with intelligent sorting (y-coordinate + x-coordinate for overlapping boxes)
    const sortedMathBlocks = [...hybridResult.mathBlocks].sort((a, b) => {
      const aY = a.coordinates.y;
      const aHeight = a.coordinates.height;
      const aBottom = aY + aHeight;
      const bY = b.coordinates.y;
      const bHeight = b.coordinates.height;
      const bBottom = bY + bHeight;
      
      // Check if boxes are on the same line (overlap vertically by 30% or more)
      const overlapThreshold = 0.3;
      const verticalOverlap = Math.min(aBottom, bBottom) - Math.max(aY, bY);
      
      if (verticalOverlap > 0) {
        // Calculate overlap ratio for both boxes
        const aOverlapRatio = verticalOverlap / aHeight;
        const bOverlapRatio = verticalOverlap / bHeight;
        
        if (aOverlapRatio >= overlapThreshold || bOverlapRatio >= overlapThreshold) {
          // If boxes are on the same line, sort by x-coordinate (left to right)
          return a.coordinates.x - b.coordinates.x;
        }
      }
      
      // Otherwise, sort by y-coordinate (top to bottom)
      return aY - bY;
    });

    return {
      ...hybridResult,
      mathBlocks: sortedMathBlocks
    };
  }

  /**
   * Process image with real OCR (auto-progress version)
   */
  private static async processImageWithRealOCR(
    imageData: string, 
    debug: boolean = false,
    progressTracker?: AutoProgressTracker
  ): Promise<ProcessedImageResult & { mathpixCalls?: number }> {
    const processImage = async (): Promise<ProcessedImageResult & { mathpixCalls?: number }> => {
      const hybridResult = await this.getHybridOCRResult(imageData, {}, debug);
      
      return {
        ocrText: hybridResult.text,
        boundingBoxes: hybridResult.mathBlocks || [],
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

  /**
   * Main run method with auto-progress tracking
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
    
    // Timing tracking for performance analysis
    const stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } } = {};
    let currentStep = 0;
    let totalSteps = 0;
    let modeSteps: string[] = []; // Track steps for current mode
    
    // Token and API call tracking
    let totalLLMTokens = 0;
    let totalMathpixCalls = 0;
    
    const logStep = (stepName: string, modelInfo: string) => {
      currentStep++;
      const startTime = Date.now();
      stepTimings[stepName] = { start: startTime };
      
      // Log step completion with duration
      const logStepComplete = (subSteps?: { [key: string]: number }) => {
        const timing = stepTimings[stepName];
        if (timing) {
          timing.duration = Date.now() - timing.start;
          timing.subSteps = subSteps;
          const duration = (timing.duration / 1000).toFixed(1);
          
          // Use actual total steps for current mode
          const actualTotalSteps = modeSteps.length;
          const progress = `[${currentStep}/${actualTotalSteps}]`;
          const paddedName = stepName.padEnd(25); // Fixed 25-character width for all step names
          const durationStr = `[${duration}s]`;
          const modelStr = `(${modelInfo})`;
          console.log(`${progress} ${paddedName} ${durationStr} ${modelStr}`);
          
          if (subSteps) {
            Object.entries(subSteps).forEach(([subStep, subDuration]) => {
              const subDurationStr = (subDuration / 1000).toFixed(1);
              console.log(`   └─ ${subStep}: [${subDurationStr}s]`);
            });
          }
        }
      };
      
      return logStepComplete;
    };
    const startTime = Date.now();

    try {
      // Create auto-progress tracker
      let finalProgressData: any = null;
      
      // Set up for complete flow (question mode + potential marking mode)
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
      currentStep = 0; // Reset step counter
      
      const progressTracker = setupQuestionModeProgressTracker((data) => {
        finalProgressData = data;
        if (onProgress) onProgress(data);
      });

      // Step 1: Analyze image (auto-progress)
      const logStep1Complete = logStep('Image Analysis', 'google-vision');
      const analyzeImage = async () => {
        await simulateApiDelay('Image Analysis', debug);
        return { analyzed: true };
      };
      await progressTracker.withProgress('analyzing_image', analyzeImage)();
      logStep1Complete();

      // Step 2: Classify image (auto-progress)
      const actualModel = model === 'auto' ? getDefaultModel() : model;
      const logStep2Complete = logStep('Image Classification', actualModel);
      const classifyImage = async () => {
        return this.classifyImageWithAI(imageData, model, debug);
      };
      const classification = await progressTracker.withProgress('classifying_image', classifyImage)();
      logStep2Complete();
      
      // Collect LLM tokens from classification
      totalLLMTokens += classification.usageTokens || 0;

      // Determine if this is question mode or marking mode
      const isQuestionMode = classification.isQuestionOnly === true;
      
      if (isQuestionMode) {
        // Question mode: simplified pipeline
        console.log('📝 [MODE] Question mode detected - using simplified pipeline');
        return this.processQuestionMode({
          imageData,
          model,
          classification,
          actualModel,
          debug,
          onProgress,
          stepTimings,
          totalLLMTokens,
          totalMathpixCalls,
          startTime
        });
      } else {
        // Marking mode: full processing pipeline
        console.log('📝 [MODE] Marking mode detected - using full pipeline');
        return this.processMarkingMode({
          imageData,
          model,
          classification,
          actualModel,
          debug,
          onProgress,
          stepTimings,
          totalLLMTokens,
          totalMathpixCalls,
          startTime
        });
      }
    } catch (error) {
      console.error('Error in MarkHomeworkWithAnswerAuto.run:', error);
      throw error;
    }
  }
}
