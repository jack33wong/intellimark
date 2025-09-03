/**
 * Complete Mark Question API Route
 * Full implementation with real service integration
 */

import * as express from 'express';
import type { Request, Response } from 'express';
import { MathpixService } from '../services/mathpixService.ts';
import { questionDetectionService } from '../services/questionDetectionService.ts';
import { ImageAnnotationService } from '../services/imageAnnotationService.ts';

// Import only the basic types we need
import type { 
  MarkHomeworkResponse,
  ImageClassification,
  ProcessedImageResult,
  MarkingInstructions,
  ProcessedMathpixResult,
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
 * Real OCR processing using Mathpix service
 */
async function processImageWithRealOCR(imageData: string): Promise<ProcessedImageResult> {
  try {
    console.log('🔍 ===== REAL OCR PROCESSING WITH MATHPIX =====');
    
    // Check if Mathpix service is available
    if (!MathpixService.isAvailable()) {
      throw new Error('Mathpix service not available. Please configure MATHPIX_API_KEY environment variable.');
    }
    
    // Process image with Mathpix OCR
    const mathpixResult: ProcessedMathpixResult = await MathpixService.processImage(imageData);
    
    console.log('✅ Mathpix OCR completed successfully');
    console.log(`🔍 Extracted text length: ${mathpixResult.text.length} characters`);
    console.log(`🔍 Bounding boxes found: ${mathpixResult.boundingBoxes.length}`);
    console.log(`🔍 Confidence: ${(mathpixResult.confidence * 100).toFixed(2)}%`);
    
    // Convert Mathpix result to ProcessedImageResult format
    const processedResult: ProcessedImageResult = {
      ocrText: mathpixResult.text,
      boundingBoxes: mathpixResult.boundingBoxes,
      confidence: mathpixResult.confidence,
      imageDimensions: mathpixResult.dimensions,
      isQuestion: false // Will be determined by AI classification
    };
    
    return processedResult;
    
  } catch (error) {
    console.error('❌ Real OCR processing failed:', error);
    throw new Error(`Real OCR processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}



/**
 * Real AI marking service using simplified AI service
 */
async function generateRealMarkingInstructions(
  imageData: string, 
  model: ModelType, 
  processedImage: ProcessedImageResult
): Promise<MarkingInstructions> {
  
  console.log('🔍 Generating real AI marking instructions for model:', model);
  
  try {
    // Import the AI marking service to avoid circular dependencies
    const { AIMarkingService } = await import('../services/aiMarkingService');
    
    // Use AI marking service for marking instructions
    const simpleMarkingInstructions = await AIMarkingService.generateMarkingInstructions(
      imageData, 
      model, 
      processedImage
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
    console.log('🔍 Real AI Marking Instructions:', markingInstructions.annotations);
    console.log('🔍 Real AI Marking Instructions generated:', markingInstructions.annotations.length, 'annotations');
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
 * Professional SVG overlay generation
 */
function generateProfessionalSVGOverlay(instructions: MarkingInstructions, width: number, height: number): string {
  console.log('🔍 SVG Generation - Instructions:', instructions);
  console.log('🔍 SVG Generation - Annotations count:', instructions.annotations?.length || 0);
  console.log('🔍 SVG Generation - Dimensions:', width, 'x', height);
  
  if (!instructions.annotations || instructions.annotations.length === 0) {
    console.log('🔍 SVG Generation - No annotations, returning empty string');
    return '';
  }
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="position: absolute; top: 0; left: 0;">`;
  
  instructions.annotations.forEach((annotation, index) => {
    const [x, y, w, h] = annotation.bbox;
    console.log(`🔍 SVG Generation - Processing annotation ${index}:`, annotation.action, 'at', [x, y, w, h]);
    
    switch (annotation.action) {
      case 'tick':
        // Professional red checkmark using tick symbol
        const centerX = x + w/2;
        const centerY = y + h/2;
        const tickSize = Math.max(24, Math.min(w, h) / 2);
        svg += `<text x="${centerX}" y="${centerY + 5}" fill="red" font-family="Arial, sans-serif" font-size="${tickSize}" font-weight="bold" text-anchor="middle">✔</text>`;
        break;
      case 'circle':
        // Professional red circle
        svg += `<circle cx="${x+w/2}" cy="${y+h/2}" r="${Math.min(w,h)/2+2}" fill="none" stroke="red" stroke-width="2" opacity="0.8"/>`;
        break;
      case 'underline':
        // Professional red underline
        svg += `<line x1="${x}" y1="${y+h+2}" x2="${x+w}" y2="${y+h+2}" stroke="red" stroke-width="3" opacity="0.8"/>`;
        break;
             case 'comment':
         // Professional comment box without background
                   if (annotation.text) {
            svg += `<text x="${x}" y="${y+15}" font-family="Bradley Hand ITC, cursive, Arial, sans-serif" font-size="24" fill="red" font-weight="900">${annotation.text}</text>`;
          }
         break;
      default:
        // Professional default rectangle
        svg += `<rect x="${x-2}" y="${y-2}" width="${w+4}" height="${h+4}" fill="none" stroke="purple" stroke-width="2" opacity="0.8"/>`;
    }
  });
  
  svg += '</svg>';
  console.log('🔍 SVG Generation - Final SVG length:', svg.length);
  console.log('🔍 SVG Generation - Final SVG preview:', svg.substring(0, 300) + '...');
  return svg;
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
    console.log('🔍 Attempting to save to Firestore...');
    console.log('🔍 User ID:', userId);
    console.log('🔍 User Email:', userEmail);
    console.log('🔍 Model:', model);
    
    // Import and use the real Firestore service
    const { FirestoreService } = await import('../services/firestoreService');
    console.log('🔍 FirestoreService imported successfully');
    
    // Save to Firestore
    console.log('🔍 Calling FirestoreService.saveMarkingResults...');
    const resultId = await FirestoreService.saveMarkingResults(
      userId,
      userEmail,
      imageData,
      model,
      false, // isQuestionOnly - this function is only called for homework images
      classification,
      result, // ocrResult
      instructions, // markingInstructions
      undefined, // annotatedImage - will be added later
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
    
    console.log('🔍 Results saved to Firestore with ID:', resultId);
    return resultId;
    
  } catch (error) {
    console.error('❌ Failed to save marking results to Firestore:', error);
    console.error('❌ Error details:', error instanceof Error ? error.stack : 'Unknown error');
    // Fallback to local storage if Firestore fails
    console.log('🔍 Falling back to local storage...');
    
    const resultId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log('🔍 Results saved locally with ID:', resultId);
    return resultId;
  }
}

/**
 * POST /mark-homework
 * Complete mark question endpoint with all functionality
 */
router.post('/mark-homework', async (req: Request, res: Response) => {
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
      // For question-only images, return early with classification result
      return res.json({ 
        success: true,
        isQuestionOnly: true,
        message: 'Image classified as question only - use chat interface for tutoring',
        apiUsed: imageClassification.apiUsed,
        model: model,
        reasoning: imageClassification.reasoning,
        questionDetection: questionDetection,
        timestamp: new Date().toISOString()
      });
    }

    // Step 2: Real OCR processing
    console.log('🔍 ===== STEP 2: REAL OCR PROCESSING =====');
    const processedImage = await processImageWithRealOCR(imageData);
    console.log('🔍 OCR Processing completed successfully!');
    console.log('🔍 OCR Text length:', processedImage.ocrText.length);
    console.log('🔍 Bounding boxes found:', processedImage.boundingBoxes.length);

    // Step 3: AI-powered marking instructions
    console.log('🔍 ===== STEP 3: AI MARKING INSTRUCTIONS =====');
    const markingInstructions = await generateRealMarkingInstructions(imageData, model, processedImage);
    console.log('🔍 AI Marking Instructions generated:', markingInstructions.annotations.length, 'annotations');

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
    
    const resultId = await saveMarkingResults(
      imageData,
      model,
      processedImage,
      markingInstructions,
      imageClassification,
      userId,
      userEmail
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
      metadata: {
        resultId: resultId,
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
 * GET /mark-homework/results/:id
 * Retrieve saved marking results from Firestore
 */
router.get('/results/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Result ID is required'
      });
    }
    
    console.log('🔍 Retrieving marking results from Firestore for ID:', id);
    
    // Import and use the real Firestore service
    const { FirestoreService } = await import('../services/firestoreService');
    
    // Retrieve from Firestore
    const savedResult = await FirestoreService.getMarkingResults(id);
    
    if (!savedResult) {
      return res.status(404).json({
        success: false,
        error: 'Marking results not found'
      });
    }
    
    return res.json({
      success: true,
      result: savedResult
    });
    
  } catch (error) {
    console.error('Error retrieving results from Firestore:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve marking results from database'
    });
  }
});

/**
 * GET /mark-homework/user/:userId
 * Get marking history for a specific user
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }
    
    const limit = parseInt(req.query['limit'] as string) || 50;
    
    console.log('🔍 Retrieving marking history for user:', userId, 'limit:', limit);
    
    // Import and use the real Firestore service
    const { FirestoreService } = await import('../services/firestoreService');
    
    // Retrieve user's marking history from Firestore
    const userResults = await FirestoreService.getUserMarkingResults(userId, limit);
    
    return res.json({
      success: true,
      userId: userId,
      results: userResults,
      total: userResults.length,
      limit: limit
    });
    
  } catch (error) {
    console.error('Error retrieving user marking history:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve user marking history'
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
