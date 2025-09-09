/**
 * Complete Mark Question API Route
 * Full implementation with real service integration
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { questionDetectionService } from '../services/questionDetectionService';
import { ImageAnnotationService } from '../services/imageAnnotationService';
import { optionalAuth } from '../middleware/auth';
import admin from 'firebase-admin';
import { ChatSessionManager } from '../services/chatSessionManager';

// Get Firestore instance
const db = admin.firestore();

// Import only the basic types we need
import type { 
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ModelType,
  QuestionDetectionResult
} from '../types/index';

// Simple model validation function to avoid import issues
function validateModelConfig(modelType: string): boolean {
  const validModels = ['gemini-2.5-pro', 'chatgpt-5', 'chatgpt-4o'];
  return validModels.includes(modelType);
}

const VERBOSE = process.env.VERBOSE_LOGS === '1';

const router = express.Router();


/**
 * Real AI image classification using simplified AI service
 */
async function classifyImageWithAI(imageData: string, model: ModelType): Promise<ImageClassification> {
  try {
    // Import the AI marking service to avoid circular dependencies
    const { AIMarkingService } = await import('../services/aiMarkingService');
    // Use AI marking service for classification
    const classification = await AIMarkingService.classifyImage(imageData, model);
    return classification;
  } catch (error) {
    console.error('❌ Real AI classification failed:', error);
    const imageSize = imageData.length;
    const hasStudentWork = imageSize > 200;
    return {
      isQuestionOnly: !hasStudentWork,
      reasoning: `AI classification failed: ${error instanceof Error ? error.message : 'Unknown error'}. Using fallback logic.`,
      apiUsed: 'Fallback Classification',
      extractedQuestionText: 'Unable to extract question text - AI service unavailable'
    };
  }
}

/**
 * Real OCR processing using Google Cloud Vision service
 */
