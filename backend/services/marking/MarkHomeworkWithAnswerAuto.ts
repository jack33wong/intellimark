/**
 * MarkHomeworkWithAnswer with Auto Progress Tracking
 * Non-breaking: maintains same interface as original but with automatic progress tracking
 */

import { questionDetectionService } from '../../services/questionDetectionService.js';
import { ImageAnnotationService } from '../../services/imageAnnotationService.js';
import { getDebugMode } from '../../config/aiModels.js';
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

// Debug mode helper function
async function simulateApiDelay(operation: string, debug: boolean = false): Promise<void> {
  if (debug) {
    const debugMode = getDebugMode();
    await new Promise(resolve => setTimeout(resolve, debugMode.fakeDelayMs));
  }
}

// Common function to generate session titles for non-past-paper images
function generateNonPastPaperTitle(extractedQuestionText: string | undefined, mode: 'Question' | 'Marking'): string {
  if (extractedQuestionText && extractedQuestionText.trim()) {
    const questionText = extractedQuestionText.trim();
    
    // Handle cases where extraction failed
    if (questionText.toLowerCase().includes('unable to extract') || 
        questionText.toLowerCase().includes('no text detected') ||
        questionText.toLowerCase().includes('extraction failed')) {
      return `${mode} - ${new Date().toLocaleDateString()}`;
    }
    
    // Use the truncated question text directly - much simpler and more reliable
    const truncatedText = questionText.length > 30 
      ? questionText.substring(0, 30) + '...' 
      : questionText;
    const result = `${mode} - ${truncatedText}`;
    return result;
  } else {
    // Fallback when no question text is extracted
    const result = `${mode} - ${new Date().toLocaleDateString()}`;
    return result;
  }
}

/**
 * Auto-progress version of MarkHomeworkWithAnswer
 * Uses automatic progress tracking instead of manual step management
 */
export class MarkHomeworkWithAnswerAuto {
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
      
      const progressTracker = createAutoProgressTracker(getStepsForMode('question'), (data) => {
        finalProgressData = data;
        if (onProgress) onProgress(data);
      });

      // Register steps for auto-progress tracking
      progressTracker.registerStep('analyzing_image', {
        stepId: 'analyzing_image',
        stepName: 'Analyzing Image',
        stepDescription: 'Analyzing image structure and content...'
      });

      progressTracker.registerStep('classifying_image', {
        stepId: 'classifying_image',
        stepName: 'Classifying Image',
        stepDescription: 'Determining image type and mode...'
      });

