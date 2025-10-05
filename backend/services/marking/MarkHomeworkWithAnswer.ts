/**
 * MarkHomeworkWithAnswer Orchestrator
 * Implements the service-level flow described in docs/markanswer.md
 * Non-breaking: delegates to existing services and preserves response shape
 */

import { questionDetectionService } from '../../services/questionDetectionService.js';
import { ImageAnnotationService } from '../../services/imageAnnotationService.js';
import { getDebugMode } from '../../config/aiModels.js';
import { ProgressTracker, getStepsForMode } from '../../utils/progressTracker.js';

import type {
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ModelType,
  QuestionDetectionResult
} from '../../types/index.js';

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
 * Lightweight adapter around existing services to centralize the flow.
 * Mirrors backend/routes/mark-homework.ts behavior.
 */
export class MarkHomeworkWithAnswer {
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
   * Process image with enhanced OCR
   */
  private static async processImageWithRealOCR(imageData: string, debug: boolean = false): Promise<ProcessedImageResult & { mathpixCalls?: number }> {
    const { HybridOCRService } = await import('../hybridOCRService.js');

    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    }, debug);

    // Build OCR text by concatenating LaTeX text, falling back to Vision text if LaTeX not available
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
    
    const processedOcrText = sortedMathBlocks
      .map(block => block.mathpixLatex || block.googleVisionText || '')
      .filter(Boolean)
      .join('\n');

    const processedBoundingBoxes = sortedMathBlocks
      .filter(block => block.mathpixLatex)
      .map(block => ({
        x: block.coordinates.x,
        y: block.coordinates.y,
        width: block.coordinates.width,
        height: block.coordinates.height,
        text: block.mathpixLatex as string,
        confidence: block.confidence
      }));

    const processedResult: ProcessedImageResult & { mathpixCalls?: number } = {
      ocrText: processedOcrText,
      boundingBoxes: processedBoundingBoxes,
      confidence: hybridResult.confidence,
      imageDimensions: hybridResult.dimensions,
      isQuestion: false,
      mathpixCalls: (hybridResult as any)?.usage?.mathpixCalls || 0
    };

    return processedResult;
  }

  /**
   * Generate marking instructions using new flow with fallback to legacy
   */
  private static async generateMarkingInstructions(
    imageData: string,
    model: ModelType,
    processedImage: ProcessedImageResult,
    questionDetection?: QuestionDetectionResult
  ): Promise<MarkingInstructions & { usage?: { llmTokens: number } }> {
    try {
      const { LLMOrchestrator } = await import('../ai/LLMOrchestrator.js');
      return await LLMOrchestrator.executeMarking({
        imageData,
        model,
        processedImage,
        questionDetection
      });
    } catch (_err) {
      // Fallback to basic annotations if the new flow fails
      return { annotations: [], usage: { llmTokens: 0 } } as any;
    }
  }

  /**
   * Execute the full marking flow.
   * Returns the same response shape currently produced by the route handler.
   */
  static async run(params: {
    imageData: string;
    model: ModelType;
    userId?: string;
    userEmail?: string;
    debug?: boolean;
    onProgress?: (data: any) => void;
    aiMessageId?: string;
  }): Promise<MarkHomeworkResponse> {
    const startTime = Date.now();
    const { imageData, model, debug = false, onProgress, aiMessageId } = params;
    const userId = params.userId || 'anonymous';
    const userEmail = params.userEmail || 'anonymous@example.com';
    
    // Timing tracking for performance analysis
    const stepTimings: { [key: string]: { start: number; duration?: number; subSteps?: { [key: string]: number } } } = {};
    let currentStep = 0;
    let totalSteps = 0;
    
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
          
          // Ensure totalSteps is set before logging
          const actualTotalSteps = totalSteps > 0 ? totalSteps : 3; // Default to 3 if not set
          const progress = `[${currentStep}/${actualTotalSteps}]`;
          const paddedName = stepName.padEnd(25); // Fixed 25-character width for all step names
          const durationStr = `[${duration}s]`;
          const modelStr = `(${modelInfo})`;
          console.log(`${progress} ${paddedName} ${durationStr} ${modelStr}`);
          
          if (subSteps) {
            Object.entries(subSteps).forEach(([subStep, subDuration]) => {
              console.log(`  ✅ [${stepName}] ${subStep} - [${(subDuration / 1000).toFixed(1)}s]`);
            });
          }
        }
      };
      
      return logStepComplete;
    };

    try {
      // Create progress tracker with question mode steps initially
      let finalProgressData: any = null;
      let progressTracker = new ProgressTracker(getStepsForMode('question'), (data) => {
        // Store the final progress data for chat history
        finalProgressData = data;
        // Call the original callback
        if (onProgress) onProgress(data);
      });

      // Start progress tracking immediately
      progressTracker.startStep('analyzing_image');

      // Debug mode: Skip AI processing but go through the flow
      if (debug) {
        console.log(`🔍 [DEBUG MODE] Testing question mode flow - no real AI processing`);
      }

      // Step 1: Classification
      const { getModelConfig } = await import('../../config/aiModels.js');
      const modelConfig = getModelConfig(model);
      const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
      
      const logStep1Complete = logStep('Classification', 'gemini-2.0-flash-lite');
      let imageClassification;
      if (debug) {
        // Mock classification for debug mode - force question mode
        imageClassification = {
          isQuestionOnly: true,
          reasoning: 'Debug mode: Mock classification reasoning',
          apiUsed: 'Debug Mode - Mock Response',
          extractedQuestionText: 'Debug mode: Mock question text',
          usageTokens: 100
        };
      } else {
        imageClassification = await this.classifyImageWithAI(imageData, model, debug);
      }
      logStep1Complete();
      
      // Debug: Log classification result
      console.log(`🔍 [CLASSIFICATION RESULT] isQuestionOnly: ${imageClassification.isQuestionOnly}, reasoning: ${imageClassification.reasoning}`);
      console.log(`🔍 [CLASSIFICATION DETAILS] apiUsed: ${imageClassification.apiUsed}, extractedText: ${imageClassification.extractedQuestionText?.substring(0, 100)}...`);
      
    const classificationTokens = imageClassification.usageTokens || 0;
    
    // Step 2: Question detection
    const logStep2Complete = logStep('Question Detection', 'database-lookup');
    let questionDetection: QuestionDetectionResult | undefined;
    if (imageClassification.extractedQuestionText) {
      try {
        questionDetection = await questionDetectionService.detectQuestion(
          imageClassification.extractedQuestionText
        );
      } catch (error) {
        questionDetection = { found: false, message: 'Question detection service failed' };
      }
    } else {
      questionDetection = { found: false, message: 'No question text extracted' };
    }
    logStep2Complete();

    // Determine mode and set total steps
    const isQuestionMode = imageClassification.isQuestionOnly;
    totalSteps = isQuestionMode ? 3 : 7; // Question mode: 3 steps, Marking mode: 7 steps

    // Complete analyzing image step and move to classification
    progressTracker.completeCurrentStep();
    
    // Add delay to show step 0 completion before starting step 1
    await new Promise(resolve => setTimeout(resolve, 800));
    
    progressTracker.startStep('classifying_image');
    progressTracker.completeCurrentStep();
    
    // Add delay to show step 1 completion before starting step 2
    await new Promise(resolve => setTimeout(resolve, 800));

    // Debug: Log mode decision
    console.log(`🔍 [MODE DECISION] isQuestionOnly: ${imageClassification.isQuestionOnly} -> ${imageClassification.isQuestionOnly ? 'QUESTION MODE (3 steps)' : 'MARKING MODE (7 steps)'}`);
    
    // If question-only, generate session title but don't create session yet
    if (imageClassification.isQuestionOnly) {
      // The progress tracker is already initialized with question mode steps
      // Just continue with the current step progression
      let sessionTitle = `Question ${new Date().toLocaleDateString()}`;
      let isPastPaper = false;

      // Generate session title based on question detection
      if (questionDetection?.found && (questionDetection as any).match) {
        const match: any = (questionDetection as any).match;
        const questionNumber = match.questionNumber || 'Unknown';
        const board = match.board || 'Unknown';
        const qualification = match.qualification || 'Unknown';
        const paperCode = match.paperCode || 'Unknown';
        const year = match.year || 'Unknown';
        sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber} (${year})`;
        isPastPaper = true; // This is a recognized past paper question
      } else {
        // For non-past-paper questions, use common title generation
        sessionTitle = generateNonPastPaperTitle(imageClassification.extractedQuestionText, 'Question');
        isPastPaper = false; // Not a recognized past paper
      }

      // Calculate processing time for question-only mode
      const totalProcessingTime = Date.now() - startTime;

      // Start AI response step
      progressTracker.startStep('generating_response');

      // For question-only mode, generate simple AI tutoring response
      const logQuestionComplete = logStep('Question Mode AI Response', 'gemini-2.0-flash-lite');
      let chatResponse;
      try {
        const { AIMarkingService } = await import('../aiMarkingService.js');
        chatResponse = await AIMarkingService.generateChatResponse(
          imageData,
          'Please solve this math question step by step and explain each step clearly.',
          model as any, // Convert to SimpleModelType
          true, // isQuestionOnly
          debug
          // Don't pass onProgress callback - let the main progress tracker handle all progress updates
        );
      } catch (error) {
        // Fallback response if AI service fails
        chatResponse = {
          response: 'I can see your question! For the best tutoring experience, please use the chat interface where I can provide step-by-step guidance and ask follow-up questions to help you understand the concept.',
          apiUsed: 'Fallback'
        };
      }
      logQuestionComplete();

      // Complete AI response step
      progressTracker.completeCurrentStep();

      // Add small delay before finishing to allow frontend to show final step
      await new Promise(resolve => setTimeout(resolve, 500));

      // Don't call finish() here - let the mark-homework route handle it when sending the complete event

      return {
        success: true,
        isQuestionOnly: true,
        message: chatResponse.response,
        apiUsed: chatResponse.apiUsed,
        model,
        reasoning: imageClassification.reasoning,
        questionDetection,
        classification: imageClassification,
        sessionId: null, // Will be set by route
        sessionTitle: sessionTitle,
        messageId: aiMessageId, // Include the provided aiMessageId
        isPastPaper: isPastPaper,
        progressData: finalProgressData, // Add progress data for chat history
        ocrMethod: 'Question-Only Mode - No OCR Required',
        timestamp: new Date().toISOString(),
        metadata: {
          resultId: `question-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          processingTime: new Date().toISOString(),
          totalProcessingTimeMs: totalProcessingTime,
          modelUsed: model,
          totalAnnotations: 0,
          imageSize: imageData.length,
          confidence: 0,
          tokens: [classificationTokens, 0] // [input, output]
        }
      } as unknown as MarkHomeworkResponse;
    } else {
      // Only run marking mode if NOT question mode
      console.log(`🔍 [PROGRESS TRACKER] Switching to MARKING MODE with 7 steps`);
      progressTracker = new ProgressTracker(getStepsForMode('marking'), (data) => {
        finalProgressData = data;
        if (onProgress) onProgress(data);
      });
      
      try {
    
      // Start with analyzing image step for marking mode
      progressTracker.startStep('analyzing_image');
      progressTracker.completeCurrentStep();
      
      // Add small delay to allow frontend to show step progression
      await new Promise(resolve => setTimeout(resolve, 300));
      
      progressTracker.startStep('classifying_image');
      progressTracker.completeCurrentStep();
      
      // Add small delay to allow frontend to show step progression
      await new Promise(resolve => setTimeout(resolve, 300));
      
      progressTracker.startStep('detecting_question');
      progressTracker.completeCurrentStep();
    
      // Continue with marking mode steps
      // Step 3: OCR
      const logStep3Complete = logStep('OCR Processing', 'google-vision + mathpix');
      progressTracker.startStep('extracting_text');
      const processedImage = await this.processImageWithRealOCR(imageData, debug);
    progressTracker.completeCurrentStep();
    logStep3Complete();

    // Step 4: Marking instructions
    const logStep4Complete = logStep('Marking Instructions', 'gemini-2.0-flash-lite');
    progressTracker.startStep('generating_feedback');
    const markingInstructions = await this.generateMarkingInstructions(
      imageData,
      model,
      processedImage,
      questionDetection
    );
    progressTracker.completeCurrentStep();
    logStep4Complete();

    // Step 5: Burn overlay
    const logStep5Complete = logStep('Burn Overlay', 'image-processing');
    progressTracker.startStep('creating_annotations');
    
    const annotations = markingInstructions.annotations.map(ann => ({
      bbox: ann.bbox,
      comment: (ann as any).text || '',
      action: ann.action,
      step_id: (ann as any).step_id,
      textMatch: (ann as any).textMatch
    }));
    const annotationResult = await ImageAnnotationService.generateAnnotationResult(
      imageData,
      annotations,
      processedImage.imageDimensions
    );
    progressTracker.completeCurrentStep();
    logStep5Complete();

    // Step 6: Generate AI response for marking mode
    const logStep6Complete = logStep('AI Response', 'gemini-2.0-flash-lite');
    progressTracker.startStep('generating_response');
    let markingChatResponse;
    try {
      const { AIMarkingService } = await import('../aiMarkingService');
      markingChatResponse = await AIMarkingService.generateChatResponse(
        imageData,
        'I have completed this work and would like feedback on my solution.',
        model as any, // Convert to SimpleModelType
        false, // isQuestionOnly = false for marking mode
        debug
      );
    } catch (error) {
      // Fallback response if AI service fails
      markingChatResponse = {
        response: 'I have reviewed your work and provided detailed feedback with annotations. Please review the marked areas and let me know if you have any questions about the feedback.',
        apiUsed: 'Fallback'
      };
    }
    progressTracker.completeCurrentStep();
    logStep6Complete();

    // Calculate processing time before saving
    const totalProcessingTime = Date.now() - startTime;

      // Complete final step - don't call finish() here as it's already called in question mode

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

    // Step 6: Create session for marking
    let sessionId: string | undefined;
    let sessionTitle: string;
    let isPastPaper = false;
    
    // Generate session title but don't create session yet
    if (questionDetection?.found && (questionDetection as any).match) {
      const match: any = (questionDetection as any).match;
      const examDetails = match.markingScheme?.examDetails || match;
      const board = examDetails.board || 'Unknown';
      const qualification = examDetails.qualification || 'Unknown';
      const paperCode = examDetails.paperCode || 'Unknown';
      const questionNumber = match.questionNumber || 'Unknown';
      sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber}`;
      isPastPaper = true; // This is a recognized past paper
    } else {
      // For non-past-paper marking, use common title generation
      sessionTitle = generateNonPastPaperTitle(imageClassification.extractedQuestionText, 'Marking');
      isPastPaper = false; // Not a recognized past paper
    }
    
    // Session will be created by the route with complete data
    sessionId = null;

    const response: MarkHomeworkResponse = {
      success: true,
      isQuestionOnly: false,
      result: processedImage,
      annotatedImage: annotationResult.annotatedImage,
      instructions: markingInstructions,
      message: markingChatResponse.response,
      apiUsed: markingChatResponse.apiUsed,
      ocrMethod: 'Enhanced OCR Processing',
      classification: imageClassification,
      questionDetection,
      sessionId,
      sessionTitle: sessionTitle,
      isPastPaper: isPastPaper
    } as unknown as MarkHomeworkResponse;

    return {
      ...response,
      messageId: aiMessageId, // Include the provided aiMessageId
      progressData: finalProgressData, // Add progress data for chat history
      metadata: {
        resultId: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        processingTime: new Date().toISOString(),
        totalProcessingTimeMs: totalProcessingTime,
        modelUsed: model,
        totalAnnotations: markingInstructions.annotations.length,
        imageSize: imageData.length,
        confidence: processedImage.confidence,
        tokens: [
          classificationTokens + ((markingInstructions as any).usage?.llmTokens || 0),
          (processedImage as any)?.mathpixCalls || 0
        ]
      }
    } as unknown as MarkHomeworkResponse;
      } catch (error) {
        // Handle quota exceeded errors immediately to prevent timeout
        if (error instanceof Error && error.message.includes('quota exceeded')) {
          console.error('❌ [QUOTA ERROR] API quota exceeded, failing fast:', error.message);
          throw error; // Re-throw immediately to prevent timeout
        }
        
        // Handle other errors
        console.error('❌ [MARKING ERROR] Unexpected error in MarkHomeworkWithAnswer.run():', error);
        throw error;
      }
    } // End of marking mode else block
    } catch (error) {
      // Handle quota exceeded errors immediately to prevent timeout
      if (error instanceof Error && error.message.includes('quota exceeded')) {
        console.error('❌ [QUOTA ERROR] API quota exceeded, failing fast:', error.message);
        throw error; // Re-throw immediately to prevent timeout
      }
      
      // Handle other errors
      console.error('❌ [MARKING ERROR] Unexpected error in MarkHomeworkWithAnswer.run():', error);
      throw error;
    }
  }
}

