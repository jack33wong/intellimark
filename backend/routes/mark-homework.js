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
    const { imageData, model } = req.body;

    // Validate request
    if (!imageData) {
      return res.status(400).json({
        success: false,
        error: 'Image data is required'
      });
    }

    if (!model) {
      return res.status(400).json({
        success: false,
        error: 'Valid AI model is required'
      });
    }

    // Mock response for now
    const response = {
      success: true,
      result: {
        ocrText: "Sample homework text extracted",
        boundingBoxes: [],
        confidence: 0.95,
        imageDimensions: { width: 800, height: 600 },
        isQuestion: true
      },
      annotatedImage: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCI+PC9zdmc+"
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
router.get('/status', (req, res) => {
  try {
    const status = {
      imageProcessing: { status: 'available', version: '1.0.0' },
      aiModels: {
        available: ['chatgpt-4o', 'gemini-2.5-pro'],
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
