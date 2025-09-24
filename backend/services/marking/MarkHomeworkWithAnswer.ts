/**
 * MarkHomeworkWithAnswer Orchestrator
 * Implements the service-level flow described in docs/markanswer.md
 * Non-breaking: delegates to existing services and preserves response shape
 */

import { questionDetectionService } from '../../services/questionDetectionService.js';
import { ImageAnnotationService } from '../../services/imageAnnotationService.js';
import { getDebugMode } from '../../config/aiModels.js';

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
  }): Promise<MarkHomeworkResponse> {
    const startTime = Date.now();
    const { imageData, model, debug = false } = params;
    const userId = params.userId || 'anonymous';
    const userEmail = params.userEmail || 'anonymous@example.com';

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
    console.log(`🔄 [STEP 1] Classification - ${model}`);
    const imageClassification = await this.classifyImageWithAI(imageData, model, debug);
    const classificationTokens = imageClassification.usageTokens || 0;
    
    // Step 1.5: Question detection
    console.log(`🔄 [STEP 1.5] Question Detection`);
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

    // If question-only, generate session title but don't create session yet
    if (imageClassification.isQuestionOnly) {
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
          'I have a question that I need help with. Can you assist me?',
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

    // Step 2: OCR
    console.log(`🔄 [STEP 2] OCR Processing`);
    const processedImage = await this.processImageWithRealOCR(imageData, debug);

    // Step 3: Marking instructions
    console.log(`🔄 [STEP 3] Marking Instructions - ${model}`);
    const markingInstructions = await this.generateMarkingInstructions(
      imageData,
      model,
      processedImage,
      questionDetection
    );

    // Step 4: Burn overlay
    console.log(`🔄 [STEP 4] Burn Overlay`);
    
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

    // Step 4.5: Generate AI response for marking mode
    console.log(`🔄 [STEP 4.5] AI Response Generation - ${model}`);
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

    // Calculate processing time before saving
    const totalProcessingTime = Date.now() - startTime;

    // Step 5: Data processed - session will be created by route
    console.log(`🔄 [STEP 5] Data Processing Complete`);

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

