/**
 * Debug Mode API Routes
 * Handles debug mode toggle and configuration
 */

import { Router, Request, Response } from 'express';
import { DEBUG_MODE, getDebugMode, setDebugMode } from '../config/aiModels.js';

const router = Router();

/**
 * POST /api/debug/toggle
 * Toggle debug mode on/off
 */
router.post('/toggle', async (req: Request, res: Response) => {
  try {
    const { debugMode } = req.body;
    
    if (typeof debugMode !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'debugMode must be a boolean value'
      });
    }

    // Update debug mode at runtime
    setDebugMode(debugMode);
    
    res.json({
      success: true,
      debugMode: debugMode,
      message: `Debug mode ${debugMode ? 'enabled' : 'disabled'}`
    });

  } catch (error) {
    console.error('Error toggling debug mode:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle debug mode'
    });
  }
});

/**
 * GET /api/debug/status
 * Get current debug mode status
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const currentDebugMode = getDebugMode();
    res.json({
      success: true,
      debugMode: currentDebugMode.enabled,
      fakeDelayMs: currentDebugMode.fakeDelayMs,
      returnOriginalImage: currentDebugMode.returnOriginalImage
    });
  } catch (error) {
    console.error('Error getting debug status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get debug status'
    });
  }
});

export default router;

