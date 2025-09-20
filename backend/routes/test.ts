/**
 * Test Routes
 * Test endpoints for debugging
 */

import express from 'express';
import { FirestoreService } from '../services/firestoreService';
import { authenticateUser } from '../middleware/auth';

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

export default router;