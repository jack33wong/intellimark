/**
 * MarkHomeworkWithAnswer Orchestrator
 * Implements the service-level flow described in docs/markanswer.md
 * Non-breaking: delegates to existing services and preserves response shape
 */

import { questionDetectionService } from '../../services/questionDetectionService';
import { ImageAnnotationService } from '../../services/imageAnnotationService';

import type {
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ModelType,
  QuestionDetectionResult
} from '../../types/index';

/**
 * Lightweight adapter around existing services to centralize the flow.
 * Mirrors backend/routes/mark-homework.ts behavior.
 */
export class MarkHomeworkWithAnswer {
  /**
   * Classify image using AI
   */
  private static async classifyImageWithAI(imageData: string, model: ModelType): Promise<ImageClassification> {
    const { ClassificationService } = await import('../ai/ClassificationService');
    return ClassificationService.classifyImage(imageData, model);
  }

  /**
   * Public method to get full hybrid OCR result with proper sorting for testing
   */
  public static async getHybridOCRResult(imageData: string, options?: any): Promise<any> {
    const { HybridOCRService } = await import('../hybridOCRService');

    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10,
      ...options
    });

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
  private static async processImageWithRealOCR(imageData: string): Promise<ProcessedImageResult & { mathpixCalls?: number }> {
    const { HybridOCRService } = await import('../hybridOCRService');

    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });

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
  }): Promise<MarkHomeworkResponse> {
    const startTime = Date.now();
    const { imageData, model } = params;
    const userId = params.userId || 'anonymous';
    const userEmail = params.userEmail || 'anonymous@example.com';

    // Step 1: Classification
    const imageClassification = await this.classifyImageWithAI(imageData, model);
    const classificationTokens = imageClassification.usageTokens || 0;

    // Step 1.5: Question detection
    let questionDetection: QuestionDetectionResult | undefined;
    if (imageClassification.extractedQuestionText) {
      try {
        questionDetection = await questionDetectionService.detectQuestion(
          imageClassification.extractedQuestionText
        );
      } catch (_e) {
        questionDetection = { found: false, message: 'Question detection service failed' };
      }
    } else {
      questionDetection = { found: false, message: 'No question text extracted' };
    }

    // If question-only, generate session title but don't create session yet
    if (imageClassification.isQuestionOnly) {
      let sessionTitle = `Question - ${new Date().toLocaleDateString()}`;
      
      // Generate session title based on question detection
      if (questionDetection?.found && (questionDetection as any).match) {
        const match: any = (questionDetection as any).match;
        const questionNumber = match.questionNumber || 'Unknown';
        const board = match.board || 'Unknown';
        const qualification = match.qualification || 'Unknown';
        const paperCode = match.paperCode || 'Unknown';
        const year = match.year || 'Unknown';
        sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber} (${year})`;
      } else if (imageClassification.extractedQuestionText) {
        // For non-exam paper questions, use first 20 characters of question text
        const questionText = imageClassification.extractedQuestionText.trim();
        const truncatedText = questionText.length > 20 
          ? questionText.substring(0, 20) + '...' 
          : questionText;
        sessionTitle = `Question: ${truncatedText}`;
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
          true // isQuestionOnly
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
        sessionId: null, // Will be set by route
        sessionTitle: sessionTitle,
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
    const processedImage = await this.processImageWithRealOCR(imageData);

    // Step 3: Marking instructions
    const markingInstructions = await this.generateMarkingInstructions(
      imageData,
      model,
      processedImage,
      questionDetection
    );

    // Step 4: Burn overlay
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

    // Calculate processing time before saving
    const totalProcessingTime = Date.now() - startTime;

    // Step 5: Data processed - session will be created by route

    // Step 6: Create session for marking
    let sessionId: string | undefined;
    let sessionTitle = `Marking - ${new Date().toLocaleDateString()}`;
    
    // Generate session title but don't create session yet
    if (questionDetection?.found && (questionDetection as any).match) {
      const match: any = (questionDetection as any).match;
      const examDetails = match.markingScheme?.examDetails || match;
      const board = examDetails.board || 'Unknown';
      const qualification = examDetails.qualification || 'Unknown';
      const paperCode = examDetails.paperCode || 'Unknown';
      const questionNumber = match.questionNumber || 'Unknown';
      sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber}`;
    }
    
    // Session will be created by the route with complete data
    sessionId = null;

    const response: MarkHomeworkResponse = {
      success: true,
      isQuestionOnly: false,
      result: processedImage,
      annotatedImage: annotationResult.annotatedImage,
      instructions: markingInstructions,
      message: 'Question marked successfully with burned annotations',
      apiUsed: 'Complete AI Marking System with Burned Overlays',
      ocrMethod: 'Enhanced OCR Processing',
      classification: imageClassification,
      questionDetection,
      sessionId,
      sessionTitle: sessionTitle
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


