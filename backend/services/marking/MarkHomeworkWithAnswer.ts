/**
 * MarkHomeworkWithAnswer Orchestrator
 * Implements the service-level flow described in docs/markanswer.md
 * Non-breaking: delegates to existing services and preserves response shape
 */

import { questionDetectionService } from '../../services/questionDetectionService';
import { ImageAnnotationService } from '../../services/imageAnnotationService';
import { ChatSessionManager } from '../../services/chatSessionManager';

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
   * Process image with enhanced OCR
   */
  private static async processImageWithRealOCR(imageData: string): Promise<ProcessedImageResult> {
    const { HybridOCRService } = await import('../hybridOCRService');

    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });

    // Build OCR text from math blocks (consistent with current route logic)
    const sortedMathBlocks = [...hybridResult.mathBlocks].sort((a, b) => a.coordinates.y - b.coordinates.y);
    const processedOcrText = sortedMathBlocks
      .filter(block => block.mathpixLatex)
      .map(block => block.mathpixLatex as string)
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

    const processedResult: ProcessedImageResult = {
      ocrText: processedOcrText,
      boundingBoxes: processedBoundingBoxes,
      confidence: hybridResult.confidence,
      imageDimensions: hybridResult.dimensions,
      isQuestion: false
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
  ): Promise<MarkingInstructions> {
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
      return { annotations: [] };
    }
  }

  /**
   * Persist results via FirestoreService
   */
  private static async saveMarkingResults(
    imageData: string,
    model: string,
    result: ProcessedImageResult,
    instructions: MarkingInstructions,
    classification: ImageClassification,
    userId: string,
    userEmail: string
  ): Promise<string> {
    try {
      const { FirestoreService } = await import('../firestoreService');
      const resultId = await FirestoreService.saveMarkingResults(
        userId,
        userEmail,
        imageData,
        model,
        false,
        classification,
        result,
        instructions,
        undefined,
        {
          processingTime: new Date().toISOString(),
          modelUsed: model,
          totalAnnotations: instructions.annotations.length,
          imageSize: imageData.length,
          confidence: result.confidence,
          apiUsed: 'Complete AI Marking System',
          ocrMethod: 'Enhanced OCR Processing'
        }
      );
      return resultId;
    } catch (_err) {
      // Preserve current non-throwing fallback behavior
      return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    const { imageData, model } = params;
    const userId = params.userId || 'anonymous';
    const userEmail = params.userEmail || 'anonymous@example.com';

    // Step 1: Classification
    const imageClassification = await this.classifyImageWithAI(imageData, model);

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

    // If question-only, short-circuit like current route
    if (imageClassification.isQuestionOnly) {
      let sessionId: string | undefined;
      let sessionTitle = `Question - ${new Date().toLocaleDateString()}`;
      
      try {
        const sessionManager = ChatSessionManager.getInstance();
        if (questionDetection?.found && (questionDetection as any).match) {
          const match: any = (questionDetection as any).match;
          const questionNumber = match.questionNumber || 'Unknown';
          const board = match.board || 'Unknown';
          const qualification = match.qualification || 'Unknown';
          const paperCode = match.paperCode || 'Unknown';
          const year = match.year || 'Unknown';
          sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber} (${year})`;
        }
        sessionId = await sessionManager.createSession({
          title: sessionTitle,
          messages: [],
          userId,
          messageType: 'Question'
        });
      } catch (_err) {
        // swallow, maintain behavior
      }

      return {
        success: true,
        isQuestionOnly: true,
        message: 'Image classified as question only - use chat interface for tutoring',
        apiUsed: imageClassification.apiUsed,
        model,
        reasoning: imageClassification.reasoning,
        questionDetection,
        sessionId,
        sessionTitle: sessionTitle,
        timestamp: new Date().toISOString()
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
      action: ann.action
    }));
    const annotationResult = await ImageAnnotationService.generateAnnotationResult(
      imageData,
      annotations,
      processedImage.imageDimensions
    );

    // Step 5: Save
    const resultId = await this.saveMarkingResults(
      imageData,
      model,
      processedImage,
      markingInstructions,
      imageClassification,
      userId,
      userEmail
    );

    // Step 6: Create session for marking
    let sessionId: string | undefined;
    let sessionTitle = `Marking - ${new Date().toLocaleDateString()}`;
    
    try {
      const sessionManager = ChatSessionManager.getInstance();
      if (questionDetection?.found && (questionDetection as any).match) {
        const match: any = (questionDetection as any).match;
        const examDetails = match.markingScheme?.examDetails || match;
        const board = examDetails.board || 'Unknown';
        const qualification = examDetails.qualification || 'Unknown';
        const paperCode = examDetails.paperCode || 'Unknown';
        const questionNumber = match.questionNumber || 'Unknown';
        sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber}`;
      }
      sessionId = await sessionManager.createSession({
        title: sessionTitle,
        messages: [],
        userId,
        messageType: 'Marking'
      });
    } catch (_err) {
      // keep behavior: continue without sessionId
    }

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
        resultId,
        processingTime: new Date().toISOString(),
        modelUsed: model,
        totalAnnotations: markingInstructions.annotations.length,
        imageSize: imageData.length,
        confidence: processedImage.confidence
      }
    } as unknown as MarkHomeworkResponse;
  }
}


