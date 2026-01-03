/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express from 'express';
import multer from 'multer';
import { MarkingController } from '../controllers/MarkingController.js';
import { optionalAuth } from '../middleware/auth.js';
import { attachUserPlan } from '../middleware/planMiddleware.js';

// --- Configure Multer ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file (Increased from 50MB)
    files: 100 // Maximum 100 files (Increased from 50)
  }
});

const router = express.Router();

/**
 * POST /api/marking/process
 * Unified endpoint for marking images and PDFs
 */
router.post('/process',
  optionalAuth,
  attachUserPlan,
  upload.array('files'),
  MarkingController.processMarkingRequest
);

export default router;
