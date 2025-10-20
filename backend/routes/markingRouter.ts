/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth.js';
import { runOriginalSingleImagePipeline } from './originalPipeline.js';

// --- Configure Multer ---
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
    files: 10 // Maximum 10 files
  }
});

const router = express.Router();

/**
 * Send SSE update helper function
 */
function sendSseUpdate(res: Response, data: any): void {
  try {
    const sseData = `data: ${JSON.stringify(data)}\n\n`;
    res.write(sseData);
  } catch (error) {
    console.error('❌ SSE write error:', error);
    throw error;
  }
}

/**
 * POST /api/marking/process
 * 
 * Unified endpoint for processing single images, multiple images, and PDFs
 * Routes to appropriate pipeline based on input type detection
 */
router.post('/process', optionalAuth, upload.array('files'), async (req: Request, res: Response, next: NextFunction) => {
  // --- Basic Setup ---
  const submissionId = uuidv4(); // Generate a unique ID for this submission
  console.log(`🚀 [SUBMISSION ${submissionId}] Received request for /process.`);

  // --- SSE Setup ---
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  
  // Send initial message
  sendSseUpdate(res, { stage: 'START', message: 'Processing started', submissionId });

  try {
    const files = req.files as Express.Multer.File[];

    // --- Input Validation ---
    if (!files || files.length === 0) {
      console.error(`[SUBMISSION ${submissionId}] No files uploaded.`);
      throw new Error('No files were uploaded.');
    }
    
    sendSseUpdate(res, { 
      stage: 'INPUT_VALIDATION', 
      status: 'PROCESSING', 
      message: `Received ${files.length} file(s). Validating...` 
    });

    // --- Input Type Detection ---
    const isSingleImage = files.length === 1 && files[0].mimetype.startsWith('image/');
    const isMultipleImages = files.length > 1 && files.every(f => f.mimetype.startsWith('image/'));
    const isPdf = files.length === 1 && files[0].mimetype === 'application/pdf';

    if (!isSingleImage && !isMultipleImages && !isPdf) {
      // Handle invalid combinations (e.g., multiple PDFs, mixed types)
      console.error(`[SUBMISSION ${submissionId}] Invalid file combination received.`);
      throw new Error('Invalid file submission: Please upload a single PDF, a single image, or multiple images.');
    }
    
    sendSseUpdate(res, { 
      stage: 'INPUT_VALIDATION', 
      status: 'DONE', 
      message: `Input validated (${isPdf ? 'PDF' : isMultipleImages ? 'Multiple Images' : 'Single Image'}).` 
    });

    // --- Conditional Routing ---
    if (isSingleImage) {
      // --- Route to Original Single Image Pipeline ---
      console.log(`[SUBMISSION ${submissionId}] Routing to original single image pipeline.`);
      sendSseUpdate(res, { 
        stage: 'ROUTING', 
        status: 'PROCESSING', 
        message: 'Processing as single image...' 
      });

      // Convert file buffer to base64 data URL
      const singleFileData = `data:${files[0].mimetype};base64,${files[0].buffer.toString('base64')}`;

      // Convert multipart form data to the format expected by the original pipeline
      const originalRequestBody = {
        imageData: singleFileData,
        model: req.body.model || 'auto',
        customText: req.body.customText || 'I have a question about this image.',
        debug: false,
        aiMessageId: req.body.aiMessageId || null,
        sessionId: req.body.sessionId || null,
        originalFileName: files[0].originalname || `image.${files[0].mimetype.split('/')[1]}`
      };

      // Create a modified request object with the converted body
      const modifiedReq = {
        ...req,
        body: originalRequestBody
      };

      // Call the original single image pipeline
      // This function handles everything: preprocessing, OCR, classification, marking, annotation, DB persistence, final SSE message + res.end()
      await runOriginalSingleImagePipeline(singleFileData, modifiedReq, res, submissionId);

      // Note: runOriginalSingleImagePipeline MUST eventually call res.end()

    } else if (isMultipleImages || isPdf) {
      // --- Route to New Multi-File/PDF Pipeline (Placeholder for now) ---
      console.log(`[SUBMISSION ${submissionId}] Routing to new multi-file/PDF pipeline.`);
      sendSseUpdate(res, { 
        stage: 'ROUTING', 
        status: 'PROCESSING', 
        message: `Preparing ${isPdf ? 'PDF' : 'multi-image'} processing...` 
      });

      // **** PLACEHOLDER for Stages 1-5 ****
      // We will implement PDF conversion, parallel OCR, segmentation, etc. here later.
      // For now, just send a temporary completion message.
      sendSseUpdate(res, {
        stage: 'TODO',
        status: 'DONE',
        message: `Multi-file/PDF processing not yet fully implemented. Input received.`,
        submissionId: submissionId,
        fileCount: files.length,
        inputType: isPdf ? 'PDF' : 'Multiple Images'
      });
      
      res.end(); // End the connection for now

    } else {
      // This case should technically be caught by initial validation, but belt-and-suspenders.
      throw new Error("Unhandled submission type.");
    }

  } catch (error) {
    console.error(`❌ [SUBMISSION ${submissionId}] Processing failed:`, error);
    
    // Provide user-friendly error messages based on error type
    let userFriendlyMessage = 'An unexpected error occurred. Please try again.';
    
    if (error instanceof Error) {
      if (error.message.includes('quota exceeded') || error.message.includes('429')) {
        userFriendlyMessage = 'API quota exceeded. Please try again later or contact support if this persists.';
      } else if (error.message.includes('timeout')) {
        userFriendlyMessage = 'Request timed out. The image might be too complex or the service is busy. Please try again.';
      } else if (error.message.includes('authentication') || error.message.includes('401') || error.message.includes('403')) {
        userFriendlyMessage = 'Authentication error. Please refresh the page and try again.';
      } else if (error.message.includes('network') || error.message.includes('connection')) {
        userFriendlyMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message.includes('Invalid file submission')) {
        userFriendlyMessage = error.message; // Use the specific validation error message
      }
    }
    
    // Ensure SSE message indicates error before closing
    sendSseUpdate(res, { 
      stage: 'ERROR', 
      status: 'FAILED', 
      message: userFriendlyMessage,
      technicalError: process.env['NODE_ENV'] === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined
    });
    
    // Ensure the connection is always closed on error
    if (!res.writableEnded) {
      res.end();
    }
  }
});

/**
 * GET /marking/download-image
 * Download image by proxying the request to avoid CORS issues
 * (Preserved from original markingApi.ts)
 */
router.get('/download-image', optionalAuth, async (req: Request, res: Response) => {
  try {
    const { url, filename } = req.query;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Image URL is required' 
      });
    }

    // Fetch the image from the external URL
    const response = await fetch(url);
    
    if (!response.ok) {
      return res.status(404).json({ 
        success: false, 
        error: 'Image not found' 
      });
    }

    // Get the image data
    const imageBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    
    // Set headers for download
    const downloadFilename = filename && typeof filename === 'string' ? filename : 'image';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Content-Length', imageBuffer.byteLength);
    
    // Send the image data
    res.send(Buffer.from(imageBuffer));
    
  } catch (error) {
    console.error('Error downloading image:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to download image' 
    });
  }
});

export default router;
