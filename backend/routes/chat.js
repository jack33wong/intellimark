/**
 * Chat API Route
 * Handles AI chat requests with image context
 */

const express = require('express');
const { AIMarkingService } = require('../services/aiMarkingService');

const router = express.Router();

/**
 * POST /chat
 * Send a message to AI with image context and get response
 */
router.post('/chat', async (req, res) => {
  console.log('🚀 ===== CHAT ROUTE CALLED =====');
  console.log('Request body:', { 
    message: req.body.message ? req.body.message.substring(0, 100) + '...' : 'missing',
    imageData: req.body.imageData ? 'present' : 'missing',
    model: req.body.model 
  });
  
  try {
    const { message, imageData, model = 'chatgpt-4o' } = req.body;
    
    // Validate request
    if (!message || !imageData) {
      return res.status(400).json({
        success: false,
        error: 'Message and image data are required'
      });
    }

    console.log('🔍 ===== PROCESSING CHAT REQUEST =====');
    console.log('🔍 Message:', message);
    console.log('🔍 Model:', model);
    console.log('🔍 Image data length:', imageData.length);

    // Generate AI response using the image and message
    const aiResponse = await AIMarkingService.generateChatResponse(imageData, message, model);
    
    console.log('🔍 ===== AI RESPONSE GENERATED =====');
    console.log('🔍 Response length:', aiResponse.length);
    console.log('🔍 Response preview:', aiResponse.substring(0, 100) + '...');

    return res.json({
      success: true,
      response: aiResponse,
      model: model,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate AI response',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /chat/status
 * Get chat service status
 */
router.get('/status', (_req, res) => {
  try {
    const status = {
      service: 'Chat API',
      status: 'operational',
      timestamp: new Date().toISOString(),
      features: [
        'AI-powered chat with image context',
        'Multi-model support (GPT-4o, GPT-5, Gemini)',
        'Image-aware responses'
      ],
      supportedModels: ['chatgpt-4o', 'chatgpt-5', 'gemini-2.5-pro']
    };
    
    res.json(status);
  } catch (error) {
    res.status(500).json({ 
      service: 'Chat API',
      status: 'error',
      error: 'Failed to get status' 
    });
  }
});

module.exports = router;
