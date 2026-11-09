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

/**
 * Middleware to hydrate large file batches (>20MB) that were uploaded directly
 * to Firebase Storage (temp_uploads/...) by the frontend to bypass Cloud Run's 32MiB HTTP body limit.
 */
const firebaseStorageRefsHandler = async (req: any, _res: any, next: any) => {
  try {
    // If files were already uploaded directly via multipart, nothing to hydrate
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      return next();
    }

    const rawStorageRefs = req.body?.storageRefs;
    if (!rawStorageRefs) {
      return next();
    }

    const parsedRefs = typeof rawStorageRefs === 'string'
      ? JSON.parse(rawStorageRefs)
      : rawStorageRefs;

    if (!Array.isArray(parsedRefs) || parsedRefs.length === 0) {
      return next();
    }

    console.log(`☁️ [STORAGE-HANDOFF] Hydrating ${parsedRefs.length} large file(s) from Firebase Storage...`);
    const { ImageStorageService } = await import('../services/imageStorageService.js');

    const hydratedFiles = await Promise.all(
      parsedRefs.map(async (refItem: any) => {
        const buffer = await ImageStorageService.downloadAndDeleteTempUpload(refItem.storagePath);
        return {
          fieldname: 'files',
          originalname: refItem.originalname || 'upload.pdf',
          encoding: '7bit',
          mimetype: refItem.mimetype || 'application/pdf',
          buffer,
          size: buffer.length
        };
      })
    );

    req.files = hydratedFiles;
    const totalMB = (hydratedFiles.reduce((sum, f) => sum + f.size, 0) / (1024 * 1024)).toFixed(2);
    console.log(`✅ [STORAGE-HANDOFF] Successfully hydrated ${hydratedFiles.length} file(s) (${totalMB} MB) into req.files`);
    next();
  } catch (err) {
    console.error('❌ [STORAGE-HANDOFF] Failed to hydrate files from Firebase Storage:', err);
    next(err);
  }
};

const router = express.Router();

/**
 * POST /api/marking/process
 * Unified endpoint for marking images and PDFs
 */
router.post('/process',
  // Auth MUST run first
  optionalAuth,
  attachUserPlan,
  (req, _res, next) => {
    // Keep minimal debug logging to confirm lifecycle
    console.log(`📡 [MARKING] Processing ${req.method} ${req.originalUrl} (hasRawBody: ${!!(req as any).rawBody})`);
    next();
  },
  // Then parse the files safely
  upload.array('files'),
  firebaseMultipartHandler,
  firebaseStorageRefsHandler,
  
  // Finally, execute controller
  MarkingController.processMarkingRequest
);

/**
 * POST /api/marking/remark-session
 * Zero-reupload re-marking endpoint for existing sessions
 */
router.post('/remark-session',
  optionalAuth,
  attachUserPlan,
  express.json({ limit: '50mb' }),
  MarkingController.remarkSession
);

/**
 * GET /api/marking/download-image
 * Proxies image downloads to force attachment and bypass CORS
 */
router.get('/download-image', MarkingController.downloadImage);

export default router;
