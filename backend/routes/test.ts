/**
 * Test Routes
 * Test endpoints for debugging
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /test/add-message
 * Test addMessageToUnifiedSession function
 */
router.post('/add-message', authenticateUser, async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID is required' });
    }
    
    if (!message) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    
    // Test addMessageToUnifiedSession
    await FirestoreService.addMessageToUnifiedSession(sessionId, message);
    
    
    res.json({
      success: true,
      message: 'Message added successfully',
      sessionId
    });
    
  } catch (error: any) {
    console.error(`❌ [${new Date().toISOString()}] Test addMessageToUnifiedSession failed:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to add message',
      details: error.message
    });
  }
});

/**
 * GET /test/progress-data
 * Test progressData generation
 */
router.get('/progress-data', async (req, res) => {
  try {
    const { ProgressTracker } = await import('../utils/progressTracker.js');
    
    const MARKING_MODE_STEPS = [
      'Analyzing image...',
      'Detecting question type...',
      'Extracting text and math...',
      'Generating feedback...',
      'Creating annotations...',
      'Finalizing response...',
      'Almost done...'
    ];

    let finalProgressData = null;
    const progressTracker = new ProgressTracker(MARKING_MODE_STEPS, (data) => {
      finalProgressData = data;
    });

    // Simulate progress
    progressTracker.startStep('Analyzing image...');
    progressTracker.completeStep('Analyzing image...');
    progressTracker.startStep('Detecting question type...');
    progressTracker.completeStep('Detecting question type...');
    progressTracker.startStep('Extracting text and math...');
    progressTracker.completeStep('Extracting text and math...');
    progressTracker.startStep('Generating feedback...');
    progressTracker.completeStep('Generating feedback...');
    progressTracker.startStep('Creating annotations...');
    progressTracker.completeStep('Creating annotations...');
    progressTracker.startStep('Finalizing response...');
    progressTracker.completeStep('Finalizing response...');
    progressTracker.startStep('Almost done...');
    progressTracker.completeStep('Almost done...');

    res.json({ 
      success: true, 
      progressData: finalProgressData,
      message: 'ProgressData generated successfully' 
    });
  } catch (error) {
    console.error('❌ Test progress-data error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;