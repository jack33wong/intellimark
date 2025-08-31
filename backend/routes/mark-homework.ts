/**
 * Mark Homework API Route
 * Handles homework marking requests with image processing and AI analysis
 */

import express from 'express';
import { 
  MarkHomeworkResponse
} from '../types';
import { ImageProcessingService } from '../services/imageProcessingService';
import { AIMarkingService } from '../services/aiMarkingService';
import { SVGOverlayService } from '../services/svgOverlayService';
import { validateModelConfig } from '../config/aiModels';

const router = express.Router();

/**
 * POST /mark-homework
 * Process homework image and return marked results
 */
router.post('/mark-homework', async (req, res) => {
  console.log('🚀 ===== MARK HOMEWORK ROUTE CALLED =====');
  console.log('Request body:', { imageData: req.body.imageData ? 'present' : 'missing', model: req.body.model });
  
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

    // First, classify the image as question-only or question+answer
    console.log('🔍 ===== CLASSIFYING IMAGE =====');
    const imageClassification = await AIMarkingService.classifyImage(imageData, model);
    console.log('🔍 Image Classification:', imageClassification);
    
    if (imageClassification.isQuestionOnly) {
      // For question-only images, return early with classification result
      return res.json({ 
        success: true,
        isQuestionOnly: true,
        message: 'Image classified as question only - use chat interface',
        apiUsed: imageClassification.apiUsed,
        model: model,
        reasoning: imageClassification.reasoning
      });
    }

    // For question+answer images, proceed with normal marking
    console.log('🔍 ===== PROCESSING IMAGE FOR MARKING =====');
    const processingResult = await ImageProcessingService.processImage(imageData);
    
    if (!processingResult.success) {
      return res.status(500).json({
        success: false,
        error: processingResult.error.message
      });
    }

    const processedImage = processingResult.data!;
    console.log('🔍 ImageProcessingService completed successfully!');
    console.log('🔍 OCR Text length:', processedImage.ocrText.length);
    console.log('🔍 Bounding boxes found:', processedImage.boundingBoxes.length);

    // Generate marking instructions using AI
    console.log('🔍 ===== GENERATING MARKING INSTRUCTIONS =====');
    const markingInstructions = await AIMarkingService.generateMarkingInstructions(
      imageData, 
      model, 
      processedImage
    );

    // Create SVG overlay from marking instructions
    console.log('🔍 ===== CREATING SVG OVERLAY =====');
    const svgOverlay = SVGOverlayService.createSVGOverlay(
      markingInstructions,
      processedImage.imageDimensions.width,
      processedImage.imageDimensions.height
    );

    // Prepare response
    const modelName = model === 'gemini-2.5-pro' ? 'Google Gemini 2.5 Pro' : 
                     model === 'chatgpt-5' ? 'OpenAI ChatGPT 5' : 'OpenAI GPT-4 Omni';
    
    let apiUsed = '';
    if (model === 'gemini-2.5-pro') {
      apiUsed = 'Google Gemini 2.0 Flash Exp';
    } else if (model === 'chatgpt-5') {
      apiUsed = 'OpenAI GPT-5';
    } else {
      apiUsed = 'OpenAI GPT-4 Omni';
    }
    
    const response: MarkHomeworkResponse = {
      success: true,
      isQuestionOnly: false,
      result: processedImage,
      annotatedImage: svgOverlay,
      instructions: markingInstructions,
      message: `Homework marked successfully using ${modelName} + AI-powered analysis`,
      apiUsed,
      ocrMethod: processedImage.ocrText && processedImage.ocrText.length > 0 && 
                 processedImage.boundingBoxes && processedImage.boundingBoxes.length > 0 ? 
                 'Mathpix API' : 'Tesseract.js (Fallback)',
      classification: imageClassification
    };

    return res.json(response);

  } catch (error) {
    console.error('Mark homework error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /mark-homework/status
 * Get service status and health information
 */
router.get('/status', (_req, res) => {
  try {
    const status = {
      service: 'Mark Homework API',
      status: 'operational',
      timestamp: new Date().toISOString(),
      features: [
        'Image classification (question vs homework)',
        'AI-powered marking instructions',
        'OCR text extraction',
        'SVG annotation overlays',
        'Multi-model AI support (GPT-4o, GPT-5, Gemini)'
      ],
      supportedModels: ['chatgpt-4o', 'chatgpt-5', 'gemini-2.5-pro']
    };
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ 
      service: 'Mark Homework API',
      status: 'error',
      error: 'Failed to get status' 
    });
  }
});

/**
 * POST /mark-homework/test
 * Test endpoint for development and debugging
 */
router.post('/test', async (_req, res) => {
  try {
    const testResult = await ImageProcessingService.testPipeline();
    
    res.json({
      success: true,
      message: 'Test completed successfully',
      pipelineWorking: testResult,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Test failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
