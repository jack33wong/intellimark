const express = require('express');
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

    if (!model) {
      console.log('🔍 Validation failed: No model specified');
      return res.status(400).json({
        success: false,
        error: 'Valid AI model is required'
      });
    }
    console.log('🔍 Model validation passed');

    // First, classify the image as question-only or question+answer
    console.log('🔍 ===== CLASSIFYING IMAGE =====');
    
    // Mock classification for now - in real implementation this would call AIMarkingService
    const imageClassification = {
      isQuestionOnly: false,
      reasoning: 'Mock classification - proceeding with homework marking',
      apiUsed: 'Mock Service'
    };
    
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
    
    // Mock response for now
    const response = {
      success: true,
      isQuestionOnly: false,
      result: {
        ocrText: "Sample homework text extracted",
        boundingBoxes: [],
        confidence: 0.95,
        imageDimensions: { width: 800, height: 600 },
        isQuestion: true
      },
      annotatedImage: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCI+PC9zdmc+",
      message: "Homework marked successfully using Mock AI Service",
      apiUsed: "Mock Service",
      classification: imageClassification
    };

    res.json(response);
    return;

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
router.get('/status', (req, res) => {
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
router.post('/test', (req, res) => {
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

module.exports = router;
