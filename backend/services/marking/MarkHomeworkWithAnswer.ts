/**
 * MarkHomeworkWithAnswer Orchestrator
 * Implements the service-level flow described in docs/markanswer.md
 * Non-breaking: delegates to existing services and preserves response shape
 */

import { questionDetectionService } from '../../services/questionDetectionService.js';
import { ImageAnnotationService } from '../../services/imageAnnotationService.js';
import { getDebugMode } from '../../config/aiModels.js';
import { ProgressTracker, QUESTION_MODE_STEPS, MARKING_MODE_STEPS } from '../../utils/progressTracker.js';

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
    const { ClassificationService } = await import('../ai/ClassificationService');
    return ClassificationService.classifyImage(imageData, model, debug);
  }

  /**
   * Public method to get full hybrid OCR result with proper sorting for testing
   */
  public static async getHybridOCRResult(imageData: string, options?: any, debug: boolean = false): Promise<any> {
    const { HybridOCRService } = await import('../hybridOCRService');

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
    const { HybridOCRService } = await import('../hybridOCRService');

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
      const { LLMOrchestrator } = await import('../ai/LLMOrchestrator');
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
  }): Promise<MarkHomeworkResponse> {
    const startTime = Date.now();
    const { imageData, model, debug = false, onProgress } = params;
    const userId = params.userId || 'anonymous';
    const userEmail = params.userEmail || 'anonymous@example.com';

    // Create progress tracker IMMEDIATELY at the start
    let finalProgressData: any = null;
    const progressTracker = new ProgressTracker(MARKING_MODE_STEPS, (data) => {
      // Store the final progress data for chat history
      finalProgressData = data;
      // Call the original callback
      if (onProgress) onProgress(data);
    });

    // Start progress tracking immediately
    progressTracker.startStep('classification');

    // Debug mode: Return mock response
    if (debug) {
      console.log(`🔍 [DEBUG MODE] Returning mock response - no AI processing`);
    }
    if (debug) {
      await simulateApiDelay('Classification', debug);
      await simulateApiDelay('Question Detection', debug);
      await simulateApiDelay('Image Annotation', debug);
      
      return {
        success: true,
        isQuestionOnly: false,
        isPastPaper: false,
        classification: {
          isQuestionOnly: false,
          reasoning: 'Debug mode: Mock classification reasoning',
          apiUsed: 'Debug Mode - Mock Response',
          extractedQuestionText: 'Debug mode: Mock question text',
          usageTokens: 100
        },
        questionDetection: {
          found: true,
          message: 'Debug mode: Question detected',
          questionText: 'Debug mode: Mock question text'
        },
        instructions: {
          annotations: []
        },
        annotatedImage: imageData, // Return original image in debug mode
        metadata: {
          totalProcessingTimeMs: Date.now() - startTime,
          confidence: 0.95,
          imageSize: imageData.length,
          tokens: [100, 50, 200]
        },
        apiUsed: 'Debug Mode - Mock Response',
        ocrMethod: 'Debug Mode - Mock OCR'
      };
    }

    // Step 1: Classification
    const { getModelConfig } = await import('../../config/aiModels.js');
    const modelConfig = getModelConfig(model);
    const actualModelName = modelConfig.apiEndpoint.split('/').pop()?.replace(':generateContent', '') || model;
    
    console.log(`🔄 [STEP 1] Classification - ${actualModelName}`);
    const imageClassification = await this.classifyImageWithAI(imageData, model, debug);
    const classificationTokens = imageClassification.usageTokens || 0;
    
    // Step 2: Question detection
    console.log(`🔄 [STEP 2] Question Detection - ${actualModelName}`);
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

    // Complete classification step
    progressTracker.completeStep('classification');
    
    // Start question detection step
    progressTracker.startStep('question_detection');
    
    // Complete question detection step
    progressTracker.completeStep('question_detection');
    
    // Determine mode
    const isQuestionMode = imageClassification.isQuestionOnly;

    // If question-only, generate session title but don't create session yet
    if (imageClassification.isQuestionOnly) {
      // Switch to question mode progress tracker
      const questionProgressTracker = new ProgressTracker(QUESTION_MODE_STEPS, (data) => {
        finalProgressData = data;
        if (onProgress) onProgress(data);
      });
      // Copy current state
      questionProgressTracker.startStep('classification');
      questionProgressTracker.completeStep('classification');
      questionProgressTracker.startStep('question_detection');
      questionProgressTracker.completeStep('question_detection');
      questionProgressTracker.finish();
      
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
      
      // For question-only mode, generate simple AI tutoring response
      let chatResponse;
      try {
        const { AIMarkingService } = await import('../aiMarkingService');
        chatResponse = await AIMarkingService.generateChatResponse(
          imageData,
          'Please solve this math question step by step and explain each step clearly.',
          model as any, // Convert to SimpleModelType
          true, // isQuestionOnly
          debug
        );
      } catch (error) {
        // Fallback response if AI service fails
        chatResponse = {
          response: 'I can see your question! For the best tutoring experience, please use the chat interface where I can provide step-by-step guidance and ask follow-up questions to help you understand the concept.',
          apiUsed: 'Fallback'
        };
      }
      
      // Debug logging for progressData
      console.log('🔍 MarkHomeworkWithAnswer: Final progressData:', finalProgressData);
      console.log('🔍 MarkHomeworkWithAnswer: Question mode return');

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
    }

    // Continue with marking mode steps
    // Step 3: OCR
    console.log(`🔄 [STEP 3] OCR Processing - ${actualModelName}`);
    progressTracker.startStep('ocr_processing');
    const processedImage = await this.processImageWithRealOCR(imageData, debug);
    progressTracker.completeStep('ocr_processing');

    // Step 4: Marking instructions
    console.log(`🔄 [STEP 4] Marking Instructions - ${actualModelName}`);
    progressTracker.startStep('marking_instructions');
    const markingInstructions = await this.generateMarkingInstructions(
      imageData,
      model,
      processedImage,
      questionDetection
    );
    progressTracker.completeStep('marking_instructions');

    // Step 5: Burn overlay
    console.log(`🔄 [STEP 5] Burn Overlay - ${actualModelName}`);
    progressTracker.startStep('burn_overlay');
    
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
    progressTracker.completeStep('burn_overlay');

    // Step 6: Generate AI response for marking mode
    console.log(`🔄 [STEP 6] AI Response Generation - ${actualModelName}`);
    progressTracker.startStep('ai_response');
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
    progressTracker.completeStep('ai_response');

    // Calculate processing time before saving
    const totalProcessingTime = Date.now() - startTime;

    // Step 7: Data processed - session will be created by route
    console.log(`🔄 [STEP 7] Data Processing Complete - ${actualModelName}`);
    progressTracker.startStep('data_complete');
    progressTracker.finish();

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

    // Debug logging for progressData
    console.log('🔍 MarkHomeworkWithAnswer: Final progressData (marking mode):', finalProgressData);
    console.log('🔍 MarkHomeworkWithAnswer: Marking mode return');

    return {
      ...response,
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
  }
}

