/**
 * Mark Homework API Route
 * Handles homework marking requests with image processing and AI analysis
 */

import express from 'express';
import { 
  MarkHomeworkRequest, 
  MarkHomeworkResponse
} from '../types';
import { ImageProcessingService } from '../services/imageProcessingService';
import { ImageAnnotationService } from '../services/imageAnnotationService';
import { getModelConfig, validateModelConfig } from '../config/aiModels';

const router = express.Router();

/**
 * POST /mark-homework
 * Process homework image and return marked results
 */
router.post('/mark-homework', async (req, res) => {
  console.log('🚀 ===== MARK HOMEWORK ROUTE CALLED =====');
  console.log('Request body:', { imageData: req.body.imageData ? 'present' : 'missing', model: req.body.model });
  try {
    const { imageData, model }: MarkHomeworkRequest = req.body;

    // Validate request
    if (!imageData) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    if (!model || !validateModelConfig(model)) {
      return res.status(400).json({
        success: false,
        error: 'Valid AI model is required'
      });
    }

    // Process image with OCR
    console.log('📸 ===== CALLING IMAGE PROCESSING SERVICE =====');
    const processingResult = await ImageProcessingService.processImage(imageData);
    
    if (!processingResult.success) {
      return res.status(500).json({
        success: false,
        error: processingResult.error.message
      });
    }

    const processedImage = processingResult.data!;

    // Generate annotations
    const annotations = ImageAnnotationService.createAnnotationsFromBoundingBoxes(
      processedImage.boundingBoxes,
      processedImage.imageDimensions
    );

    // Create SVG overlay
    const svgOverlay = ImageAnnotationService.createSVGOverlay(
      annotations,
      processedImage.imageDimensions
    );

    // Prepare response
    const response: MarkHomeworkResponse = {
      success: true,
      result: processedImage,
      annotatedImage: svgOverlay
    };

    res.json(response);
    return;

  } catch (error) {
    console.error('Mark homework error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
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
      imageProcessing: ImageProcessingService.getServiceStatus(),
      aiModels: {
        available: Object.keys(getModelConfig('chatgpt-4o') ? {} : {}),
        default: 'chatgpt-4o'
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get service status'
    });
  }
});

/**
 * POST /mark-homework/test
 * Test endpoint for development and debugging
 */
router.post('/test', (_req, res) => {
  try {
    const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    res.json({
      success: true,
      message: 'Test endpoint working',
      testImage: testImage.substring(0, 50) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Test endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Test endpoint failed'
    });
  }
});

export default router;
