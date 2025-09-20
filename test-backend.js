const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Test classification endpoint
app.post('/api/mark-homework/upload', (req, res) => {
  const { imageData } = req.body;
  
  if (!imageData) {
    return res.status(400).json({ success: false, error: 'Image data is required' });
  }

  // Mock response with Gemini classification
  const mockResponse = {
    success: true,
    responseType: 'original_image',
    unifiedSession: {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: 'Question - Test Question',
      messageType: 'Question',
      userId: 'anonymous',
      messageCount: 1,
      messages: [{
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: 'user',
        content: 'I have a question about this image. Can you help me understand it?',
        timestamp: new Date().toISOString(),
        type: 'question_original',
        imageData: imageData,
        fileName: 'uploaded-image.png'
      }]
    },
    processing: true,
    classification: {
      isQuestionOnly: true,
      reasoning: 'Test classification - using Gemini 2.5 Pro',
      apiUsed: 'Google Gemini 2.5 Pro',
      extractedQuestionText: 'Test question text',
      usageTokens: 0
    },
    debug: {
      isAuthenticated: false,
      userId: 'anonymous',
      userEmail: 'anonymous@example.com',
      sessionSaved: false
    }
  };

  res.json(mockResponse);
});

app.listen(PORT, () => {
  console.log(`✅ Test backend running on port ${PORT}`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Test endpoint: POST http://localhost:${PORT}/api/mark-homework/upload`);
});
