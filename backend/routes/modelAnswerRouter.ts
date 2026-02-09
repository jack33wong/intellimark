import express from 'express';
import { ModelAnswerController } from '../controllers/ModelAnswerController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/model-answer
 * Generates model answers for a specific exam paper
 * Supports SSE for progress tracking
 */
router.post('/', optionalAuth, ModelAnswerController.generateModelAnswers);

export default router;
