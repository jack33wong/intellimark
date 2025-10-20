/**
 * Unified Marking Router
 * Handles single images, multiple images, and PDFs through a single endpoint
 */

import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth.js';
import { runOriginalSingleImagePipeline } from './originalPipeline.js';
import PdfProcessingService from '../services/pdf/PdfProcessingService.js';
import sharp from 'sharp';
import { ImageUtils } from '../utils/ImageUtils.js';
import { sendSseUpdate, closeSseConnection } from '../utils/sseUtils.js';
import { createAIMessage } from '../utils/messageUtils.js';

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
  sendSseUpdate(res, { submissionId, stage: 'START', status: 'PROCESSING', message: 'Processing started' });

  try {
    const files = req.files as Express.Multer.File[];
    // Determine authentication status early
    const userId = (req as any)?.user?.uid || null;
    const isAuthenticated = !!userId;

    // --- Input Validation ---
    if (!files || files.length === 0) {
      console.error(`[SUBMISSION ${submissionId}] No files uploaded.`);
      throw new Error('No files were uploaded.');
    }
    
    sendSseUpdate(res, { submissionId, stage: 'INPUT_VALIDATION', status: 'PROCESSING', message: `Received ${files.length} file(s). Validating...` });

    // --- Input Type Detection (Prioritize PDF) ---
    const firstMime = files[0]?.mimetype || 'unknown';
    console.log(`[MIME CHECK] Received ${files.length} file(s). First mimetype: ${firstMime}`);
    const isPdf = files.length === 1 && firstMime === 'application/pdf';
    const isSingleImage = files.length === 1 && !isPdf && firstMime.startsWith('image/');
    const isMultipleImages = files.length > 1 && files.every(f => {
      const ok = f.mimetype?.startsWith('image/');
      if (!ok) console.warn(`[MIME CHECK] Non-image file detected in multi-upload: ${f.mimetype}`);
      return ok;
    });

    if (!isSingleImage && !isMultipleImages && !isPdf) {
      // Handle invalid combinations (e.g., multiple PDFs, mixed types)
      console.error(`[SUBMISSION ${submissionId}] Invalid file combination received.`);
      throw new Error('Invalid file submission: Please upload a single PDF, a single image, or multiple images.');
    }
    
    sendSseUpdate(res, { submissionId, stage: 'INPUT_VALIDATION', status: 'DONE', message: `Input validated (${isPdf ? 'PDF' : isMultipleImages ? 'Multiple Images' : 'Single Image'}).` });

    // --- Conditional Routing (PDF first) ---
    if (isPdf) {
      // --- Route to PDF Pipeline ---
      console.log(`[SUBMISSION ${submissionId}] PDF detected. Routing to PDF pipeline.`);
      sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: `Preparing PDF processing...` });

      // Stage 1: Standardization
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'PROCESSING', message: 'Converting PDF...' });
      const pdfBuffer = files[0].buffer;
      const standardizedPages = await PdfProcessingService.convertPdfToImages(pdfBuffer);
      if (standardizedPages.length === 0) throw new Error('PDF conversion yielded no pages.');
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'DONE', message: `Converted PDF to ${standardizedPages.length} pages.` });

      // Dimension extraction after conversion (reliable via sharp on buffers)
      sendSseUpdate(res, { submissionId, stage: 'DIMENSIONS', status: 'PROCESSING', message: `Extracting dimensions for ${standardizedPages.length} converted page(s)...` });
      try {
        await Promise.all(standardizedPages.map(async (page, i) => {
          const base64Data = page.imageData.split(',')[1];
          if (!base64Data) {
            console.warn(`[DIMENSIONS - PDF Path] Invalid base64 data for page ${i}, skipping.`);
            page.width = 0; page.height = 0; return;
          }
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const metadata = await sharp(imageBuffer).metadata();
          if (!metadata.width || !metadata.height) {
            console.warn(`[DIMENSIONS - PDF Path] Sharp failed to get valid dimensions for page ${i}.`);
          }
          page.width = metadata.width || 0;
          page.height = metadata.height || 0;
          console.log(`[DIMENSIONS - PDF Path] Extracted dimensions for page ${i}: ${page.width}x${page.height}`);
        }));
        sendSseUpdate(res, { submissionId, stage: 'DIMENSIONS', status: 'DONE', message: 'Dimension extraction complete.' });
      } catch (dimensionError) {
        console.error('❌ Error during PDF dimension extraction:', dimensionError);
        throw new Error(`Failed during PDF dimension extraction: ${dimensionError instanceof Error ? dimensionError.message : 'Unknown error'}`);
      }

      // TEMP: Single-page PDF → treat as single image
      if (standardizedPages.length === 1) {
        console.log(`[SUBMISSION ${submissionId}] Single-page PDF detected. Routing to original single image pipeline after conversion.`);
        sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: 'Processing as single converted page...' });
        
        // Upload original PDF to storage for authenticated users or create data URL for unauthenticated users
        let originalPdfLink = null;
        let originalPdfDataUrl = null;
        
        if (isAuthenticated) {
          try {
            const { ImageStorageService } = await import('../services/imageStorageService.js');
            const sessionId = req.body.sessionId || submissionId;
            const originalFileName = files[0].originalname || 'document.pdf';
            originalPdfLink = await ImageStorageService.uploadPdf(
              `data:application/pdf;base64,${pdfBuffer.toString('base64')}`,
              userId || 'anonymous',
              sessionId,
              originalFileName
            );
            console.log(`[PDF CONTEXT] Original PDF uploaded: ${originalPdfLink}`);
          } catch (error) {
            console.error('❌ Failed to upload original PDF:', error);
            originalPdfLink = null;
          }
        } else {
          // For unauthenticated users, create a data URL
          originalPdfDataUrl = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;
          console.log(`[PDF CONTEXT] Created PDF data URL for unauthenticated user`);
        }
        
        const singleFileData = standardizedPages[0].imageData;
        
        // Create a modified request object with the original PDF filename
        const modifiedReq = {
          ...req,
          body: {
            ...req.body,
            originalFileName: files[0].originalname || 'document.pdf'
          }
        };
        
        await runOriginalSingleImagePipeline(singleFileData, modifiedReq, res, submissionId, {
          originalFileType: 'pdf',
          originalPdfLink: originalPdfLink,
          originalPdfDataUrl: originalPdfDataUrl
        });
        return;
      }

      // Multi-page PDF – Preprocessing (placeholder path)
      console.log(`[SUBMISSION ${submissionId}] Multi-page PDF detected. Proceeding with multi-page logic.`);
      sendSseUpdate(res, { submissionId, stage: 'PREPROCESSING', status: 'PROCESSING', message: `Preprocessing ${standardizedPages.length} image(s)...` });
      const preprocessedImageDatas = await Promise.all(
        standardizedPages.map(page => ImageUtils.preProcess(page.imageData))
      );
      await Promise.all(standardizedPages.map(async (page, i) => {
        page.imageData = preprocessedImageDatas[i];
        const base64Data = page.imageData.split(',')[1];
        if (!base64Data) return;
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const metadata = await sharp(imageBuffer).metadata();
        page.width = metadata.width || 0;
        page.height = metadata.height || 0;
      }));
      sendSseUpdate(res, { submissionId, stage: 'PREPROCESSING', status: 'DONE', message: 'Preprocessing complete.' });

      // One-line dimension logs per page
      standardizedPages.forEach((p: any) => {
        const ratio = p.height ? (p.width / p.height).toFixed(3) : '0.000';
        console.log(`[DIM] page=${p.pageIndex} size=${p.width}x${p.height} ratio=${ratio}`);
      });

      // Fallback warning if any page still lacks dimensions
      standardizedPages.forEach((p: any, i: number) => {
        if (!p.width || !p.height) {
          console.warn(`[DIMENSIONS] Dimensions for page ${i} not set during standardization. Extraction needed (TODO).`);
          p.width = p.width || 0;
          p.height = p.height || 0;
        }
      });

      // Placeholder end for multi-page PDF
      sendSseUpdate(res, { submissionId, stage: 'TODO', status: 'DONE', message: `Multi-page PDF preprocessing complete. Further processing not yet fully implemented.` });
      res.end();

    } else if (isSingleImage) {
      // --- Route to Original Single Image Pipeline ---
      console.log(`[SUBMISSION ${submissionId}] Routing to original single image pipeline.`);
      sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: 'Processing as single image...' });

      // Convert file buffer to base64 data URL
      console.log(`[MIME CHECK] Single image mimetype: ${files[0].mimetype}`);
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

    } else if (isMultipleImages) {
      // --- Route to New Multi-File/PDF Pipeline (Placeholder for now) ---
      console.log(`[SUBMISSION ${submissionId}] Routing to new multi-file/PDF pipeline.`);
      sendSseUpdate(res, { submissionId, stage: 'ROUTING', status: 'PROCESSING', message: 'Preparing multi-image processing...' });

      // Standardize input pages from images
      const standardizedPages = files.map((file, index) => ({
        pageIndex: index,
        imageData: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
        originalFileName: file.originalname
      }));
      sendSseUpdate(res, { submissionId, stage: 'STANDARDIZATION', status: 'DONE', message: `Processed ${standardizedPages.length} image(s).` });

      // Send placeholder COMPLETE event for Multi-image path until remaining stages are implemented
      console.log(`[SUBMISSION ${submissionId}] Reached end of implemented stages for Multiple Images. Sending placeholder complete event.`);
      const sessionTitleMulti = `Multiple Images Submission Placeholder`;
      const placeholderAiMessageMulti = createAIMessage({
        content: `Preprocessing complete for ${standardizedPages.length} image(s). Full marking for multi-file submissions is under development.`,
        messageId: `placeholder-${submissionId}`,
        isQuestionOnly: false,
        processingStats: { apiUsed: 'placeholder' }
      });
      let finalResultPayloadMulti: any;
      if (isAuthenticated) {
        const placeholderUnifiedSessionMulti = {
          id: submissionId,
          title: sessionTitleMulti,
          userId: userId,
          messageType: 'Marking',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [placeholderAiMessageMulti],
          sessionStats: {}
        };
        finalResultPayloadMulti = { success: true, unifiedSession: placeholderUnifiedSessionMulti, sessionId: submissionId };
      } else {
        finalResultPayloadMulti = { success: true, aiMessage: placeholderAiMessageMulti, sessionId: submissionId, sessionTitle: sessionTitleMulti };
      }
      sendSseUpdate(res, { type: 'complete', result: finalResultPayloadMulti }, true);
      res.end();

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