      progressTracker.registerStep('generating_response', {
        stepId: 'generating_response',
        stepName: 'Generating Response',
        stepDescription: 'Generating AI response...'
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
      const actualModel = model === 'auto' ? 'gemini-2.0-flash-lite' : model;
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
        // Question mode: perform question detection internally for proper title, then AI response
        
        // Question Detection (internal, not shown as a step)
        const detectQuestion = async () => {
          return questionDetectionService.detectQuestion(classification.extractedQuestionText || '');
        };
        const questionDetection = await detectQuestion();
        
        // AI Response Generation (visible step)
        const logStep3Complete = logStep('AI Response Generation', actualModel);
        const generateResponse = async () => {
          const { AIMarkingService } = await import('../aiMarkingService');
          return AIMarkingService.generateChatResponse(imageData, '', model, true, debug);
        };
        
        const aiResponse = await progressTracker.withProgress('generating_response', generateResponse)();
        logStep3Complete();
        
        // Finish progress tracking
        progressTracker.finish();

        const totalProcessingTime = Date.now() - startTime;
        
        // Performance Summary
        const totalTime = totalProcessingTime / 1000;
        console.log(`📊 [PERFORMANCE] Total processing time: [${totalTime.toFixed(1)}s]`);
        
        // Calculate step percentages
        const stepEntries = Object.entries(stepTimings).filter(([_, timing]) => timing.duration);
        if (stepEntries.length > 0) {
          stepEntries
            .sort((a, b) => (b[1].duration || 0) - (a[1].duration || 0))
            .forEach(([stepName, timing]) => {
              const duration = (timing.duration || 0) / 1000;
              const percentage = ((timing.duration || 0) / totalProcessingTime * 100).toFixed(0);
              const paddedStepName = stepName.padEnd(25); // Fixed 25-character width
              console.log(`   - ${paddedStepName}: ${percentage}% [${duration.toFixed(1)}s]`);
            });
        }
        
        console.log(`🤖 [MODEL] Used: ${actualModel}`);
        console.log(`✅ [RESULT] Question mode completed successfully`);
        
        // Generate session title based on question detection result
        const sessionTitle = questionDetection?.found && questionDetection.match 
          ? `${questionDetection.match.board} ${questionDetection.match.qualification} - ${questionDetection.match.paperCode} Q${questionDetection.match.questionNumber} (${questionDetection.match.year})`
          : generateNonPastPaperTitle(classification.extractedQuestionText, 'Question');
        
        return {
          success: true,
          mode: 'Question',
          extractedText: 'Question detected - AI response generated',
          message: aiResponse.response,
          aiResponse: aiResponse.response,
          confidence: 0.9,
          processingTime: totalProcessingTime,
          progressData: finalProgressData,
          sessionTitle: sessionTitle,
          classification: classification,
          questionDetection: questionDetection,
          processingStats: {
            processingTimeMs: totalProcessingTime,
            confidence: 0.9,
            imageSize: imageData.length,
            llmTokens: totalLLMTokens,
            mathpixCalls: totalMathpixCalls,
            annotations: 0,
            modelUsed: actualModel,
            apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
          },
          apiUsed: `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent`
        } as MarkHomeworkResponse;
      } else {
        // Marking mode: full processing pipeline
        // Continue with marking mode steps (no reset needed - using complete flow)
        
        // Switch to marking mode steps
        const markingProgressTracker = createAutoProgressTracker(getStepsForMode('marking'), (data) => {
          finalProgressData = data;
          if (onProgress) onProgress(data);
        });

        // Register marking mode steps
        markingProgressTracker.registerStep('analyzing_image', {
          stepId: 'analyzing_image',
          stepName: 'Analyzing Image',
          stepDescription: 'Analyzing image structure and content...'
        });

        markingProgressTracker.registerStep('classifying_image', {
          stepId: 'classifying_image',
          stepName: 'Classifying Image',
          stepDescription: 'Determining image type and mode...'
        });

        markingProgressTracker.registerStep('detecting_question', {
          stepId: 'detecting_question',
          stepName: 'Detecting Question',
          stepDescription: 'Identifying question structure...'
        });

        markingProgressTracker.registerStep('extracting_text', {
          stepId: 'extracting_text',
          stepName: 'Extracting Text',
          stepDescription: 'Extracting text and math expressions...'
        });

        markingProgressTracker.registerStep('generating_feedback', {
          stepId: 'generating_feedback',
          stepName: 'Generating Feedback',
          stepDescription: 'Creating marking instructions...'
        });

        markingProgressTracker.registerStep('creating_annotations', {
          stepId: 'creating_annotations',
          stepName: 'Creating Annotations',
          stepDescription: 'Generating visual annotations...'
        });

        markingProgressTracker.registerStep('generating_response', {
          stepId: 'generating_response',
          stepName: 'Generating Response',
          stepDescription: 'Generating final AI response...'
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
        const detectQuestion = async () => {
          return questionDetectionService.detectQuestion(classification.extractedQuestionText || '');
        };
        const questionDetection = await markingProgressTracker.withProgress('detecting_question', detectQuestion)();
        logStep4Complete();

        const logStep5Complete = logStep('Marking Instructions', actualModel);
        const markingInstructions = await this.generateMarkingInstructions(
          imageData, model, processedImage, questionDetection, debug, markingProgressTracker
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
            processedImage.imageDimensions
          );
        };
        const annotationResult = await markingProgressTracker.withProgress('creating_annotations', createAnnotations)();
        logStep6Complete();

        // Generate final AI response
        const logStep7Complete = logStep('AI Response Generation', actualModel);
        const generateFinalResponse = async () => {
          const { AIMarkingService } = await import('../aiMarkingService');
          return AIMarkingService.generateChatResponse(
            imageData, '', model, false, debug
          );
        };
        const aiResponse = await markingProgressTracker.withProgress('generating_response', generateFinalResponse)();
        logStep7Complete();

        // Finish progress tracking
        markingProgressTracker.finish();

        const totalProcessingTime = Date.now() - startTime;
        
        // Performance Summary
        const totalTime = totalProcessingTime / 1000;
        console.log(`📊 [PERFORMANCE] Total processing time: [${totalTime.toFixed(1)}s]`);
        
        // Calculate step percentages
        const stepEntries = Object.entries(stepTimings).filter(([_, timing]) => timing.duration);
        if (stepEntries.length > 0) {
          stepEntries
            .sort((a, b) => (b[1].duration || 0) - (a[1].duration || 0))
            .forEach(([stepName, timing]) => {
              const duration = (timing.duration || 0) / 1000;
              const percentage = ((timing.duration || 0) / totalProcessingTime * 100).toFixed(0);
              const paddedStepName = stepName.padEnd(25); // Fixed 25-character width
              console.log(`   - ${paddedStepName}: ${percentage}% [${duration.toFixed(1)}s]`);
            });
        }
        
        console.log(`🤖 [MODEL] Used: ${actualModel}`);
        console.log(`✅ [RESULT] Marking mode completed successfully`);

        return {
          success: true,
          mode: 'Marking',
          extractedText: processedImage.ocrText,
          mathBlocks: processedImage.boundingBoxes,
          markingInstructions: markingInstructions,
          annotatedImage: annotationResult.annotatedImage,
          message: aiResponse.response,
          aiResponse: aiResponse.response,
          confidence: 0.9,
          processingTime: totalProcessingTime,
          progressData: finalProgressData,
          sessionTitle: questionDetection?.found && questionDetection.match 
            ? `${questionDetection.match.board} ${questionDetection.match.qualification} - ${questionDetection.match.paperCode} Q${questionDetection.match.questionNumber} (${questionDetection.match.year})`
            : generateNonPastPaperTitle(processedImage.ocrText, 'Marking'),
          classification: classification,
          questionDetection: questionDetection,
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
        } as MarkHomeworkResponse;
      }
    } catch (error) {
      console.error('Error in MarkHomeworkWithAnswerAuto.run:', error);
      throw error;
    }
  }
}
