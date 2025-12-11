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
    fileSize: 50 * 1024 * 1024, // 50MB limit per file
    files: 50 // Maximum 50 files
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