async function processImageWithRealOCR(imageData: string): Promise<ProcessedImageResult> {
  try {
    const { HybridOCRService } = await import('../services/hybridOCRService');
    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });

    // Build per-line bounding boxes from Vision word boxes
    const words: Array<{ x: number; y: number; width: number; height: number; text?: string; confidence?: number }>
      = Array.isArray(hybridResult.boundingBoxes) ? hybridResult.boundingBoxes as any[] : [];

    const lineThreshold = 12; // px tolerance to group words on same line
    const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);

    type LineAcc = {
      segments: Array<{ x: number; y: number; width: number; height: number; text: string; confidence: number }>;
    };
    const lineAccs: LineAcc[] = [];

    for (const w of sorted) {
      const seg = { x: w.x, y: w.y, width: w.width, height: w.height, text: (w.text || '').trim(), confidence: w.confidence || 0 };
      if (lineAccs.length === 0) {
        lineAccs.push({ segments: [seg] });
        continue;
      }
      const last = lineAccs[lineAccs.length - 1];
      const lastY = last.segments[0]?.y ?? seg.y;
      if (Math.abs(seg.y - lastY) <= lineThreshold) {
        last.segments.push(seg);
      } else {
        lineAccs.push({ segments: [seg] });
      }
    }

    const lines = lineAccs.map(acc => {
      const segs = acc.segments.sort((a, b) => a.x - b.x);
      const minX = Math.min(...segs.map(s => s.x));
      const minY = Math.min(...segs.map(s => s.y));
      const maxX = Math.max(...segs.map(s => s.x + s.width));
      const maxY = Math.max(...segs.map(s => s.y + s.height));
      const text = segs.map(s => s.text).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const conf = segs.reduce((a, s) => a + (s.confidence || 0), 0) / Math.max(1, segs.length);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, text, confidence: conf };
    });

    const processedResult: ProcessedImageResult = {
      ocrText: hybridResult.text,
      boundingBoxes: lines.map(l => ({ x: l.x, y: l.y, width: l.width, height: l.height, text: l.text, confidence: l.confidence })),
      confidence: hybridResult.confidence,
      imageDimensions: hybridResult.dimensions,
      isQuestion: false
    };


    return processedResult;
  } catch (error) {
    console.error('❌ Enhanced OCR processing failed:', error);
    throw new Error(`Enhanced OCR processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * NEW 3-STEP LLM FLOW: Real AI marking service using the new 3-step LLM pipeline
 */
async function generateRealMarkingInstructionsWithNewFlow(
  imageData: string, 
  model: ModelType, 
  processedImage: ProcessedImageResult,
  questionDetection?: QuestionDetectionResult
): Promise<MarkingInstructions> {
  try {
    const { AIMarkingService } = await import('../services/aiMarkingService');
    const simpleMarkingInstructions = await AIMarkingService.generateMarkingInstructionsWithNewFlow(
      imageData, 
      model, 
      processedImage,
      questionDetection
    );
    const markingInstructions: MarkingInstructions = {
      annotations: simpleMarkingInstructions.annotations.map(annotation => ({
        action: annotation.action,
        bbox: annotation.bbox,
        ...(annotation.comment && { comment: annotation.comment }),
        ...(annotation.text && { text: annotation.text })
      }))
    };
    return markingInstructions;
  } catch (error) {
    console.error('❌ NEW 3-STEP FLOW marking instructions failed:', error);
    return await generateRealMarkingInstructionsLegacy(
      imageData, 
      model, 
      processedImage,
      questionDetection
    );
  }
}

/**
 * LEGACY: Real AI marking service using simplified AI service (kept for fallback)
 */
async function generateRealMarkingInstructionsLegacy(
  imageData: string, 
  model: ModelType, 
  processedImage: ProcessedImageResult,
  questionDetection?: QuestionDetectionResult
): Promise<MarkingInstructions> {
  try {
    const { AIMarkingService } = await import('../services/aiMarkingService');
    const simpleMarkingInstructions = await AIMarkingService.generateMarkingInstructions(
      imageData, 
      model, 
      processedImage,
      questionDetection
    );
    const markingInstructions: MarkingInstructions = {
      annotations: simpleMarkingInstructions.annotations.map(annotation => ({
        action: annotation.action,
        bbox: annotation.bbox,
        ...(annotation.comment && { comment: annotation.comment }),
        ...(annotation.text && { text: annotation.text })
      }))
    };
    return markingInstructions;
  } catch (error) {
    console.error('❌ Real AI marking instructions failed:', error);
    // Fallback basic marking preserved as-is
    const annotations = [] as any[];
    if (processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      processedImage.boundingBoxes.forEach((bbox, index) => {
        const text = bbox.text.toLowerCase();
        let action: 'tick' | 'circle' | 'underline' | 'comment' = 'tick';
        let comment = '';
        if (text.includes('step') || text.includes('solution')) { action = 'tick'; comment = 'Verify each step carefully'; }
        else if (text.includes('=') || text.includes('±') || text.includes('√') || text.includes('÷')) { action = 'tick'; comment = 'Check mathematical operations'; }
        else if (text.includes('x²') || text.includes('quadratic') || text.includes('equation')) { action = 'underline'; comment = 'Ensure problem is correctly identified'; }
        else if (text.includes('a =') || text.includes('b =') || text.includes('c =') || text.includes('coefficients')) { action = 'circle'; comment = 'Verify parameter values'; }
        else if (text.includes('formula') || text.includes('discriminant') || text.includes('δ')) { action = 'tick'; comment = 'Confirm formula application'; }
        else if (text.includes('answer') || text.includes('x =')) { action = 'tick'; comment = 'Double-check final answer'; }
        else if (text.includes('find') || text.includes('value')) { action = 'underline'; comment = 'Ensure problem statement is clear'; }
        else {
          const actions = ['tick', 'circle', 'underline', 'comment'] as const;
          action = actions[index % actions.length];
          comment = action === 'tick' ? 'Verify mathematical work'
            : action === 'circle' ? 'Check calculation approach'
            : action === 'underline' ? 'Review method carefully'
            : 'Ensure accuracy';
        }
        annotations.push({ action, bbox: [bbox.x, bbox.y, bbox.width, bbox.height] as [number, number, number, number], comment });
      });
    }
    if (annotations.length > 0) {
      annotations.push({ action: 'comment' as const, bbox: [50, 500, 400, 80] as [number, number, number, number], text: 'Please verify your final calculations and ensure all steps are clearly shown.' });
    }
    return { annotations };
  }
}

/**
 * Save marking results to Firestore database
 */
async function saveMarkingResults(
  imageData: string,
  model: string,
  result: ProcessedImageResult,
  instructions: MarkingInstructions,
  classification: ImageClassification,
  userId: string = 'anonymous',
  userEmail: string = 'anonymous@example.com'
): Promise<string> {
  try {
    const { FirestoreService } = await import('../services/firestoreService');
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
  } catch (error) {
    console.error('❌ Failed to save marking results to Firestore:', error);
    const resultId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return resultId;
  }
}

/**
 * POST /mark-homework
 */
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  const { imageData, model = 'chatgpt-4o' } = req.body;
  if (!imageData) return res.status(400).json({ success: false, error: 'Image data is required' });
  if (!validateModelConfig(model)) return res.status(400).json({ success: false, error: 'Valid AI model is required' });

  try {
    // Get user information early
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';

    // Step 1: AI classification
    const imageClassification = await classifyImageWithAI(imageData, model);
    // Step 1.5: Question detection
    let questionDetection: QuestionDetectionResult | undefined;
    if (imageClassification.extractedQuestionText) {
      try {
        questionDetection = await questionDetectionService.detectQuestion(imageClassification.extractedQuestionText);
      } catch (_e) {
        questionDetection = { found: false, message: 'Question detection service failed' };
      }
    } else {
      questionDetection = { found: false, message: 'No question text extracted' };
    }

    if (imageClassification.isQuestionOnly) {
      // Create chat session for question-only images
      let sessionId: string | undefined;
      try {
        const sessionManager = ChatSessionManager.getInstance();
        
        // Generate proper session title with exam details for question-only
        let sessionTitle = `Question - ${new Date().toLocaleDateString()}`;
        if (questionDetection?.found && questionDetection.match) {
          const questionNumber = questionDetection.match.questionNumber || 'Unknown';
          const board = questionDetection.match.board || 'Unknown';
          const qualification = questionDetection.match.qualification || 'Unknown';
          const paperCode = questionDetection.match.paperCode || 'Unknown';
          const year = questionDetection.match.year || 'Unknown';
          sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber} (${year})`;
        }
        
        sessionId = await sessionManager.createSession({
          title: sessionTitle,
          messages: [],
          userId: userId,
          messageType: 'Question'
        });
      } catch (error) {
        console.error('❌ Failed to create chat session for question-only:', error);
        // Continue without sessionId - frontend will handle gracefully
      }
      
      return res.json({ 
        success: true, 
        isQuestionOnly: true, 
        message: 'Image classified as question only - use chat interface for tutoring', 
        apiUsed: imageClassification.apiUsed, 
        model, 
        reasoning: imageClassification.reasoning, 
        questionDetection, 
        sessionId: sessionId,
        timestamp: new Date().toISOString() 
      });
    }

    // Step 2: OCR
    const processedImage = await processImageWithRealOCR(imageData);

    // Step 3: Marking (new flow)
    const markingInstructions = await generateRealMarkingInstructionsWithNewFlow(imageData, model, processedImage, questionDetection);

    // Step 4: Burn overlay
    const annotations = markingInstructions.annotations.map(ann => ({ bbox: ann.bbox, comment: ann.text || '', action: ann.action }));
    const annotationResult = await ImageAnnotationService.generateAnnotationResult(imageData, annotations, processedImage.imageDimensions);

    // Step 5: Save
    const resultId = await saveMarkingResults(imageData, model, processedImage, markingInstructions, imageClassification, userId, userEmail);

    // Step 5.5: Create chat session for question+answer images
    let sessionId: string | undefined;
    try {
      const sessionManager = ChatSessionManager.getInstance();
      
      // Generate proper session title with exam details
      let sessionTitle = `Marking - ${new Date().toLocaleDateString()}`;
      if (questionDetection?.found && questionDetection.match) {
        const examDetails = questionDetection.match.markingScheme?.examDetails || questionDetection.match;
        const board = examDetails.board || 'Unknown';
        const qualification = examDetails.qualification || 'Unknown';
        const paperCode = examDetails.paperCode || 'Unknown';
        const questionNumber = questionDetection.match.questionNumber || 'Unknown';
        
        sessionTitle = `${board} ${qualification} ${paperCode} - Q${questionNumber}`;
      }
      
      sessionId = await sessionManager.createSession({
        title: sessionTitle,
        messages: [],
        userId: userId,
        messageType: 'Marking'
      });
    } catch (error) {
      console.error('❌ Failed to create chat session for marking:', error);
      // Continue without sessionId - frontend will handle gracefully
    }

    // Step 6: Respond
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
      sessionId: sessionId
    };

    const enhancedResponse = {
      ...response,
      metadata: {
        resultId,
        processingTime: new Date().toISOString(),
        modelUsed: model,
        totalAnnotations: markingInstructions.annotations.length,
        imageSize: imageData.length,
        confidence: processedImage.confidence
      }
    };

    return res.json(enhancedResponse);
  } catch (error) {
    console.error('Error in complete mark question:', error);
    return res.status(500).json({ success: false, error: 'Internal server error in mark question system', details: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Contact support' });
  }
});


/**
 * GET /mark-homework/stats
 * Get system statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    
    // Import and use the real Firestore service
    const { FirestoreService } = await import('../services/firestoreService');
    
    // Get system statistics from Firestore
    const stats = await FirestoreService.getSystemStats();
    
    return res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error retrieving system statistics:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve system statistics'
    });
  }
});

/**
 * GET /mark-homework/health
 * Health check for mark question system
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'Complete Mark Question System',
    features: [
      'AI Image Classification',
      'Real OCR Processing',
      'AI Marking Instructions',
      'Professional SVG Overlays',
      'Real Firestore Database Storage',
      'User History & Statistics'
    ],
    timestamp: new Date().toISOString()
  });
});


export default router;
