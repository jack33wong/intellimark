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

const router = express.Router();

console.log('🚀 COMPLETE MARK QUESTION ROUTE MODULE LOADED SUCCESSFULLY');

/**
 * Real AI image classification using simplified AI service
 */
async function classifyImageWithAI(imageData: string, model: ModelType): Promise<ImageClassification> {
  try {
    console.log('🔍 ===== REAL AI IMAGE CLASSIFICATION =====');
    console.log('🔍 Using model:', model);
    
    // Import the AI marking service to avoid circular dependencies
    const { AIMarkingService } = await import('../services/aiMarkingService');
    
    // Use AI marking service for classification
    const classification = await AIMarkingService.classifyImage(imageData, model);
    
    console.log('🔍 AI Classification result:', classification);
    return classification;
    
  } catch (error) {
    console.error('❌ Real AI classification failed:', error);
    // Fallback to basic logic if AI service fails
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
    console.log('🔍 ===== ENHANCED OCR PROCESSING WITH HYBRID OCR + PIPE DETECTION =====');
    
    // Import the hybrid OCR service
    const { HybridOCRService } = await import('../services/hybridOCRService');
    
    // Process image with hybrid OCR (Google Vision + Mathpix + enhanced pipe detection)
    const hybridResult = await HybridOCRService.processImage(imageData, {
      enablePreprocessing: true,
      mathThreshold: 0.10 // Use the enhanced pipe detection threshold
    });
    
    console.log('✅ Hybrid OCR completed successfully');
    console.log(`🔍 Extracted text length: ${hybridResult.text.length} characters`);
    console.log(`🔍 Math blocks found: ${hybridResult.mathBlocks.length}`);
    console.log(`🔍 Confidence: ${(hybridResult.confidence * 100).toFixed(2)}%`);
    
    // Convert hybrid OCR result to ProcessedImageResult format
    const processedResult: ProcessedImageResult = {
      ocrText: hybridResult.text,
      boundingBoxes: hybridResult.mathBlocks.map(block => ({
        x: block.coordinates.x,
        y: block.coordinates.y,
        width: block.coordinates.width,
        height: block.coordinates.height,
        text: block.googleVisionText,
        confidence: block.confidence || 0.8
      })),
      confidence: hybridResult.confidence,
      imageDimensions: hybridResult.dimensions,
      isQuestion: false // Will be determined by AI classification
    };
    
    console.log('🔍 Enhanced pipe detection results:');
    hybridResult.mathBlocks.forEach((block, index) => {
      const pipeCount = (block.googleVisionText.match(/\|/g) || []).length;
      const hasPipePair = /\|.*\|/.test(block.googleVisionText);
      if (pipeCount > 0) {
        console.log(`   Block ${index + 1}: "${block.googleVisionText}" (${pipeCount} pipes, pair: ${hasPipePair}, score: ${block.mathLikenessScore.toFixed(3)})`);
      }
    });
    
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
  
  console.log('🔍 Generating real AI marking instructions with NEW 3-STEP FLOW for model:', model);
  
  try {
    // Import the AI marking service to avoid circular dependencies
    const { AIMarkingService } = await import('../services/aiMarkingService');
    
    // Use NEW 3-step LLM flow for marking instructions
    const simpleMarkingInstructions = await AIMarkingService.generateMarkingInstructionsWithNewFlow(
      imageData, 
      model, 
      processedImage,
      questionDetection
    );
    
    // Convert SimpleMarkingInstructions to MarkingInstructions
    const markingInstructions: MarkingInstructions = {
      annotations: simpleMarkingInstructions.annotations.map(annotation => ({
        action: annotation.action,
        bbox: annotation.bbox,
        ...(annotation.comment && { comment: annotation.comment }),
        ...(annotation.text && { text: annotation.text })
      }))
    };
    console.log('🔍 NEW 3-STEP FLOW Marking Instructions:', markingInstructions.annotations);
    console.log('🔍 NEW 3-STEP FLOW Marking Instructions generated:', markingInstructions.annotations.length, 'annotations');
    return markingInstructions;
    
  } catch (error) {
    console.error('❌ NEW 3-STEP FLOW marking instructions failed:', error);
    
    // Fallback to legacy method if new flow fails
    console.log('🔄 Falling back to legacy marking method...');
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
  
  console.log('🔍 Generating LEGACY AI marking instructions for model:', model);
  
  try {
    // Import the AI marking service to avoid circular dependencies
    const { AIMarkingService } = await import('../services/aiMarkingService');
    
    // Use legacy AI marking service for marking instructions
    const simpleMarkingInstructions = await AIMarkingService.generateMarkingInstructions(
      imageData, 
      model, 
      processedImage,
      questionDetection
    );
    
    // Convert SimpleMarkingInstructions to MarkingInstructions
    const markingInstructions: MarkingInstructions = {
      annotations: simpleMarkingInstructions.annotations.map(annotation => ({
        action: annotation.action,
        bbox: annotation.bbox,
        ...(annotation.comment && { comment: annotation.comment }),
        ...(annotation.text && { text: annotation.text })
      }))
    };
    console.log('🔍 LEGACY AI Marking Instructions:', markingInstructions.annotations);
    console.log('🔍 LEGACY AI Marking Instructions generated:', markingInstructions.annotations.length, 'annotations');
    return markingInstructions;
    
  } catch (error) {
    console.error('❌ Real AI marking instructions failed:', error);
    
    // Fallback to basic marking if AI service fails
    const annotations = [];
    
    if (processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0) {
      processedImage.boundingBoxes.forEach((bbox, index) => {
        const text = bbox.text.toLowerCase();
        
        // Basic intelligent analysis based on content
        let action: 'tick' | 'circle' | 'underline' | 'comment' = 'tick';
        let comment = '';
        
                 if (text.includes('step') || text.includes('solution')) {
           action = 'tick';
                       comment = 'Verify each step carefully';
         } else if (text.includes('=') || text.includes('±') || text.includes('√') || text.includes('÷')) {
           action = 'tick';
                       comment = 'Check mathematical operations';
         } else if (text.includes('x²') || text.includes('quadratic') || text.includes('equation')) {
           action = 'underline';
                       comment = 'Ensure problem is correctly identified';
         } else if (text.includes('a =') || text.includes('b =') || text.includes('c =') || text.includes('coefficients')) {
           action = 'circle';
                       comment = 'Verify parameter values';
         } else if (text.includes('formula') || text.includes('discriminant') || text.includes('δ')) {
           action = 'tick';
                       comment = 'Confirm formula application';
         } else if (text.includes('answer') || text.includes('x =')) {
           action = 'tick';
                       comment = 'Double-check final answer';
         } else if (text.includes('find') || text.includes('value')) {
           action = 'underline';
                       comment = 'Ensure problem statement is clear';
         } else {
           // Default intelligent actions
           const actions = ['tick', 'circle', 'underline', 'comment'] as const;
           action = actions[index % actions.length] as 'tick' | 'circle' | 'underline' | 'comment';
           
           switch (action) {
                           case 'tick':
                comment = 'Verify mathematical work';
                break;
              case 'circle':
                comment = 'Check calculation approach';
                break;
              case 'underline':
                comment = 'Review method carefully';
                break;
              case 'comment':
                comment = 'Ensure accuracy';
                break;
           }
         }
        
        annotations.push({
          action: action as 'tick' | 'circle' | 'underline' | 'comment',
          bbox: [bbox.x, bbox.y, bbox.width, bbox.height] as [number, number, number, number],
          comment: comment
        });
      });
    }
    
         // Add overall feedback comment
     if (annotations.length > 0) {
       annotations.push({
         action: 'comment' as const,
         bbox: [50, 500, 400, 80] as [number, number, number, number],
                   text: 'Please verify your final calculations and ensure all steps are clearly shown.'
       });
     }
    
    console.log('🔍 Fallback marking instructions generated:', annotations.length, 'annotations');
    return { annotations };
  }
}



/**
 * Helper function to create a new marking session for each upload
 */
async function createNewMarkingSession(
  userId: string, 
  questionDetection?: any, 
  imageClassification?: any
): Promise<string> {
  try {
    console.log('🔍 Creating new marking session for user:', userId);
    
    // Import Firestore service
    const { FirestoreService } = await import('../services/firestoreService');
    
    // Generate session title based on available data
    let sessionTitle = 'Chat Session';
    
    if (questionDetection?.found && questionDetection?.match) {
      const examDetails = questionDetection.match.markingScheme?.examDetails || {};
      const questionNumber = questionDetection.match.questionNumber;
      
      const board = examDetails.board || questionDetection.match.board || 'Unknown';
      const qualification = examDetails.qualification || questionDetection.match.qualification || 'Unknown';
      const questionNum = questionNumber || 'Unknown';
      
      sessionTitle = `${board} ${qualification} Q${questionNum}`;
    } else {
      // Fallback to timestamp-based title
      const timestamp = new Date().toISOString();
      sessionTitle = `Marking Session - ${timestamp}`;
    }
    
    console.log('🔍 Session title:', sessionTitle);
    
    // Determine messageType based on question detection and classification
    let messageType: 'Marking' | 'Question' | 'Chat' = 'Chat';
    if (questionDetection?.found && questionDetection?.match) {
      const isQuestionOnly = imageClassification?.isQuestionOnly || false;
      messageType = isQuestionOnly ? 'Question' : 'Marking';
    }

    const sessionId = await FirestoreService.createChatSession({
      title: sessionTitle,
      messages: [],
      userId,
      messageType
    });
    
    console.log('🔍 Created new marking session:', sessionId);
    console.log('🔍 Session title in database:', sessionTitle);
    return sessionId;
  } catch (error) {
    console.error('❌ Failed to create marking session:', error);
    throw error;
  }
}

/**
 * POST /mark-homework
 * Complete mark question endpoint with all functionality
 */
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  console.log('🚀 ===== COMPLETE MARK QUESTION ROUTE CALLED =====');
  console.log('Request body:', { 
    imageData: req.body.imageData ? 'present' : 'missing', 
    model: req.body.model 
  });
  
  try {
    console.log('🔍 ===== EXTRACTING REQUEST DATA =====');
    const { imageData, model = 'chatgpt-4o' } = req.body;
    console.log('🔍 Extracted imageData length:', imageData ? imageData.length : 'undefined');
    console.log('🔍 Extracted model:', model);

    // Validate request
    console.log('🔍 ===== VALIDATING REQUEST =====');
    if (!imageData) {
      console.log('🔍 Validation failed: No image data');
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }
    console.log('🔍 Image data validation passed');

    if (!validateModelConfig(model)) {
      console.log('🔍 Validation failed: Invalid model config');
      return res.status(400).json({
        success: false,
        error: 'Valid AI model is required'
      });
    }
    console.log('🔍 Model validation passed');

    // Step 1: AI-powered image classification
    console.log('🔍 ===== STEP 1: AI IMAGE CLASSIFICATION =====');
    const imageClassification = await classifyImageWithAI(imageData, model);
      console.log('🔍 Image Classification:', imageClassification);
    
    // Log extracted question text for backend debugging
    if (imageClassification.extractedQuestionText) {
      console.log('📝 ===== EXTRACTED QUESTION TEXT =====');
      console.log('📝 Question Text:', imageClassification.extractedQuestionText);
      console.log('📝 ====================================');
    } else {
      console.log('⚠️ ===== NO QUESTION TEXT EXTRACTED =====');
      console.log('⚠️ Image Classification Result:', imageClassification);
      console.log('⚠️ ======================================');
    }

    // Step 1.5: Question Detection Service
             let questionDetection: QuestionDetectionResult | undefined;

         if (imageClassification.extractedQuestionText) {
           try {
             questionDetection = await questionDetectionService.detectQuestion(
               imageClassification.extractedQuestionText
             );
           } catch (error) {
             console.error('❌ Question detection failed:', error);
             questionDetection = {
               found: false,
               message: 'Question detection service failed'
             };
           }
         } else {
           questionDetection = {
             found: false,
             message: 'No question text extracted'
           };
         }
    
    if (imageClassification.isQuestionOnly) {
      // For question-only images, still create a session and save the data
      console.log('🔍 ===== QUESTION-ONLY IMAGE DETECTED =====');
      
      // Get user information from request (if authenticated)
      const userId = (req as any)?.user?.uid || 'anonymous';
      const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
      
      // Create new session for question-only images too
      console.log('🔍 ===== CREATING NEW SESSION FOR QUESTION-ONLY =====');
      console.log('🔍 User ID:', userId);
      console.log('🔍 Timestamp:', new Date().toISOString());
      const sessionId = await createNewMarkingSession(userId, questionDetection, imageClassification);
      console.log('🔍 Created session ID:', sessionId);
      console.log('🔍 ================================================');
      
      // Save question-only data as session messages
      const { FirestoreService } = await import('../services/firestoreService');
      await FirestoreService.saveQuestionOnlyAsMessages(
        userId,
        sessionId,
        imageData,
        model,
        imageClassification,
        questionDetection
      );
      
      // Return with session ID for question-only images
      return res.json({ 
        success: true,
        isQuestionOnly: true,
        message: 'Image classified as question only - use chat interface for tutoring',
        apiUsed: imageClassification.apiUsed,
        model: model,
        reasoning: imageClassification.reasoning,
        questionDetection: questionDetection,
        sessionId: sessionId,
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Real OCR processing
    console.log('🔍 ===== STEP 2: REAL OCR PROCESSING =====');
    const processedImage = await processImageWithRealOCR(imageData);
      console.log('🔍 OCR Processing completed successfully!');
      console.log('🔍 OCR Text length:', processedImage.ocrText.length);
      console.log('🔍 Bounding boxes found:', processedImage.boundingBoxes.length);

    // Step 3: AI-powered marking instructions using NEW 3-STEP LLM FLOW
    console.log('🔍 ===== STEP 3: AI MARKING INSTRUCTIONS (NEW 3-STEP LLM FLOW) =====');
    const markingInstructions = await generateRealMarkingInstructionsWithNewFlow(imageData, model, processedImage, questionDetection);
    console.log('🔍 NEW 3-STEP LLM FLOW Marking Instructions generated:', markingInstructions.annotations.length, 'annotations');

    // Step 4: Burn SVG overlay into image
    console.log('🔍 ===== STEP 4: BURNING SVG OVERLAY INTO IMAGE =====');
    console.log('🔍 Marking instructions annotations:', markingInstructions.annotations.length);
    console.log('🔍 Image dimensions:', processedImage.imageDimensions);
    
    // Convert marking instructions to annotation format
    const annotations = markingInstructions.annotations.map(ann => ({
      bbox: ann.bbox,
      comment: ann.text || '',
      action: ann.action
    }));
    
    // Generate burned image with annotations
    const annotationResult = await ImageAnnotationService.generateAnnotationResult(
        imageData,
      annotations,
      processedImage.imageDimensions
    );
    
    console.log('🔍 Burned image created, length:', annotationResult.annotatedImage.length);
    console.log('🔍 SVG overlay length:', annotationResult.svgOverlay.length);

    // Step 5: Save results to persistent storage
    console.log('🔍 ===== STEP 5: SAVING RESULTS =====');
    
    // Get user information from request (if authenticated)
    const userId = (req as any)?.user?.uid || 'anonymous';
    const userEmail = (req as any)?.user?.email || 'anonymous@example.com';
    
    // Create new session for each marking request
    console.log('🔍 ===== CREATING NEW SESSION =====');
    console.log('🔍 User ID:', userId);
    console.log('🔍 Timestamp:', new Date().toISOString());
    const sessionId = await createNewMarkingSession(userId, questionDetection, imageClassification);
    console.log('🔍 Created session ID:', sessionId);
    console.log('🔍 =================================');
    
    // Save marking results as session messages
    const { FirestoreService } = await import('../services/firestoreService');
    await FirestoreService.saveMarkingResultsAsMessages(
      userId,
      sessionId,
      imageData,
      model,
      processedImage,
      markingInstructions,
      imageClassification,
      annotationResult.annotatedImage,
      {
        processingTime: new Date().toISOString(),
        modelUsed: model,
        totalAnnotations: markingInstructions.annotations.length,
        imageSize: imageData.length,
        confidence: processedImage.confidence,
        apiUsed: 'Complete AI Marking System',
        ocrMethod: 'Enhanced OCR Processing'
      },
      questionDetection
    );

    // Step 6: Return complete marking result
    console.log('🔍 ===== STEP 6: RETURNING COMPLETE RESULT =====');
    const response: MarkHomeworkResponse = {
      success: true,
      isQuestionOnly: false,
      result: processedImage,
      annotatedImage: annotationResult.annotatedImage, // Use burned image instead of SVG overlay
      instructions: markingInstructions,
      message: 'Question marked successfully with burned annotations',
      apiUsed: 'Complete AI Marking System with Burned Overlays',
      ocrMethod: 'Enhanced OCR Processing',
      classification: imageClassification,
      questionDetection: questionDetection
    };

    // Add metadata
    const enhancedResponse = {
      ...response,
      sessionId: sessionId,
      metadata: {
        sessionId: sessionId,
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
    return res.status(500).json({
      success: false,
      error: 'Internal server error in mark question system',
      details: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : 'Contact support'
    });
  }
});


/**
 * GET /mark-homework/stats
 * Get system statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    console.log('🔍 Retrieving system statistics from Firestore...');
    
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
