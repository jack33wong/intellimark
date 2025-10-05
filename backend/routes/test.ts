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
      { id: 'classification', name: 'Classification', description: 'Analyzing image...', percentage: 14 },
      { id: 'detection', name: 'Detection', description: 'Detecting question type...', percentage: 28 },
      { id: 'extraction', name: 'Extraction', description: 'Extracting text and math...', percentage: 42 },
      { id: 'generation', name: 'Generation', description: 'Generating feedback...', percentage: 57 },
      { id: 'annotation', name: 'Annotation', description: 'Creating annotations...', percentage: 71 },
      { id: 'finalization', name: 'Finalization', description: 'Finalizing response...', percentage: 85 },
      { id: 'completion', name: 'Completion', description: 'Almost done...', percentage: 100 }
    ];

    let finalProgressData = null;
    const progressTracker = new ProgressTracker(MARKING_MODE_STEPS, (data) => {
      finalProgressData = data;
    });

    // Simulate progress
    progressTracker.startStep('classification');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('detection');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('extraction');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('generation');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('annotation');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('finalization');
    progressTracker.completeCurrentStep();
    progressTracker.startStep('completion');
    progressTracker.completeCurrentStep();

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