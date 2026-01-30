/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express from 'express';
import multer from 'multer';
import Busboy from 'busboy';
import { MarkingController } from '../controllers/MarkingController.js';
import { optionalAuth } from '../middleware/auth.js';
import { attachUserPlan } from '../middleware/planMiddleware.js';

// --- Configure Multer ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit per file
    files: 100 // Maximum 100 files
  }
});

/**
 * Custom middleware to handle multipart data in Firebase / Google Cloud Functions.
 * These environments pre-consume the request stream and provide it as req.rawBody.
 */
const firebaseMultipartHandler = (req: any, res: any, next: any) => {
  // If req.files is already populated (e.g., standard Multer worked in local dev), skip
  if (req.files && (req.files as any).length > 0) {
    return next();
  }

  // If there's no rawBody and the stream isn't readable, we can't find files
  if (!req.rawBody && !req.readable) {
    return next();
  }

  try {
    const busboy = Busboy({ headers: req.headers });
    const files: any[] = [];
    const fields: any = {};

    busboy.on('file', (fieldname, file, info) => {
      const { filename, encoding, mimeType } = info;
      const chunks: Buffer[] = [];

      file.on('data', (chunk) => {
        chunks.push(chunk);
      });

      file.on('end', () => {
        files.push({
          fieldname,
          originalname: filename,
          encoding,
          mimetype: mimeType,
          buffer: Buffer.concat(chunks),
          size: Buffer.concat(chunks).length
        });
      });
    });

    busboy.on('field', (fieldname, val) => {
      fields[fieldname] = val;
    });

    busboy.on('finish', () => {
      // Create a new property to avoid conflicting with existing req.files types if necessary,
      // but standard controllers expect req.files.
      req.files = files;
      // Merge body fields found during multipart parsing
      req.body = { ...req.body, ...fields };

      if (files.length > 0) {
        console.log(`✅ [FIREBASE-BUSBOY] Successfully parsed ${files.length} files from ${req.rawBody ? 'rawBody' : 'stream'}`);
      }
      next();
    });

    busboy.on('error', (err) => {
      console.error('❌ [FIREBASE-BUSBOY] Parsing error:', err);
      next(err);
    });

    // If rawBody exists (Firebase), write it to busboy immediately
    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      // Otherwise, pipe the stream (Local Dev)
      req.pipe(busboy);
    }
  } catch (err) {
    console.error('❌ [FIREBASE-BUSBOY] Setup error:', err);
    next(err);
  }
};

const router = express.Router();

/**
 * POST /api/marking/process
 * Unified endpoint for marking images and PDFs
 */
router.post('/process',
  optionalAuth,
  attachUserPlan,
  (req, _res, next) => {
    // Keep minimal debug logging to confirm lifecycle
    console.log(`📡 [MARKING] Processing ${req.method} ${req.originalUrl} (hasRawBody: ${!!(req as any).rawBody})`);
    next();
  },
  // 1. Try standard Multer (works in some envs/local dev)
  upload.array('files'),
  // 2. Fallback to custom Busboy parser for Firebase (handles req.rawBody)
  firebaseMultipartHandler,
  MarkingController.processMarkingRequest
);

/**
 * GET /api/marking/download-image
 * Proxies image downloads to force attachment and bypass CORS
 */
router.get('/download-image', MarkingController.downloadImage);

export default router;
